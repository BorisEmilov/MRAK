/**
 * GameHost: owns the core Game, advances it from the Phaser loop with a fixed time step and an
 * accumulator, and feeds React through the throttled UI store. It has no Phaser dependency:
 * Phaser only calls `update(delta)`, and learns about game start/end through the UI EventBus.
 *
 * Saving (docs/systems/save-system.md → Local saves): the core AutosavePolicy decides when to
 * autosave; every write goes through one serialized queue (no concurrent writes to a slot).
 */
import {
  AutosavePolicy,
  canManualSave,
  Game,
  packExport,
  SaveCorruptError,
  SaveError,
  SaveTooNewError,
  sealSave,
  serializeSave,
  unpackExport,
  type Ambient,
  type Perception,
  type AutosaveReason,
  type Command,
  type CommandResult,
  type ContentDatabase,
  type CoreEvent,
  type NewGameOptions,
  type SaveFile,
  type SealedSave,
  type Snapshot,
  type CategoryProgress,
  type GatherStatus,
  type PackLoad,
  type VillagerActivity,
  type VillagerView,
  type CheckPool,
  type CheckRequest,
  type GuardianChoices,
  type TalentPreview,
  type ToneOption,
  awardLegacy,
  buyNode,
  nodeBlocked,
  type Profile,
  type BuildPreview,
  grantTitle,
  seasonalActive,
  type GoalProgress,
  PROLOGUE,
  AchievementSystem,
  recordProfileStats,
  mergeProfiles,
} from '@mrak/core';
import type { Condition } from '@mrak/content-schema';
import type { TypedEventBus } from '../events/EventBus';
import { RECENT_EVENTS_LIMIT, type UiStore } from '../state/ui-store';
import { z } from 'zod';
import { writeEmergency } from '../storage/emergency';
import { loadProfile, saveProfile } from '../storage/profile';
import type { AccountSync, ProgressEntry } from '../storage/account-sync';
import type { PersistenceState } from '../storage/persistence';
import {
  SaveCorruptEntryError,
  type ManualSlot,
  type SaveEntry,
  type SaveEntryInput,
  type SaveStore,
  type SlotId,
} from '../storage/save-store';

/** Simulation step: 30 Hz is plenty for a clock in in-world minutes. */
export const FIXED_STEP_MS = 1000 / 30;
/** At most this many steps per frame (prevents the spiral of death after a hitch). */
export const MAX_STEPS_PER_FRAME = 5;
/** React sees snapshots at most this often. */
export const SNAPSHOT_INTERVAL_MS = 100;
/** Longest wait for a thumbnail before saving without a new one. */
export const THUMBNAIL_TIMEOUT_MS = 500;

export const START_ZONE = 'village';
/** Set by the last prologue scene (data/flags.json). */
const PROLOGUE_END = 'prologue-complete';

export type PauseReason =
  'focus' | 'menu' | 'loading' | 'panel' | 'talk' | 'pact' | 'creation' | 'dialogue';

export type LoadProblem = 'corrupt' | 'too-new';
export type LoadResult =
  | { ok: true }
  | { ok: false; problem: LoadProblem; failed: SaveEntry | null; fallback: SaveEntry | null };
export type SaveResult =
  { ok: true; entry: SaveEntry } | { ok: false; problem: 'night' | 'no-game' | 'failed' };
export type ImportResult =
  | { ok: true; entry: SaveEntry }
  | { ok: false; problem: 'corrupt' | 'too-new' | 'too-large' | 'failed' };

/** Captures a small image of the game view (data URL), or null. Provided by the Phaser layer. */
export type ThumbnailSource = () => Promise<string | null>;

export interface GameHostDeps {
  content: ContentDatabase;
  saves: SaveStore;
  store: UiStore;
  bus: TypedEventBus;
  /** Synchronous storage for the emergency backup on page close (localStorage). */
  emergency?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
  /** Asks the browser for persistent storage (called once, on the first game started). */
  requestPersistence?: () => Promise<PersistenceState>;
  /** Seed for new games (default: crypto-random). */
  seed?: () => number;
  /** Wall clock for save timestamps. */
  now?: () => Date;
  /** Where the Bloodline profile is kept on this device (localStorage). */
  profile?: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  /** Today's live seasons as the server publishes them (local date when offline). */
  seasons?: () => Promise<unknown>;
  /** Sends account progress (achievements, Bloodline, stats) to online-api; queued offline. */
  account?: AccountSync;
}

const SeasonsReply = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  active: z.array(z.string().max(64)).max(20),
});

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? 1834;
}

function entryInput(
  file: SaveFile,
  slot: SlotId,
  reason: AutosaveReason | null,
  thumbnail: string | null,
): SaveEntryInput {
  return {
    slot,
    reason,
    savedAt: file.savedAt,
    gameDate: file.meta.gameDate,
    zone: file.meta.zone,
    generation: file.meta.generation,
    playtimeMs: file.meta.playtimeMs,
    contentVersion: file.meta.contentVersion,
    thumbnail,
  };
}

export class GameHost {
  private game: Game | null = null;
  private accumulator = 0;
  private sinceFlush = 0;
  private dirty = false;
  private pendingEvents: CoreEvent[] = [];
  private readonly pauseReasons = new Set<PauseReason>();
  private unsubscribe: (() => void) | null = null;

  private policy = new AutosavePolicy();
  /** Serialized write queue: every save waits for the previous one. */
  private writes: Promise<unknown> = Promise.resolve();
  private autosaveQueued: Promise<void> | null = null;
  private thumbnailSource: ThumbnailSource | null = null;
  private lastThumbnail: string | null = null;
  private persistenceAsked = false;
  private readonly eventListeners = new Set<(events: readonly CoreEvent[]) => void>();
  private achievements: AchievementSystem | null = null;

  constructor(private readonly deps: GameHostDeps) {
    deps.store.setState({ profile: loadProfile(deps.profile) });
  }

  /** Buys a Bloodline node with Legacy (applies to the next guardian created). */
  buyBloodlineNode(id: string): boolean {
    const profile = this.deps.store.getState().profile;
    if (nodeBlocked(profile, this.deps.content, id) !== null) return false;
    this.setProfile(buyNode(profile, this.deps.content, id));
    this.sync([{ kind: 'node', key: id, at: this.now().getTime() }]);
    return true;
  }

  /** Bloodline nodes the profile owns that this content still has. */
  bloodline(): string[] {
    return this.deps.store
      .getState()
      .profile.nodes.filter((id) => this.deps.content.has('bloodline-nodes', id));
  }

  private sync(entries: ProgressEntry[]): void {
    if (entries.length > 0) void this.deps.account?.record(entries);
  }

  /**
   * Account progress of a batch (docs/systems/achievements.md): global stats, then every
   * achievement whose condition now holds — unlocked once, announced, kept outside any save.
   */
  private trackAccount(events: readonly CoreEvent[]): void {
    const before = this.deps.store.getState().profile;
    const stats = recordProfileStats(before, events, this.deps.content);
    const at = this.now().getTime();
    const { profile, events: unlocked } = this.achievements?.observe(stats, at) ?? {
      profile: stats,
      events: [],
    };
    if (profile === before) return;
    this.setProfile(profile);
    this.pendingEvents.push(...unlocked);
    const s = profile.stats;
    const b = before.stats;
    this.sync([
      ...unlocked.flatMap((e) =>
        e.type === 'achievement/unlocked'
          ? [{ kind: 'achievement' as const, key: e.payload.id, at }]
          : [],
      ),
      ...(s.nights > b.nights
        ? [{ kind: 'stat' as const, key: 'nights' as const, value: s.nights, at }]
        : []),
      ...(s.exorcisms > b.exorcisms
        ? [{ kind: 'stat' as const, key: 'exorcisms' as const, value: s.exorcisms, at }]
        : []),
      ...s.routes
        .filter((r) => !b.routes.includes(r))
        .map((key) => ({ kind: 'route' as const, key, at })),
      ...s.endings
        .filter((r) => !b.endings.includes(r))
        .map((key) => ({ kind: 'ending' as const, key, at })),
    ]);
  }

  /** Progress of a numeric condition in the running chronicle (achievement bars), or null. */
  conditionProgress(condition: Condition): { have: number; total: number } | null {
    return this.game?.conditionProgress(condition) ?? null;
  }

  /** Merges the account's progress (after signing in) into this device's profile. */
  async pullAccount(): Promise<void> {
    const remote = await this.deps.account?.pull(this.deps.content);
    if (remote) this.setProfile(mergeProfiles(this.deps.store.getState().profile, remote));
  }

  private setProfile(profile: Profile): void {
    this.deps.store.setState({ profile });
    saveProfile(this.deps.profile, profile);
  }

  /** Generations, Chronicle goals and live seasons reward the profile, each once. */
  private awardLegacy(events: readonly CoreEvent[], day: number): void {
    const award = (key: string, amount: number): void => {
      const before = this.deps.store.getState().profile;
      const after = awardLegacy(before, key, amount);
      if (after === before) return;
      this.setProfile(after);
      this.sync([{ kind: 'legacy', key, value: amount, at: this.now().getTime() }]);
    };
    for (const e of events) {
      if (e.type === 'lineage/generationEnded')
        award(`${e.payload.guardian}@${String(day)}`, e.payload.legacy);
      else if (e.type === 'endless/goalReached') award(`goal:${e.payload.goal}`, e.payload.legacy);
      else if (e.type === 'seasonal/activated') {
        award(`seasonal:${e.payload.event}@${String(e.payload.year)}`, e.payload.legacy);
        const title = this.deps.content.find('seasonal-events', e.payload.event)?.cosmeticKey;
        if (title) this.setProfile(grantTitle(this.deps.store.getState().profile, title));
      } else if (e.type === 'time/dawn')
        queueMicrotask(() => {
          this.activateSeasons();
        });
    }
  }

  private seasons: { date: string; active: string[] } | null = null;

  /** Asks the server which seasons are live (falls back to the local date offline). */
  async syncSeasons(): Promise<void> {
    let reply: unknown;
    try {
      reply = await this.deps.seasons?.();
    } catch {
      reply = null;
    }
    const parsed = SeasonsReply.safeParse(reply);
    const date = parsed.success ? parsed.data.date : new Date().toISOString().slice(0, 10);
    const active = parsed.success
      ? parsed.data.active
      : seasonalActive(this.deps.content, date).map((e) => e.id);
    this.seasons = { date, active };
    this.activateSeasons();
  }

  /** Activates each published season this content knows and whose window holds the date. */
  private activateSeasons(): void {
    const s = this.seasons;
    const snapshot = this.game?.snapshot();
    if (!s || !snapshot) return;
    const valid = new Set(seasonalActive(this.deps.content, s.date).map((e) => e.id));
    for (const id of s.active) {
      if (!valid.has(id)) continue;
      // Rejected at night or when already active this season: tried again at dawn.
      this.game?.dispatch({ type: 'activateSeasonal', event: id, date: s.date });
    }
  }

  get content(): ContentDatabase {
    return this.deps.content;
  }

  /**
   * "Report a bug" (docs/systems/testing.md → Bug reports): the game version always; the seed and
   * the current save only when the player ticked the consent box.
   */
  bugReport(withSave: boolean): { version: string; seed?: number; save?: string } {
    const version = this.deps.content.info.version;
    const file = withSave ? this.game?.save() : undefined;
    return file ? { version, seed: file.rng.seed, save: serializeSave(file) } : { version };
  }

  get running(): boolean {
    return this.game !== null;
  }

  /** Core events as they are flushed to React (onboarding, HUD notices). */
  subscribeEvents(listener: (events: readonly CoreEvent[]) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /** Evaluates a content condition against the running game (false without a game). */
  check(condition: Condition): boolean {
    return this.game?.check(condition) ?? false;
  }

  snapshot(): Snapshot | null {
    return this.game?.snapshot() ?? null;
  }

  // ------------------------------------------------- world queries (read-only, for Phaser)

  /** The variant a zone shows now (docs/systems/night-exploration.md). */
  zoneVariant(zone: string): string | null {
    return this.game?.zoneVariant(zone) ?? null;
  }

  /** Open path edges of a zone now. */
  openPaths(zone: string): ReadonlySet<string> {
    return this.game?.openPaths(zone) ?? new Set();
  }

  /** Perception effects of the guardian's Sanity tier (docs/systems/sanity.md). */
  perception(): Perception | null {
    return this.game?.perception() ?? null;
  }

  /** Ambient light now (level 0–1, tint, phase). */
  ambient(): Ambient | null {
    return this.game?.ambient() ?? null;
  }

  /** Equipped lantern radius in tiles (0 without one). */
  lanternRadius(): number {
    return this.game?.lanternRadius() ?? 0;
  }

  // ------------------------------------------------- village (docs/systems/villagers.md)

  /** Masked views of the villagers (never reveal a hidden possession). */
  villagers(): VillagerView[] {
    return this.game?.villagers() ?? [];
  }

  /** Where each villager is and what they do now, by id (for the world scene). */
  villagerActivities(): Record<string, VillagerActivity> {
    return this.game?.villagerActivities() ?? {};
  }

  // ------------------------------------------- items (docs/systems/inventory.md, collection.md)

  /** Pack slots, weight and encumbrance. */
  packLoad(): PackLoad | null {
    return this.game?.packLoad() ?? null;
  }

  /** What buying a tree node would do (docs/systems/progression.md T8). */
  previewTalent(tree: string, cell: string): TalentPreview | null {
    return this.game?.previewTalent(tree, cell) ?? null;
  }

  /** Tree nodes that can be bought now. */
  affordableTalents(): TalentPreview[] {
    return this.game?.affordableTalents() ?? [];
  }

  /** The dice pool a check would roll now. */
  checkPool(request: CheckRequest): CheckPool | null {
    return this.game?.checkPool(request) ?? null;
  }

  /** Talk tones offered now (virtue / sin markers, blocked ones). */
  toneOptions(): ToneOption[] {
    return this.game?.toneOptions() ?? [];
  }

  /** Debt remedies and whether they can be paid now. */
  debtRemedies(): ReturnType<Game['debtRemedies']> {
    return this.game?.debtRemedies() ?? [];
  }

  /** Whether a pact can be signed here and now. */
  pactStatus(pact: string): ReturnType<Game['pactStatus']> | null {
    return this.game?.pactStatus(pact) ?? null;
  }

  /** Gathering points of a zone and whether they can be gathered now. */
  gathering(zone: string): Record<string, GatherStatus> {
    return this.game?.gathering(zone) ?? {};
  }

  /** Collection progress by category. */
  buildPreviews(): BuildPreview[] {
    return this.game?.buildPreviews() ?? [];
  }

  heirCandidates(): string[] {
    return this.game?.heirCandidates() ?? [];
  }

  chronicleGoals(): GoalProgress[] {
    return this.game?.chronicleGoals() ?? [];
  }

  collectionProgress(): CategoryProgress[] {
    return this.game?.collectionProgress() ?? [];
  }

  /** Called by the Phaser loop with the real frame delta (ms). */
  update(deltaMs: number): void {
    const game = this.game;
    if (!game) return;
    if (this.pauseReasons.size === 0) {
      this.accumulator += deltaMs;
      let steps = 0;
      // Tolerance avoids losing a step to floating-point error (e.g. 5 × 33.33… ms).
      while (this.accumulator >= FIXED_STEP_MS - 1e-6 && steps < MAX_STEPS_PER_FRAME) {
        game.tick(FIXED_STEP_MS);
        this.accumulator -= FIXED_STEP_MS;
        steps += 1;
      }
      // After a long hitch, drop the backlog instead of fast-forwarding.
      if (steps === MAX_STEPS_PER_FRAME)
        this.accumulator = Math.max(0, Math.min(this.accumulator, FIXED_STEP_MS));
    }
    this.sinceFlush += deltaMs;
    if (this.dirty && this.sinceFlush >= SNAPSHOT_INTERVAL_MS) this.flush();
  }

  dispatch(command: Command): CommandResult {
    if (!this.game) return { ok: false, reason: 'no game running', events: [] };
    const result = this.game.dispatch(command);
    this.flush(); // player actions show up immediately
    return result;
  }

  // ---------------------------------------------------------------- lifecycle

  newGame(options: NewGameOptions & { guardian?: GuardianChoices } = {}): void {
    const seed = (this.deps.seed ?? randomSeed)();
    const { guardian, ...gameOptions } = options;
    const game = Game.newGame(
      { content: this.deps.content, seed, ...this.clockDeps() },
      { startZone: START_ZONE, ...gameOptions },
    );
    // The guardian chosen on the new-game screen (docs/systems/progression.md C1–C4).
    if (guardian)
      game.dispatch({ type: 'createGuardian', ...guardian, bloodline: this.bloodline() });
    this.attach(game);
    // Entering the first zone triggers the first autosave: a new game is never unsaved.
    this.game?.dispatch({ type: 'enterZone', zone: options.startZone ?? START_ZONE });
    this.started();
  }

  /** Loads a save. Never throws for bad saves: reports the problem and an intact fallback. */
  async load(id: string): Promise<LoadResult> {
    let failed: SaveEntry | null = null;
    try {
      const { entry, sealed } = await this.deps.saves.read(id);
      failed = entry;
      const game = Game.load(sealed.data, { content: this.deps.content, ...this.clockDeps() });
      this.attach(game);
      for (const warning of game.warnings) console.info(`[save] ${warning}`);
      this.started();
      return { ok: true };
    } catch (err) {
      if (!(err instanceof SaveError || err instanceof SaveCorruptEntryError)) throw err;
      console.warn('[save] cannot load', id, err.message);
      failed ??= await this.deps.saves.entry(id);
      const problem: LoadProblem = err instanceof SaveTooNewError ? 'too-new' : 'corrupt';
      return { ok: false, problem, failed, fallback: await this.deps.saves.fallbackFor(id) };
    }
  }

  /** Loads the most recent save. */
  async continueGame(): Promise<LoadResult> {
    const latest = await this.deps.saves.latest();
    if (!latest) return { ok: false, problem: 'corrupt', failed: null, fallback: null };
    return this.load(latest.id);
  }

  quitToMenu(): void {
    // Leaving is a checkpoint too; captured now, written in the background.
    // Failures are logged and shown by enqueueWrite.
    if (this.game) this.enqueueWrite('auto', 'suspend', this.capture()).catch(() => undefined);
    this.detach();
    this.pauseReasons.clear();
    this.deps.store.setState({
      screen: 'menu',
      menuPanel: 'main',
      snapshot: null,
      paused: false,
      pauseMenuOpen: false,
      mapOpen: false,
      villageOpen: false,
      belongings: null,
      character: null,
      journal: null,
      talking: null,
      pact: null,
      lastCheck: null,
      dialogue: null,
      mapSketch: null,
      mapGuardian: null,
    });
    this.deps.bus.emit('host:gameEnded', {});
  }

  // ---------------------------------------------------------------- saving

  /** True when the player may save by hand right now (by day only). */
  canManualSave(): boolean {
    const snapshot = this.game?.snapshot();
    return snapshot !== undefined && canManualSave(snapshot);
  }

  /** Manual or quick save. Refused at night (no save-scumming). */
  async saveManual(slot: ManualSlot | 'quick'): Promise<SaveResult> {
    if (!this.game) return { ok: false, problem: 'no-game' };
    if (!this.canManualSave()) {
      this.deps.store.setState({ saveActivity: { state: 'refused', reason: null } });
      return { ok: false, problem: 'night' };
    }
    try {
      return { ok: true, entry: await this.enqueueWrite(slot, null, this.capture()) };
    } catch (err) {
      console.warn('[save] save failed', err);
      return { ok: false, problem: 'failed' };
    }
  }

  /**
   * Autosave checkpoint. Systems call `await host.checkpoint('ritual')` before a ritual or an
   * exorcism; the save holds the state from before it began.
   */
  checkpoint(reason: AutosaveReason): Promise<void> {
    this.policy.request(reason);
    return this.requestAutosave();
  }

  /**
   * The page is being hidden or closed: write the synchronous emergency backup, then start an
   * ordinary autosave (which usually completes; the backup covers the case where it does not).
   */
  suspend(): void {
    if (!this.game) return;
    const captured = this.capture();
    writeEmergency(
      this.deps.emergency,
      entryInput(captured.file, 'auto', 'suspend', this.lastThumbnail),
      captured.sealed,
    );
    this.policy.request('suspend');
    void this.requestAutosave();
  }

  setThumbnailSource(source: ThumbnailSource | null): void {
    this.thumbnailSource = source;
  }

  /** Builds an export file (`.mrak`) for a save. */
  async exportSave(id: string): Promise<{ filename: string; text: string } | null> {
    try {
      const { entry, sealed } = await this.deps.saves.read(id);
      const date = entry.savedAt.slice(0, 10);
      return {
        filename: `mrak-${entry.slot}-${date}.mrak`,
        text: packExport(sealed, this.now()),
      };
    } catch (err) {
      console.warn('[save] export failed', err);
      return null;
    }
  }

  /** Imports an export file into a manual slot (untrusted input: fully validated first). */
  async importSave(text: string, slot: ManualSlot): Promise<ImportResult> {
    let unpacked: ReturnType<typeof unpackExport>;
    try {
      unpacked = unpackExport(text);
    } catch (err) {
      if (err instanceof SaveTooNewError) return { ok: false, problem: 'too-new' };
      if (err instanceof SaveCorruptError) return { ok: false, problem: 'corrupt' };
      if (err instanceof SaveError) return { ok: false, problem: 'too-large' };
      throw err;
    }
    try {
      const { save, sealed } = unpacked;
      const entry = await this.serialize(() =>
        this.deps.saves.write(entryInput(save, slot, null, null), sealed),
      );
      await this.refreshSaves();
      return { ok: true, entry };
    } catch (err) {
      console.warn('[save] import failed', err);
      return { ok: false, problem: 'failed' };
    }
  }

  async refreshSaves(): Promise<void> {
    const saves = await this.deps.saves.list();
    this.deps.store.setState({ saves, savesPersistent: this.deps.saves.persistent });
  }

  /** Resolves when every queued write has finished (tests, shutdown). */
  async idle(): Promise<void> {
    let current: Promise<unknown>;
    do {
      current = this.writes;
      await current.catch(() => undefined);
    } while (current !== this.writes);
  }

  // ---------------------------------------------------------------- pause

  setPaused(reason: PauseReason, paused: boolean): void {
    const before = this.pauseReasons.size > 0;
    if (paused) this.pauseReasons.add(reason);
    else this.pauseReasons.delete(reason);
    const after = this.pauseReasons.size > 0;
    if (before !== after) {
      this.game?.dispatch({ type: 'setPaused', paused: after });
      this.accumulator = 0;
    }
    this.deps.store.setState({ paused: after });
  }

  isPausedFor(reason: PauseReason): boolean {
    return this.pauseReasons.has(reason);
  }

  // ---------------------------------------------------------------- internals

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private clockDeps(): { now?: () => Date } {
    return this.deps.now ? { now: this.deps.now } : {};
  }

  /** Captures the game right now (synchronously). */
  private capture(): { file: SaveFile; sealed: SealedSave } {
    if (!this.game) throw new Error('no game running');
    const file = this.game.save();
    this.policy.noteSaved(file.meta.playtimeMs);
    return { file, sealed: sealSave(file) };
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writes.then(task, task);
    this.writes = run.catch(() => undefined);
    return run;
  }

  /** Captured state → thumbnail → atomic write, in the write queue. */
  private enqueueWrite(
    slot: SlotId,
    reason: AutosaveReason | null,
    captured: { file: SaveFile; sealed: SealedSave },
  ): Promise<SaveEntry> {
    this.deps.store.setState({ saveActivity: { state: 'saving', reason } });
    const thumbnailPromise = this.captureThumbnail();
    const task = this.serialize(async () => {
      const thumbnail = await thumbnailPromise;
      const entry = await this.deps.saves.write(
        entryInput(captured.file, slot, reason, thumbnail),
        captured.sealed,
      );
      await this.refreshSaves();
      return entry;
    });
    void task.then(
      () => {
        this.deps.store.setState({ saveActivity: { state: 'saved', reason } });
      },
      (err: unknown) => {
        console.warn('[save] write failed', err);
        this.deps.store.setState({ saveActivity: { state: 'failed', reason } });
      },
    );
    return task;
  }

  /** Coalesces autosave requests: one write per microtask, never two queued at once. */
  private requestAutosave(): Promise<void> {
    if (this.autosaveQueued) return this.autosaveQueued;
    const queued = Promise.resolve().then(async () => {
      this.autosaveQueued = null;
      const game = this.game;
      if (!game) return;
      const reason = this.policy.take(game.snapshot().playtimeMs);
      if (!reason) return;
      await this.enqueueWrite('auto', reason, this.capture()).catch(() => undefined);
    });
    this.autosaveQueued = queued;
    return queued;
  }

  private async captureThumbnail(): Promise<string | null> {
    const source = this.thumbnailSource;
    if (!source) return this.lastThumbnail;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        resolve(null);
      }, THUMBNAIL_TIMEOUT_MS);
    });
    try {
      const image = await Promise.race([source(), timeout]);
      if (image) this.lastThumbnail = image;
    } catch {
      // Keep the previous thumbnail.
    } finally {
      clearTimeout(timer);
    }
    return this.lastThumbnail;
  }

  private attach(game: Game): void {
    this.detach();
    this.game = game;
    this.accumulator = 0;
    this.achievements = new AchievementSystem(this.deps.content.all('achievements'), (c) =>
      game.check(c),
    );
    this.policy = new AutosavePolicy(game.snapshot().playtimeMs);
    this.unsubscribe = game.subscribe((snapshot, events) => {
      this.dirty = true;
      if (events.length > 0) {
        this.pendingEvents.push(...events);
        this.awardLegacy(events, snapshot.clock.day);
        this.trackAccount(events);
      }
      if (this.policy.observe(events, snapshot.playtimeMs)) void this.requestAutosave();
    });
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.game = null;
    this.pendingEvents = [];
    this.dirty = false;
    this.lastThumbnail = null;
  }

  private started(): void {
    this.pauseReasons.clear();
    this.flush();
    this.deps.store.setState({ screen: 'playing', paused: false, pauseMenuOpen: false });
    this.deps.bus.emit('host:gameStarted', {
      zone: this.game?.snapshot().currentZone ?? START_ZONE,
    });
    this.askPersistence();
    // Live seasons: fetched once per session, then offered at each dawn.
    if (this.seasons) this.activateSeasons();
    else void this.syncSeasons();
  }

  private askPersistence(): void {
    const request = this.deps.requestPersistence;
    if (this.persistenceAsked || !request) return;
    this.persistenceAsked = true;
    request()
      .then((storagePersistence) => {
        this.deps.store.setState({ storagePersistence });
      })
      .catch(() => undefined);
  }

  private flush(): void {
    const snapshot = this.game?.snapshot() ?? null;
    const recent = this.deps.store.getState().recentEvents;
    const flushed = this.pendingEvents;
    const recentEvents =
      flushed.length === 0 ? recent : [...recent, ...flushed].slice(-RECENT_EVENTS_LIMIT);
    this.pendingEvents = [];
    this.dirty = false;
    this.sinceFlush = 0;
    this.deps.store.setState({ snapshot, recentEvents });
    if (flushed.length > 0) for (const listener of this.eventListeners) listener(flushed);
    // 1779 → 1834 (docs/lore/prologue.md): once the last scene closes, the next guardian is chosen.
    if (
      snapshot?.flags[PROLOGUE_END] === true &&
      snapshot.flags[PROLOGUE] === true &&
      this.deps.store.getState().dialogue === null
    ) {
      this.quitToMenu();
      this.deps.store.setState({ menuPanel: 'new-game' });
    }
  }
}
