/**
 * Game: composes the core systems with constructor injection (no global singletons) and exposes
 * tick(dt), dispatch(command) and snapshot(). React and Phaser only talk to this class.
 */
import { Effect, type Condition } from '@mrak/content-schema';
import { z } from 'zod';
import { ConditionEvaluator } from './conditions';
import { ContentError, type ContentDatabase } from './content/database';
import {
  EffectApplier,
  EffectError,
  type EffectContext,
  type RuleHandler,
  type RuleRegistry,
} from './effects';
import { event, EventBus, type CoreEvent, type CoreEventMap } from './events';
import { createRandom, RandomStreams } from './random';
import {
  deserializeSave,
  metaOf,
  migrateSave,
  SAVE_FORMAT,
  SAVE_VERSION,
  SaveError,
  type SaveFile,
} from './save/save';
import { WorldStore, type StoreListener } from './state/store';
import {
  absMinute,
  crossesFearMoment,
  fearRules,
  FearRuleError,
  type FearContext,
} from './fear/common';
import { examineOccurrence } from './fear/director';
import { confrontMob } from './fear/hysteria';
import { atHome, changeSanity, perception, sanityShock, type Perception } from './fear/sanity';
import { fearAfterEvents, fearOverTime } from './fear/system';
import { creatureStrikes, nightAction } from './night/night';
import { makeSacrifice, sickenVillager, trustFactor } from './occult/pacts';
import { abandon, confront, expel, prepareItem, speakName, startExorcism } from './occult/exorcism';
import { grind } from './items/alchemy';
import { displayObject, recallMemory, removeObject, talkTo } from './items/collection';
import {
  gatherPotency,
  gatherStatus,
  markGathered,
  zoneGathering,
  type GatherStatus,
} from './items/gathering';
import {
  dropItem,
  giveItem,
  hoursCrossed,
  moveItem,
  packLoad,
  pickUp,
  useItem,
  whisper,
  type PackLoad,
} from './items/inventory';
import { discardPhoto, takePhotograph } from './items/photography';
import { DialogueError, resolveChoice } from './dialogue';
import { advanceQuests } from './quests';
import {
  abandonMystery,
  concludeMystery,
  linkClue,
  moveCard,
  MysteryError,
  mysteriesAfter,
  type MysteryContext,
} from './mysteries';
import { buildPool, resolveCheck, type CheckPool, type CheckRequest } from './guardian/checks';
import { createGuardian } from './guardian/creation';
import { payDebt, pactAvailable, remedies, rollCollection, signPact } from './guardian/debt';
import { blessGear, blessingsAtDawn, equipGear, upgradeGear } from './guardian/gear';
import { addNotice, markForHeir, removeNote, writeNote } from './guardian/journal';
import { milestonesFor } from './guardian/revelation';
import {
  absoluteMinute,
  ProgressionError,
  progressionRules,
  requireProgressionRules,
} from './guardian/rules';
import { practice, raiseAttribute, raiseSkillCap } from './guardian/skills';
import {
  affordableTalents,
  buyTalent,
  buyTree,
  previewTalent,
  type TalentPreview,
} from './guardian/talents';
import {
  actOnTags,
  chooseTone,
  resetVirtue,
  toneOptions,
  type ToneOption,
} from './guardian/virtue';
import { EQUIP_SLOTS } from './state/world-state';
import { effectiveStat, getStat, setStat } from './state/stats';
import { conditionProgress, type AchievementProgress } from './chronicle/achievements';
import {
  categoryProgress,
  CATEGORIES,
  collectionProgress,
  type CategoryProgress,
} from './items/progress';
import { ItemRuleError, itemRules, requireItemRules } from './items/rules';
import {
  cloneState,
  PhotoSubjectSchema,
  createInitialState,
  emptyZoneState,
  reconcileWithContent,
  type NewGameOptions,
  type Snapshot,
  type WorldState,
} from './state/world-state';
import { dayPhaseAt, jdnToJulian, julianToJdn, moonPhase } from './time/calendar';
import { ChronicleError, type ChronicleContext } from './chronicle/common';
import {
  addLabour,
  buildPreview,
  ensureBuilt,
  performRite,
  restlessDead,
  startBuilding,
  surfacePossessions,
  type BuildPreview,
} from './chronicle/growth';
import {
  applyBloodline,
  chooseHeir,
  heirCandidates,
  marry,
  retire,
  takeApprentice,
} from './chronicle/lineage';
import { chronicleAfter } from './chronicle/system';
import {
  chooseRelic,
  chronicleGoals,
  setDarkness,
  startEndless,
  type GoalProgress,
} from './chronicle/endless';
import { activateSeasonal } from './chronicle/seasonal';
import { applyCalendar, syncChapter } from './time/calendar-system';
import { GameClock } from './time/clock';
import { evaluatorAt, perceivedFear, villageRules, VillageRuleError } from './village/common';
import { buryVillager, encounterReturned } from './village/death';
import { villagerActivity, type VillagerActivity } from './village/routines';
import { assignTask } from './village/tasks';
import { crossesHour, simulateVillage, type Moment } from './village/village-sim';
import { villagerView, type VillagerView } from './village/views';
import { MAX_CELLS } from './world/exploration';
import { ambientLight, lanternRadius, MOON_PULLED_DOWN_FLAG, type Ambient } from './world/light';
import { openPaths } from './world/paths';
import {
  applyExploration,
  discoverPoi,
  elapsedMinutes,
  equipLantern,
  interactPoi,
  makeNoise,
  planExploration,
  revealZoneCells,
  setInDarkness,
  setLanternLit,
  WorldRuleError,
} from './world/world-system';

const Id = z.string().min(1);
const Potency = z.int().min(1).max(3).optional();
const Tags = z.array(z.string().max(64)).max(12);
const DifficultySchema = z.enum(['easy', 'average', 'hard', 'daunting', 'dire']);

/** Every command the outside world may send. Validated before use. */
export const CommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('applyEffects'),
    effects: z.array(Effect).min(1),
    source: Id.optional(),
  }),
  z.strictObject({
    type: z.literal('advanceTime'),
    minutes: z
      .number()
      .positive()
      .max(60 * 24 * 30),
  }),
  z.strictObject({ type: z.literal('setPaused'), paused: z.boolean() }),
  z.strictObject({ type: z.literal('setSpeed'), speed: z.number().positive().max(100) }),
  z.strictObject({ type: z.literal('enterZone'), zone: Id }),
  z.strictObject({
    type: z.literal('recordDecision'),
    id: Id,
    choice: z.string().min(1).max(200),
    context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    /** "virtue:<id>" / "sin:<id>" (docs/systems/progression.md V1). */
    tags: Tags.optional(),
  }),
  z.strictObject({ type: z.literal('useAbility'), ability: z.string().min(1) }),
  z.strictObject({ type: z.literal('triggerEvent'), event: Id }),
  // exploration (docs/systems/night-exploration.md, light.md)
  z.strictObject({ type: z.literal('equipLantern'), gear: Id.nullable() }),
  z.strictObject({ type: z.literal('setLanternLit'), lit: z.boolean() }),
  z.strictObject({ type: z.literal('setInDarkness'), dark: z.boolean() }),
  z.strictObject({ type: z.literal('makeNoise'), level: z.number().min(0).max(10) }),
  z.strictObject({
    type: z.literal('revealCells'),
    zone: Id,
    cells: z
      .array(
        z
          .int()
          .min(0)
          .max(MAX_CELLS - 1),
      )
      .min(1)
      .max(1024),
  }),
  z.strictObject({ type: z.literal('discoverPoi'), zone: Id, poi: Id }),
  z.strictObject({ type: z.literal('interactPoi'), zone: Id, poi: Id }),
  // village (docs/systems/villagers.md, tasks.md)
  z.strictObject({
    type: z.literal('assignTask'),
    villager: Id,
    slot: z.enum(['day', 'night']),
    task: Id.nullable(),
  }),
  z.strictObject({ type: z.literal('buryVillager'), villager: Id }),
  z.strictObject({ type: z.literal('encounterReturned'), villager: Id }),
  // items (docs/systems/inventory.md, alchemy.md, collection.md, photography.md)
  z.strictObject({
    type: z.literal('moveItem'),
    item: Id,
    potency: Potency,
    qty: z.int().min(1).max(999),
    to: z.enum(['pack', 'storage']),
  }),
  z.strictObject({
    type: z.literal('dropItem'),
    item: Id,
    potency: Potency,
    qty: z.int().min(1).max(999),
  }),
  z.strictObject({ type: z.literal('pickUp'), item: Id, potency: Potency }),
  z.strictObject({ type: z.literal('useItem'), item: Id, potency: Potency }),
  z.strictObject({
    type: z.literal('grind'),
    ingredients: z
      .array(z.strictObject({ item: Id, qty: z.int().min(1).max(10), potency: Potency }))
      .min(1)
      .max(6),
  }),
  z.strictObject({ type: z.literal('talkTo'), villager: Id, tone: Id.optional() }),
  z.strictObject({ type: z.literal('displayObject'), item: Id }),
  z.strictObject({ type: z.literal('removeObject'), item: Id }),
  z.strictObject({ type: z.literal('recallMemory'), object: Id }),
  z.strictObject({ type: z.literal('takePhotograph'), subject: PhotoSubjectSchema }),
  z.strictObject({ type: z.literal('discardPhoto'), id: z.int().min(1) }),
  // guardian progression (docs/systems/progression.md)
  z.strictObject({
    type: z.literal('createGuardian'),
    calling: Id,
    tree: Id,
    bonus: Id,
    virtue: Id,
    sin: Id,
    /** Bloodline nodes the account owns (applied to this guardian). */
    bloodline: z.array(Id).max(64).default([]),
  }),
  z.strictObject({ type: z.literal('raiseAttribute'), attribute: Id }),
  z.strictObject({ type: z.literal('raiseSkillCap'), skill: Id }),
  z.strictObject({ type: z.literal('buyTree'), tree: Id }),
  z.strictObject({
    type: z.literal('buyTalent'),
    tree: Id,
    cell: z.string().regex(/^[A-F][1-6]$/),
  }),
  z.strictObject({
    type: z.literal('rollCheck'),
    skill: Id,
    difficulty: DifficultySchema,
    context: Id.optional(),
    target: z.string().max(80).optional(),
  }),
  z.strictObject({ type: z.literal('payDebt'), remedy: Id }),
  z.strictObject({ type: z.literal('signPact'), pact: Id }),
  z.strictObject({ type: z.literal('equipGear'), slot: z.enum(EQUIP_SLOTS), gear: Id.nullable() }),
  z.strictObject({ type: z.literal('blessGear'), gear: Id, blessing: Id }),
  z.strictObject({ type: z.literal('upgradeGear'), gear: Id, upgrade: Id }),
  z.strictObject({ type: z.literal('writeNote'), text: z.string().min(1).max(2000) }),
  z.strictObject({ type: z.literal('removeNote'), id: z.int().min(1) }),
  z.strictObject({
    type: z.literal('dialogueChoice'),
    story: Id,
    options: z.array(Tags).min(1).max(12),
    wanted: z.int().min(0).max(11),
  }),
  z.strictObject({
    type: z.literal('markForHeir'),
    entry: z.string().min(1).max(120),
    heir: z.boolean(),
  }),
  // fear engine (docs/systems/hysteria.md, event-director.md, sanity.md)
  z.strictObject({
    type: z.literal('confrontMob'),
    approach: z.enum(['calm', 'steer', 'exploit']),
    target: Id.optional(),
  }),
  z.strictObject({
    type: z.literal('examineEvent'),
    occurrence: z.int().min(1),
    method: z.enum(['photograph', 'witness', 'relic']),
    villager: Id.optional(),
    item: Id.optional(),
  }),
  z.strictObject({ type: z.literal('rest'), minutes: z.int().min(30).max(720) }),
  // exorcism (docs/systems/exorcism.md)
  z.strictObject({ type: z.literal('startExorcism'), host: Id }),
  z.strictObject({ type: z.literal('prepareExorcism'), item: Id }),
  z.strictObject({ type: z.literal('confrontDemon') }),
  z.strictObject({ type: z.literal('speakName'), demon: Id, bind: z.boolean().default(false) }),
  z.strictObject({ type: z.literal('expel'), effort: z.enum(['press', 'hold']) }),
  z.strictObject({ type: z.literal('abandonExorcism') }),
  z.strictObject({ type: z.literal('makeSacrifice'), sacrifice: Id, target: Id.optional() }),
  // deduction board (docs/systems/mysteries.md)
  z.strictObject({
    type: z.literal('linkClue'),
    mystery: Id,
    clue: Id,
    proposition: z.string().min(3).max(80),
    linked: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('moveBoardCard'),
    mystery: Id,
    card: z.string().min(1).max(80),
    x: z.number(),
    y: z.number(),
  }),
  z.strictObject({
    type: z.literal('concludeMystery'),
    mystery: Id,
    culprit: Id,
    cause: Id,
    remedy: Id,
  }),
  z.strictObject({ type: z.literal('abandonMystery'), mystery: Id }),
  // night expedition (docs/systems/night-exploration.md, combat.md)
  z.strictObject({
    type: z.literal('nightAction'),
    encounter: z.int().min(1),
    action: z.enum(['flash', 'ritual', 'strike', 'dodge', 'flee', 'sneak']),
    item: Id.optional(),
  }),
  z.strictObject({ type: z.literal('creatureStrikes'), encounter: z.int().min(1) }),
  z.strictObject({ type: z.literal('build'), building: Id, shadow: Id.optional() }),
  z.strictObject({ type: z.literal('performRite'), rite: Id, option: Id }),
  z.strictObject({ type: z.literal('marry'), person: z.string().min(1).max(40) }),
  z.strictObject({ type: z.literal('takeApprentice'), person: z.string().min(1).max(40) }),
  z.strictObject({ type: z.literal('retire') }),
  z.strictObject({ type: z.literal('chooseHeir'), heir: z.string().min(1).max(40) }),
  /** The time-skip between chapters and generations (docs/systems/time-calendar.md rule 5). */
  z.strictObject({ type: z.literal('skipYears'), years: z.int().min(1).max(10) }),
  // the Endless Chronicle and live seasons (endless-chronicle.md, seasonal-events.md)
  z.strictObject({ type: z.literal('startEndless'), darkness: z.int().min(0).max(10) }),
  z.strictObject({ type: z.literal('setDarkness'), level: z.int().min(0).max(10) }),
  z.strictObject({ type: z.literal('chooseRelic'), relic: Id, on: z.boolean() }),
  z.strictObject({
    type: z.literal('activateSeasonal'),
    event: Id,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
]);
export type Command = z.infer<typeof CommandSchema>;

export type CommandResult =
  | { ok: true; events: readonly CoreEvent[] }
  | { ok: false; reason: string; events: readonly CoreEvent[] };

export interface GameDeps {
  content: ContentDatabase;
  random: RandomStreams;
  clock?: GameClock;
  bus?: EventBus<CoreEventMap>;
  rules?: RuleRegistry;
  effects?: EffectApplier;
  /** Real-world clock, used only for save timestamps. */
  now?: () => Date;
}

class CommandRejected extends Error {}

/** Set while Stana's last days (1779) are played (docs/lore/prologue.md). */
export const PROLOGUE = 'prologue-active';

/** Engine rules every game has (declared in flags.json "rules"). */
const BUILTIN_RULES: RuleRegistry = new Map([
  ['sicken-villager', (draft: WorldState, _params, ctx) => sickenVillager(draft, ctx.db)],
  [
    'sanity-shock',
    (draft: WorldState, params, ctx) => {
      try {
        const cause = String(params['cause'] ?? '');
        const events = sanityShock(draft, ctx.db, cause);
        if (cause === 'sacrifice')
          draft.decisions.push({ id: 'sacrifice', choice: ctx.source, at: ctx.now });
        return events;
      } catch (err) {
        if (err instanceof FearRuleError) throw new EffectError(err.message);
        throw err;
      }
    },
  ],
]);

/** Events after which collection progress may have grown. */
const PROGRESS_EVENTS: ReadonlySet<string> = new Set([
  'collection/found',
  'journal/collectibleGranted',
  'alchemy/discovered',
  'unlock/recipe',
  'photo/layerRevealed',
  'collection/memoryRecalled',
]);

export class Game {
  readonly content: ContentDatabase;
  readonly random: RandomStreams;
  readonly clock: GameClock;
  readonly events: EventBus<CoreEventMap>;
  /** Non-fatal notes from loading (e.g. content version changed since the save). */
  readonly warnings: string[] = [];
  private readonly rules: RuleRegistry;
  private readonly effects: EffectApplier;
  private readonly now: () => Date;
  private readonly store: WorldStore;

  constructor(deps: GameDeps, initial: WorldState) {
    this.content = deps.content;
    this.random = deps.random;
    this.clock = deps.clock ?? new GameClock();
    this.events = deps.bus ?? new EventBus<CoreEventMap>();
    // Built-in engine rules; the caller's handlers win on a name clash.
    this.rules = new Map([
      ...BUILTIN_RULES,
      ...this.chronicleRules(),
      ...(deps.rules ?? new Map()),
    ]);
    this.effects = deps.effects ?? new EffectApplier();
    this.now = deps.now ?? (() => new Date());
    this.store = new WorldStore(initial);
    // Procedural mysteries live in the save; the content database learns them back.
    for (const v of initial.endless.villagers) this.content.registerVillager(v);
    for (const m of initial.endless.generated) this.content.registerMystery(m);
  }

  /** A new chronicle from a seed. */
  static newGame(
    deps: Omit<GameDeps, 'random'> & { seed: number },
    options: NewGameOptions = {},
  ): Game {
    // The chronicle start (data/starts/default) fills what the options leave out.
    const start = deps.content.find('starts', options.startId ?? 'default');
    if (options.startId !== undefined && !start)
      throw new ContentError(`unknown start "${options.startId}"`);
    const state = createInitialState(deps.content, {
      ...(start
        ? {
            startZone: start.zone,
            startMinute: start.minute,
            ...(start.lantern !== undefined ? { lantern: start.lantern } : {}),
            ...(start.date !== undefined ? { start: start.date } : {}),
          }
        : {}),
      ...options,
    });
    syncChapter(state, deps.content, state.clock.day);
    const game = new Game({ ...deps, random: new RandomStreams(deps.seed) }, state);
    if (start && start.effects.length > 0) {
      const result = game.dispatch({
        type: 'applyEffects',
        effects: start.effects,
        source: 'start',
      });
      if (!result.ok) throw new ContentError(`start "${start.id}": ${result.reason}`);
    }
    // A chronicle that opens inside a festival: its rules and missions apply from the start.
    const chapter = state.calendar.chapterId;
    if (chapter !== null) {
      const f = deps.content.get('festivals', chapter);
      const effects = [...f.rules, ...f.quests.map((q) => ({ startQuest: q }))];
      if (effects.length > 0) {
        const result = game.dispatch({ type: 'applyEffects', effects, source: `festival:${f.id}` });
        if (!result.ok) throw new ContentError(`festival "${f.id}": ${result.reason}`);
      }
    }
    return game;
  }

  /** Restores a game from a save (any supported version; migrated and validated). */
  static load(save: unknown, deps: Omit<GameDeps, 'random'>): Game {
    const { save: file, migratedFrom } =
      typeof save === 'string' ? deserializeSave(save) : migrateSave(save);
    const state = reconcileWithContent(cloneState<WorldState>(file.state), deps.content);
    const game = new Game({ ...deps, random: RandomStreams.deserialize(file.rng) }, state);
    if (migratedFrom !== null)
      game.warnings.push(`save migrated from version ${String(migratedFrom)}`);
    if (file.meta.contentVersion !== deps.content.info.version) {
      game.warnings.push(
        `content version changed: save ${file.meta.contentVersion}, game ${deps.content.info.version}`,
      );
    }
    return game;
  }

  snapshot(): Snapshot {
    return this.store.snapshot;
  }

  subscribe(listener: StoreListener): () => void {
    return this.store.subscribe(listener);
  }

  /** Advances real time (milliseconds). Called by the game loop; core owns no timers. */
  tick(dtMs: number): readonly CoreEvent[] {
    if (!(dtMs > 0)) return [];
    const current = this.store.snapshot;
    const playtimeMs = current.playtimeMs + Math.min(dtMs, this.clock.maxTickMs);
    const { state: clock, events: clockEvents } = this.clock.tick(current.clock, dtMs);
    const minutes = elapsedMinutes(current.clock, clock);
    const plan =
      minutes > 0 && (current.light.lit || current.light.inDarkness || current.explorer.noise > 0)
        ? planExploration(current, this.content, minutes)
        : null;
    const simple = !plan || (plan.unitsUsed === 0 && !plan.wentOut && plan.sanityLoss === 0);
    const fearTick = fearRules(this.content) !== null && crossesFearMoment(current.clock, clock);
    if (clockEvents.length === 0 && simple && !fearTick && !crossesHour(current.clock, clock)) {
      // Fast path: only the clock, playtime, lantern fuel and noise change (structural sharing).
      this.store.commit({
        ...current,
        clock,
        playtimeMs,
        ...(plan ? { light: plan.light, explorer: plan.explorer } : {}),
      });
      return [];
    }
    const draft = cloneState(current) as WorldState;
    draft.clock = clock;
    draft.playtimeMs = playtimeMs;
    const events = applyCalendar(draft, this.content, clockEvents);
    if (plan) events.push(...applyExploration(draft, this.content, plan));
    events.push(...this.simulateVillage(draft, current.clock, clock));
    events.push(...this.fearOverTime(draft, current.clock, clock));
    events.push(
      ...whisper(draft, this.content, itemRules(this.content), hoursCrossed(current.clock, clock)),
    );
    events.push(...this.questsAfter(draft));
    events.push(...this.progress(draft, events));
    events.push(...this.fearAfter(draft, events));
    events.push(...mysteriesAfter(draft, this.mysteryContext(draft), events));
    events.push(...chronicleAfter(draft, this.chronicleContext(draft), events));
    return this.commit(draft, events);
  }

  /** Validates and executes a command atomically: either all of it applies, or nothing does. */
  dispatch(input: unknown): CommandResult {
    const parsed = CommandSchema.safeParse(input);
    const name =
      typeof input === 'object' && input !== null && 'type' in input
        ? String(input.type)
        : 'unknown';
    if (!parsed.success)
      return this.reject(name, parsed.error.issues[0]?.message ?? 'invalid command');

    const draft = cloneState(this.store.snapshot) as WorldState;
    const rngBefore = this.random.serialize();
    let events: CoreEvent[];
    try {
      events = this.execute(draft, parsed.data);
      events.push(...this.questsAfter(draft));
      events.push(...this.progress(draft, events));
      events.push(...this.fearAfter(draft, events));
      events.push(...mysteriesAfter(draft, this.mysteryContext(draft), events));
      events.push(...chronicleAfter(draft, this.chronicleContext(draft), events));
    } catch (err) {
      this.random.restore(rngBefore);
      if (
        err instanceof CommandRejected ||
        err instanceof WorldRuleError ||
        err instanceof VillageRuleError ||
        err instanceof ItemRuleError ||
        err instanceof ProgressionError ||
        err instanceof DialogueError ||
        err instanceof FearRuleError ||
        err instanceof MysteryError ||
        err instanceof ChronicleError ||
        err instanceof EffectError ||
        err instanceof ContentError ||
        err instanceof RangeError
      ) {
        return this.reject(name, err.message);
      }
      throw err;
    }
    return { ok: true, events: this.commit(draft, events) };
  }

  /** Perception effects of the current Sanity tier (empty when steady). */
  perception(): Perception {
    return perception(this.store.snapshot, this.content);
  }

  /** The variant a zone shows now: explicit (set by effects) or the first whose condition holds. */
  zoneVariant(zoneId: string): string {
    const zone = this.content.get('zones', zoneId);
    const state = this.store.snapshot;
    const explicit = state.zones[zoneId]?.variant;
    if (explicit) return explicit;
    // A query: never advances the game's RNG streams.
    const evaluator = new ConditionEvaluator(this.content, createRandom(0));
    const match = zone.variants.find(
      (v) => v.when !== undefined && evaluator.evaluate(v.when, state),
    );
    return match?.id ?? zone.defaultVariant;
  }

  /**
   * Read-only query for presentation (e.g. tutorial hints): evaluates a condition against the
   * current state. `chance` conditions use a throwaway stream so the game's RNG is never advanced.
   */
  check(condition: Condition): boolean {
    return new ConditionEvaluator(this.content, createRandom(0)).evaluate(
      condition,
      this.store.snapshot,
    );
  }

  /** Progress toward a numeric condition now (achievement bars), or null. */
  conditionProgress(condition: Condition): AchievementProgress | null {
    return conditionProgress(
      condition,
      new ConditionEvaluator(this.content, createRandom(0)).context(this.store.snapshot),
    );
  }

  /** Open path edges of a zone now (docs/systems/night-exploration.md → shifting paths). */
  openPaths(zoneId: string): ReadonlySet<string> {
    const zone = this.content.get('zones', zoneId);
    const state = this.store.snapshot;
    const evaluator = new ConditionEvaluator(this.content, createRandom(0));
    const { day, minute } = state.clock;
    return openPaths(zone.paths, {
      seed: this.random.seed,
      zone: zoneId,
      day,
      minute,
      phase: dayPhaseAt(minute, jdnToJulian(day).month),
      evaluate: (c) => evaluator.evaluate(c, state),
    });
  }

  /** Ambient light now (docs/systems/light.md, rule 5). */
  ambient(): Ambient {
    const { day, minute } = this.store.snapshot.clock;
    return ambientLight(
      minute,
      jdnToJulian(day).month,
      moonPhase(day).illumination,
      this.store.snapshot.flags[MOON_PULLED_DOWN_FLAG] === true,
    );
  }

  /** Radius of the equipped lantern in tiles (0 without one), whether lit or not. */
  lanternRadius(): number {
    const state = this.store.snapshot;
    const gear = state.light.lantern ? this.content.find('gear', state.light.lantern) : undefined;
    if (!gear) return 0;
    const { day, minute } = state.clock;
    return lanternRadius({
      base: gear.lightRadius ?? 0,
      phase: dayPhaseAt(minute, jdnToJulian(day).month),
      moonIllumination: moonPhase(day).illumination,
      pulledDown: state.flags[MOON_PULLED_DOWN_FLAG] === true,
    });
  }

  /** Masked views of every villager now (docs/systems/villagers.md rule 12), in content order. */
  villagers(): VillagerView[] {
    const rules = villageRules(this.content);
    if (!rules) return [];
    const state = this.store.snapshot;
    const evaluate = evaluatorAt(state, this.content, state.clock.day, state.clock.minute);
    return this.content
      .all('villagers')
      .flatMap((v) => villagerView(state, this.content, rules, v, evaluate) ?? []);
  }

  /** Where every villager is and what they do now (for the world scene), by villager id. */
  villagerActivities(): Record<string, VillagerActivity> {
    const rules = villageRules(this.content);
    if (!rules) return {};
    const state = this.store.snapshot;
    const { day, minute } = state.clock;
    const evaluate = evaluatorAt(state, this.content, day, minute);
    const out: Record<string, VillagerActivity> = {};
    for (const v of this.content.all('villagers'))
      out[v.id] = villagerActivity(state, this.content, rules, v, day, minute, evaluate);
    return out;
  }

  /** Pack slots, weight and encumbrance now. */
  packLoad(): PackLoad {
    return packLoad(this.store.snapshot, this.content, itemRules(this.content));
  }

  /** Gathering points of a zone and whether they can be gathered now. */
  gathering(zoneId: string): Record<string, GatherStatus> {
    return zoneGathering(this.store.snapshot, this.content, zoneId);
  }

  /** Collection progress by category (docs/systems/collection.md rule 6). */
  collectionProgress(): CategoryProgress[] {
    return collectionProgress(this.store.snapshot, this.content);
  }

  /** What buying a tree node would do (docs/systems/progression.md T8). */
  previewTalent(tree: string, cell: string): TalentPreview | null {
    const rules = progressionRules(this.content);
    if (!rules) return null;
    const state = this.store.snapshot;
    return previewTalent(state, this.content, rules, tree, cell, this.isNight(state as WorldState));
  }

  /** Tree nodes that can be bought now. */
  affordableTalents(): TalentPreview[] {
    const rules = progressionRules(this.content);
    const state = this.store.snapshot;
    if (!rules || state.guardian.callingId === null || this.isNight(state as WorldState)) return [];
    return affordableTalents(state, this.content, rules);
  }

  /** The dice pool a check would roll now (preview, no roll). */
  checkPool(request: CheckRequest): CheckPool | null {
    const rules = progressionRules(this.content);
    if (!rules || this.store.snapshot.guardian.callingId === null) return null;
    return buildPool(this.store.snapshot, this.content, rules, request);
  }

  /** Talk tones offered now, with blocked ones marked (V5). */
  toneOptions(): ToneOption[] {
    const rules = progressionRules(this.content);
    if (!rules) return [];
    const state = this.store.snapshot;
    const evaluator = new ConditionEvaluator(this.content, createRandom(0));
    return toneOptions(state, this.content, rules, (c) => evaluator.evaluate(c, state));
  }

  /** Debt remedies and whether they can be paid now (D5). */
  debtRemedies(): ReturnType<typeof remedies> {
    const state = this.store.snapshot;
    const evaluator = new ConditionEvaluator(this.content, createRandom(0));
    return remedies(state, this.content, (c) => evaluator.evaluate(c, state));
  }

  /** Whether a pact can be signed here and now (D6). */
  pactStatus(pact: string): ReturnType<typeof pactAvailable> {
    return pactAvailable(this.store.snapshot, this.content, pact);
  }

  save(): SaveFile {
    const state = cloneState(this.store.snapshot) as WorldState;
    return {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      savedAt: this.now().toISOString(),
      meta: metaOf(state, this.content.info),
      rng: this.random.serialize(),
      state,
    };
  }

  // -------------------------------------------------------------------------

  private effectContext(source: string, draft: WorldState): EffectContext {
    return {
      db: this.content,
      random: this.random,
      rules: this.rules,
      now: { day: draft.clock.day, minute: draft.clock.minute },
      source,
    };
  }

  private execute(draft: WorldState, command: Command): CoreEvent[] {
    switch (command.type) {
      case 'applyEffects':
        return this.effects.apply(
          draft,
          command.effects,
          this.effectContext(command.source ?? 'command', draft),
        );
      case 'confrontMob': {
        const ctx = this.requireFear(draft);
        return confrontMob(draft, ctx, command.approach, this.nowOf(draft), command.target);
      }
      case 'examineEvent':
        return examineOccurrence(
          draft,
          this.requireFear(draft),
          {
            occurrence: command.occurrence,
            method: command.method,
            villager: command.villager,
            item: command.item,
          },
          absMinute(draft.clock),
        );
      case 'rest': {
        const ctx = this.requireFear(draft);
        if (!atHome(draft, ctx.rules)) throw new CommandRejected('rest only at home');
        // Guardians face the night; Stana, in the prologue, sleeps through it at home.
        if (this.isNight(draft) && draft.flags[PROLOGUE] !== true)
          throw new CommandRejected('no rest at night');
        const out = this.passTime(draft, command.minutes);
        out.push(
          ...changeSanity(
            draft,
            this.content,
            (ctx.rules.sanity.restore.restPerHour * command.minutes) / 60,
          ),
        );
        return out;
      }
      case 'startExorcism':
        this.requireFear(draft);
        return startExorcism(draft, command.host);
      case 'prepareExorcism':
        return prepareItem(draft, this.requireFear(draft), command.item);
      case 'confrontDemon':
        return confront(draft, this.requireFear(draft));
      case 'speakName':
        return speakName(draft, this.requireFear(draft), command.demon, command.bind);
      case 'expel':
        return expel(draft, this.requireFear(draft), command.effort);
      case 'abandonExorcism':
        return abandon(draft, this.requireFear(draft));
      case 'linkClue':
        return linkClue(
          draft,
          this.content,
          command.mystery,
          command.clue,
          command.proposition,
          command.linked,
        );
      case 'moveBoardCard':
        return moveCard(draft, this.content, command.mystery, command.card, command.x, command.y);
      case 'concludeMystery':
        return concludeMystery(
          draft,
          this.mysteryContext(draft),
          command.mystery,
          command.culprit,
          command.cause,
          command.remedy,
        );
      case 'abandonMystery':
        return abandonMystery(draft, this.mysteryContext(draft), command.mystery);
      case 'nightAction':
        return nightAction(
          draft,
          this.requireFear(draft),
          command.encounter,
          command.action,
          command.item,
        );
      case 'build':
        return startBuilding(draft, this.chronicleContext(draft), command.building, command.shadow);
      case 'performRite':
        return performRite(
          draft,
          this.chronicleContext(draft),
          command.rite,
          command.option,
          (skill, difficulty) => this.riteCheck(draft, skill, difficulty),
        );
      case 'marry':
        return marry(draft, this.chronicleContext(draft), command.person);
      case 'takeApprentice':
        return takeApprentice(draft, this.chronicleContext(draft), command.person);
      case 'retire':
        return retire(draft, this.chronicleContext(draft));
      case 'chooseHeir':
        return chooseHeir(draft, this.chronicleContext(draft), command.heir);
      case 'skipYears': {
        if (draft.exorcism !== null || draft.night.encounters.some((e) => e.state === 'active'))
          throw new CommandRejected('not while the dark is at the door');
        const d = jdnToJulian(draft.clock.day);
        draft.village.year ??= d.year;
        const day = julianToJdn({
          year: d.year + command.years,
          month: d.month,
          day: Math.min(d.day, 28),
        });
        draft.clock = { ...draft.clock, day };
        draft.calendar = { chapterId: null, chapterStart: null, nightIndex: 0 };
        draft.village.rites = [];
        return [
          event('time/yearSkipped', { years: command.years }),
          ...applyCalendar(draft, this.content, [event('time/dayChanged', { day })]),
        ];
      }
      case 'startEndless':
        return startEndless(draft, this.chronicleContext(draft), command.darkness);
      case 'setDarkness':
        if (this.isNight(draft)) throw new CommandRejected('not at night');
        return setDarkness(draft, this.chronicleContext(draft), command.level);
      case 'chooseRelic':
        return chooseRelic(draft, this.content, command.relic, command.on);
      case 'activateSeasonal':
        // Offered the next in-game day: never interrupts a night.
        if (this.isNight(draft)) throw new CommandRejected('not at night');
        return activateSeasonal(draft, this.chronicleContext(draft), command.event, command.date);
      case 'creatureStrikes':
        return creatureStrikes(
          draft,
          this.requireFear(draft),
          command.encounter,
          this.nowOf(draft),
        );
      case 'makeSacrifice':
        return makeSacrifice(
          draft,
          this.requireFear(draft),
          command.sacrifice,
          command.target,
          this.nowOf(draft),
        );
      case 'triggerEvent':
        return this.effects.apply(
          draft,
          [{ triggerEvent: command.event }],
          this.effectContext('command', draft),
        );
      case 'advanceTime':
        return this.passTime(draft, command.minutes);
      case 'setPaused':
        draft.clock = this.clock.setPaused(draft.clock, command.paused);
        return [event('time/pausedChanged', { paused: command.paused })];
      case 'setSpeed':
        draft.clock = this.clock.setSpeed(draft.clock, command.speed);
        return [event('time/speedChanged', { speed: command.speed })];
      case 'enterZone': {
        this.content.get('zones', command.zone);
        const zone = (draft.zones[command.zone] ??= emptyZoneState());
        const firstVisit = !zone.discovered;
        zone.discovered = true;
        zone.visits += 1;
        draft.currentZone = command.zone;
        return [event('world/zoneEntered', { zone: command.zone, firstVisit })];
      }
      case 'recordDecision': {
        const at = { day: draft.clock.day, minute: draft.clock.minute };
        draft.decisions.push({
          id: command.id,
          choice: command.choice,
          at,
          ...(command.context ? { context: command.context } : {}),
        });
        const events = [
          event('state/decisionRecorded', { id: command.id, choice: command.choice, at }),
        ];
        const rules = progressionRules(this.content);
        if (rules && command.tags)
          events.push(...actOnTags(draft, this.content, rules, command.tags, this.applier(draft)));
        return events;
      }
      case 'equipLantern':
        return equipLantern(draft, this.content, command.gear);
      case 'setLanternLit':
        return setLanternLit(draft, this.content, command.lit);
      case 'setInDarkness':
        return setInDarkness(draft, command.dark);
      case 'makeNoise':
        return makeNoise(draft, command.level);
      case 'revealCells':
        return revealZoneCells(draft, this.content, command.zone, command.cells);
      case 'discoverPoi':
        return discoverPoi(draft, this.content, command.zone, command.poi);
      case 'interactPoi': {
        const def = this.content.get('zones', command.zone).pois.find((p) => p.id === command.poi);
        const gather = def?.gather;
        if (def && gather) {
          const status = gatherStatus(draft, this.content, command.zone, def);
          if (status === 'season') throw new CommandRejected('out of season');
          if (status === 'regrowing') throw new CommandRejected('not regrown');
        }
        const source = `poi:${command.zone}/${command.poi}`;
        const { events, effects } = interactPoi(draft, this.content, command.zone, command.poi);
        if (effects.length > 0)
          events.push(...this.effects.apply(draft, effects, this.effectContext(source, draft)));
        if (gather) {
          markGathered(draft, command.zone, command.poi);
          const { potency } = gatherPotency(
            draft,
            this.content,
            itemRules(this.content),
            gather.potency,
          );
          const given = giveItem(
            draft,
            this.content,
            itemRules(this.content),
            gather.item,
            gather.qty,
            {
              potency,
            },
          );
          events.push(
            ...given.events,
            ...this.effects.foundEffects(
              draft,
              gather.item,
              given.firstFound,
              this.effectContext(source, draft),
            ),
            event('gather/gathered', {
              zone: command.zone,
              poi: command.poi,
              item: gather.item,
              qty: gather.qty,
              potency,
            }),
            ...this.practiceUse(draft, 'gather', `${command.zone}/${command.poi}`),
          );
        }
        return events;
      }
      case 'assignTask': {
        const rules = this.requireVillage();
        const { day, minute } = draft.clock;
        return assignTask(
          draft,
          this.content,
          rules,
          command.villager,
          command.slot,
          command.task,
          evaluatorAt(draft, this.content, day, minute),
        );
      }
      case 'buryVillager':
        return buryVillager(draft, this.content, this.requireVillage(), command.villager);
      case 'moveItem':
        return moveItem(
          draft,
          this.content,
          itemRules(this.content),
          command.item,
          command.potency,
          command.qty,
          command.to,
        );
      case 'dropItem':
        return dropItem(
          draft,
          this.content,
          itemRules(this.content),
          command.item,
          command.potency,
          command.qty,
          this.isNight(draft),
        );
      case 'pickUp':
        return pickUp(draft, this.content, itemRules(this.content), command.item, command.potency);
      case 'useItem': {
        const used = useItem(
          draft,
          this.content,
          itemRules(this.content),
          command.item,
          command.potency,
        );
        return [
          ...used.events,
          ...this.effects.apply(
            draft,
            used.effects,
            this.effectContext(`item:${command.item}`, draft),
          ),
        ];
      }
      case 'grind': {
        const { day, minute } = draft.clock;
        const result = grind(
          draft,
          this.content,
          requireItemRules(this.content),
          command.ingredients,
          evaluatorAt(draft, this.content, day, minute),
        );
        const ctx = this.effectContext(
          result.recipe ? `recipe:${result.recipe.id}` : 'mortar',
          draft,
        );
        const events = [...result.events];
        for (const item of result.firstFound)
          events.push(...this.effects.foundEffects(draft, item, true, ctx));
        if (result.recipe?.onBrew)
          events.push(...this.effects.apply(draft, result.recipe.onBrew, ctx));
        events.push(...this.practiceUse(draft, 'grind'));
        events.push(...this.passTime(draft, result.minutes));
        return events;
      }
      case 'talkTo': {
        const rules = requireItemRules(this.content);
        const villageRule = this.requireVillage();
        const { day, minute } = draft.clock;
        const evaluate = evaluatorAt(draft, this.content, day, minute);
        const activity = villagerActivity(
          draft,
          this.content,
          villageRule,
          this.content.get('villagers', command.villager),
          day,
          minute,
          evaluate,
        );
        const talk = talkTo(
          draft,
          this.content,
          rules,
          command.villager,
          activity.activity,
          evaluate,
          perceivedFear(draft, this.content, villageRule, command.villager),
        );
        const toneEvents = command.tone
          ? this.speakInTone(draft, command.villager, command.tone, evaluate)
          : [];
        return [
          ...talk.events,
          ...toneEvents,
          ...this.practiceUse(draft, 'talk', command.villager),
          ...this.effects.apply(
            draft,
            talk.grant,
            this.effectContext(`talk:${command.villager}`, draft),
          ),
        ];
      }
      case 'displayObject':
        return displayObject(draft, this.content, requireItemRules(this.content), command.item);
      case 'removeObject':
        return removeObject(draft, this.content, requireItemRules(this.content), command.item);
      case 'recallMemory': {
        const memory = recallMemory(draft, this.content, command.object);
        return [
          ...memory.events,
          ...this.effects.apply(draft, memory.effects, this.effectContext(command.object, draft)),
        ];
      }
      case 'takePhotograph': {
        const { day, minute } = draft.clock;
        const photo = takePhotograph(
          draft,
          this.content,
          requireItemRules(this.content),
          command.subject,
          villageRules(this.content)?.zone ?? null,
          evaluatorAt(draft, this.content, day, minute),
        );
        return [
          ...photo.events,
          ...this.effects.apply(draft, photo.effects, this.effectContext('photograph', draft)),
          ...this.practiceUse(draft, 'photograph', JSON.stringify(command.subject)),
          ...this.passTime(draft, photo.minutes),
        ];
      }
      case 'discardPhoto':
        return discardPhoto(draft, command.id);
      case 'createGuardian': {
        const events = createGuardian(
          draft,
          this.content,
          requireProgressionRules(this.content),
          command,
          this.applier(draft),
        );
        return [
          ...events,
          ...applyBloodline(
            draft,
            this.chronicleContext(draft),
            command.bloodline,
            command.calling,
          ),
        ];
      }
      case 'raiseAttribute':
        return raiseAttribute(
          draft,
          this.content,
          requireProgressionRules(this.content),
          command.attribute,
        );
      case 'raiseSkillCap':
        return raiseSkillCap(
          draft,
          this.content,
          requireProgressionRules(this.content),
          command.skill,
        );
      case 'buyTree':
        return buyTree(draft, this.content, requireProgressionRules(this.content), command.tree);
      case 'buyTalent':
        return buyTalent(
          draft,
          this.content,
          requireProgressionRules(this.content),
          command.tree,
          command.cell,
          this.applier(draft),
        );
      case 'rollCheck': {
        if (draft.guardian.callingId === null) throw new CommandRejected('no guardian');
        const check = resolveCheck(
          draft,
          this.content,
          requireProgressionRules(this.content),
          {
            skill: command.skill,
            difficulty: command.difficulty,
            context: command.context,
            target: command.target,
          },
          this.random.get('checks'),
        );
        return [
          ...check.events,
          ...this.effects.apply(
            draft,
            check.effects,
            this.effectContext(`check:${check.result.context}`, draft),
          ),
        ];
      }
      case 'payDebt': {
        const { day, minute } = draft.clock;
        const paid = payDebt(draft, this.content, command.remedy, (c) =>
          evaluatorAt(draft, this.content, day, minute)(c),
        );
        return [
          ...paid.events,
          ...this.effects.apply(
            draft,
            paid.cost,
            this.effectContext(`remedy:${command.remedy}`, draft),
          ),
        ];
      }
      case 'signPact': {
        const pact = signPact(draft, this.content, command.pact, this.random.get('night'));
        return [
          ...pact.events,
          ...this.effects.apply(
            draft,
            pact.effects,
            this.effectContext(`pact:${command.pact}`, draft),
          ),
        ];
      }
      case 'equipGear':
        return equipGear(
          draft,
          this.content,
          requireProgressionRules(this.content),
          command.slot,
          command.gear,
        );
      case 'blessGear': {
        const blessed = blessGear(
          draft,
          this.content,
          requireProgressionRules(this.content),
          command.gear,
          command.blessing,
          this.random.get('checks'),
        );
        return [
          ...blessed.events,
          ...this.effects.apply(
            draft,
            blessed.check.effects,
            this.effectContext('check:blessing', draft),
          ),
        ];
      }
      case 'upgradeGear':
        return upgradeGear(
          draft,
          this.content,
          requireProgressionRules(this.content),
          command.gear,
          command.upgrade,
        );
      case 'writeNote':
        return writeNote(draft, requireProgressionRules(this.content), command.text);
      case 'removeNote':
        return removeNote(draft, command.id);
      case 'dialogueChoice': {
        const rules = progressionRules(this.content);
        const choice = resolveChoice(
          draft,
          this.content,
          rules,
          command.story,
          command.options,
          command.wanted,
          this.random.get('director'),
        );
        const tags = command.options[choice.chosen] ?? [];
        const at = { day: draft.clock.day, minute: draft.clock.minute };
        draft.decisions.push({
          id: `dialogue:${command.story}`,
          choice: String(choice.chosen),
          at,
        });
        return [
          ...choice.events,
          event('dialogue/choiceMade', {
            story: command.story,
            index: choice.chosen,
            tags: [...tags],
          }),
          ...(rules ? actOnTags(draft, this.content, rules, tags, this.applier(draft)) : []),
        ];
      }
      case 'markForHeir':
        return markForHeir(draft, this.content, command.entry, command.heir);
      case 'encounterReturned':
        return encounterReturned(draft, this.content, this.requireVillage(), command.villager);
      case 'useAbility': {
        const ability = draft.abilities[command.ability];
        if (!ability) throw new CommandRejected(`unknown ability "${command.ability}"`);
        if (ability.usesLeft <= 0)
          throw new CommandRejected(`ability "${command.ability}" has no uses left`);
        const now = absoluteMinute(draft.clock);
        if (ability.readyAt !== undefined && now < ability.readyAt)
          throw new CommandRejected('not ready');
        if (ability.cost?.light !== undefined) {
          if (draft.light.fuel < ability.cost.light) throw new CommandRejected('no light');
          draft.light.fuel -= ability.cost.light;
        }
        if (ability.cost?.sanity !== undefined)
          setStat(
            draft,
            this.content,
            'sanity',
            getStat(draft, this.content, 'sanity') - ability.cost.sanity,
          );
        if (ability.cooldown !== undefined) ability.readyAt = now + ability.cooldown;
        ability.usesLeft -= 1;
        return [
          event('state/abilityUsed', { ability: command.ability, usesLeft: ability.usesLeft }),
          ...this.effects.apply(draft, ability.effects, this.effectContext(ability.source, draft)),
        ];
      }
    }
  }

  /** Advances active quests (docs/systems/quests.md → Implementation). */
  private questsAfter(draft: WorldState): CoreEvent[] {
    const pending = this.content.all('quests').some((q) => q.startWhen && !draft.quests[q.id]);
    if (!pending && !Object.values(draft.quests).some((q) => q.status === 'active')) return [];
    const { day, minute } = draft.clock;
    return advanceQuests(
      draft,
      this.content,
      evaluatorAt(draft, this.content, day, minute),
      this.applier(draft),
    );
  }

  /** Runs effect lists with a source on the draft (for core modules). */
  private applier(draft: WorldState) {
    return (effects: readonly Effect[], source: string): CoreEvent[] =>
      this.effects.apply(draft, effects, this.effectContext(source, draft));
  }

  /** Practice by plain use (docs/systems/progression.md S1). */
  private practiceUse(
    draft: WorldState,
    use: 'gather' | 'talk' | 'photograph' | 'grind',
    target?: string,
  ): CoreEvent[] {
    const rules = progressionRules(this.content);
    const skill = rules?.skills.uses[use];
    if (!rules || !skill || draft.guardian.callingId === null) return [];
    return practice(draft, rules, skill, rules.skills.practice.use, { target, use: true });
  }

  /** The guardian speaks in a tone (V1–V5): the sin may take over; tags and affinity apply. */
  private speakInTone(
    draft: WorldState,
    villager: string,
    toneId: string,
    evaluate: (c: Condition) => boolean,
  ): CoreEvent[] {
    const rules = requireProgressionRules(this.content);
    const { tone, events } = chooseTone(
      draft,
      this.content,
      rules,
      toneId,
      this.random.get('director'),
      evaluate,
    );
    const v = draft.villagers[villager];
    if (v && tone.affinity !== 0) {
      const from = v.affinity['guardian'] ?? 0;
      const rate = this.content.hasStat('affinity-gain-rate')
        ? effectiveStat(draft, this.content, 'affinity-gain-rate')
        : 1;
      // A guardian marked by Corruption is trusted less.
      const trust = trustFactor(draft, this.content);
      const delta = tone.affinity > 0 ? Math.round(tone.affinity * rate * trust) : tone.affinity;
      const to = Math.max(-100, Math.min(100, from + delta));
      if (to !== from) {
        v.affinity['guardian'] = to;
        events.push(event('villager/affinityChanged', { villager, with: 'guardian', from, to }));
      }
    }
    if (tone.fear !== 0 && this.content.hasStat('fear')) {
      const [from, to] = setStat(
        draft,
        this.content,
        'fear',
        getStat(draft, this.content, 'fear', villager) + tone.fear,
        villager,
      );
      if (from !== to)
        events.push(event('state/statChanged', { stat: 'fear', villager, from, to }));
    }
    events.push(event('talk/toned', { villager, tone: tone.id }));
    events.push(...actOnTags(draft, this.content, rules, tone.tags, this.applier(draft)));
    if (tone.effects.length > 0)
      events.push(...this.applier(draft)(tone.effects, `tone:${tone.id}`));
    return events;
  }

  /**
   * Progression reactions to what just happened (docs/systems/progression.md): Notice decay and
   * blessing nights at dawn, the debt collection roll at dusk, virtue reset per chapter, Notice
   * for forbidden collectibles, and Revelation milestones.
   */
  private progress(draft: WorldState, events: readonly CoreEvent[]): CoreEvent[] {
    const rules = progressionRules(this.content);
    if (!rules || draft.guardian.callingId === null) return [];
    const db = this.content;
    const out: CoreEvent[] = [];
    for (const e of events) {
      if (e.type === 'time/dawn') {
        out.push(...addNotice(draft, db, -rules.notice.dawnDecay), ...blessingsAtDawn(draft));
      } else if (e.type === 'time/duskReached') {
        const { day, minute } = draft.clock;
        const collected = rollCollection(
          draft,
          db,
          rules,
          this.random.get('night'),
          evaluatorAt(draft, db, day, minute),
        );
        out.push(
          ...collected.events,
          ...this.effects.apply(
            draft,
            collected.effects,
            this.effectContext(collected.source, draft),
          ),
        );
      } else if (e.type === 'time/chapterStarted') {
        out.push(...resetVirtue(draft, rules));
      } else if (e.type === 'mystery/clueFound') {
        // Forbidden knowledge: some clues are seen by the demons too (§10).
        const clue = db
          .find('mysteries', e.payload.mystery)
          ?.clues.find((c) => c.id === e.payload.clue);
        if (clue?.forbidden) out.push(...addNotice(draft, db, rules.notice.forbiddenCollectible));
      } else if (e.type === 'journal/collectibleGranted') {
        if (db.find('collectibles', e.payload.collectible)?.forbidden)
          out.push(...addNotice(draft, db, rules.notice.forbiddenCollectible));
      }
    }
    out.push(...milestonesFor(draft, db, [...events, ...out]));
    return out;
  }

  /**
   * In-world time passes (waiting, brewing, a long exposure): the calendar, the lantern, the
   * village and cursed whispers advance exactly as ticking would.
   */
  private passTime(draft: WorldState, minutes: number): CoreEvent[] {
    if (minutes <= 0) return [];
    const before = { day: draft.clock.day, minute: draft.clock.minute };
    const { state, events } = this.clock.advance(draft.clock, minutes);
    draft.clock = state;
    const out = applyCalendar(draft, this.content, events);
    out.push(
      ...applyExploration(draft, this.content, planExploration(draft, this.content, minutes)),
    );
    out.push(...this.simulateVillage(draft, before, state));
    out.push(...this.fearOverTime(draft, before, state));
    out.push(...whisper(draft, this.content, itemRules(this.content), hoursCrossed(before, state)));
    return out;
  }

  private nowOf(draft: WorldState): { day: number; minute: number } {
    return { day: draft.clock.day, minute: draft.clock.minute };
  }

  private chronicleContext(draft: WorldState): ChronicleContext {
    return {
      db: this.content,
      apply: (effects, source) =>
        this.effects.apply(draft, effects, this.effectContext(source, draft)),
      rng: this.random.get('villagers'),
      checks: this.random.get('checks'),
      fear: this.fearContext(draft),
    };
  }

  /** A rite's check, rolled with its omen (the omen's effects apply). */
  private riteCheck(
    draft: WorldState,
    skill: string,
    difficulty: string,
  ): { success: boolean; events: CoreEvent[] } {
    if (draft.guardian.callingId === null) throw new CommandRejected('no guardian yet');
    const r = resolveCheck(
      draft,
      this.content,
      requireProgressionRules(this.content),
      { skill, difficulty: difficulty as CheckRequest['difficulty'] },
      this.random.get('checks'),
    );
    return {
      success: r.result.success,
      events: [
        ...r.events,
        ...this.effects.apply(draft, r.effects, this.effectContext(`rite:${skill}`, draft)),
      ],
    };
  }

  /** Engine rules of the long-term systems (declared in flags.json "rules"). */
  private chronicleRules(): [string, RuleHandler][] {
    return [
      [
        'construction-labour',
        (draft, params) =>
          addLabour(draft, this.chronicleContext(draft), Number(params['days'] ?? 1)),
      ],
      [
        'start-with-watchtower',
        (draft) => ensureBuilt(draft, this.chronicleContext(draft), 'watchtower'),
      ],
      ['surface-possessions', (draft) => surfacePossessions(draft)],
      ['restless-dead', (draft) => restlessDead(draft)],
    ];
  }

  /** The next level of every building and whether it can start. */
  buildPreviews(): BuildPreview[] {
    const s = this.store.snapshot;
    return this.content.all('buildings').map((b) => buildPreview(s, this.content, b.id));
  }

  heirCandidates(): string[] {
    return heirCandidates(this.store.snapshot, this.content);
  }

  chronicleGoals(): GoalProgress[] {
    return chronicleGoals(this.store.snapshot, this.content);
  }

  /** The fear engine's view of this game (null without fear rules). */
  private fearContext(draft: WorldState): FearContext | null {
    const rules = fearRules(this.content);
    if (!rules) return null;
    return {
      db: this.content,
      rules,
      apply: (effects, source) =>
        this.effects.apply(draft, effects, this.effectContext(source, draft)),
      random: (stream) => this.random.get(stream),
    };
  }

  private mysteryContext(draft: WorldState): MysteryContext {
    return {
      db: this.content,
      apply: (effects, source) =>
        this.effects.apply(draft, effects, this.effectContext(source, draft)),
      rng: this.random.get('checks'),
    };
  }

  private requireFear(draft: WorldState): FearContext {
    const ctx = this.fearContext(draft);
    if (!ctx) throw new CommandRejected('this content has no fear rules');
    return ctx;
  }

  private fearOverTime(draft: WorldState, from: Moment, to: Moment): CoreEvent[] {
    // The prologue is a story, not a night of the guardian: no director, no expeditions.
    if (draft.flags[PROLOGUE] === true) return [];
    const ctx = this.fearContext(draft);
    return ctx ? fearOverTime(draft, ctx, from, to) : [];
  }

  private fearAfter(draft: WorldState, events: readonly CoreEvent[]): CoreEvent[] {
    if (draft.flags[PROLOGUE] === true) return [];
    const ctx = this.fearContext(draft);
    return ctx ? fearAfterEvents(draft, ctx, events) : [];
  }

  private isNight(state: WorldState): boolean {
    return dayPhaseAt(state.clock.minute, jdnToJulian(state.clock.day).month) === 'night';
  }

  private requireVillage() {
    const rules = villageRules(this.content);
    if (!rules) throw new CommandRejected('this content has no village');
    return rules;
  }

  /** Runs the village between two moments (no-op without village rules). */
  private simulateVillage(draft: WorldState, from: Moment, to: Moment): CoreEvent[] {
    const rules = villageRules(this.content);
    // 1779: the villagers of 1834 are not born yet.
    if (!rules || draft.flags[PROLOGUE] === true) return [];
    return simulateVillage(
      draft,
      {
        db: this.content,
        rules,
        // Village work comes home: outputs go to the house store.
        apply: (effects, source) =>
          this.effects.apply(draft, effects, {
            ...this.effectContext(source, draft),
            itemTarget: 'storage',
          }),
      },
      { day: from.day, minute: from.minute },
      { day: to.day, minute: to.minute },
    );
  }

  /** Commits a draft with its events (plus collection progress); returns all the events. */
  private commit(draft: WorldState, events: readonly CoreEvent[]): CoreEvent[] {
    const all = [...events, ...this.progressEvents(this.store.snapshot, draft, events)];
    this.store.commit(draft, all);
    for (const e of all) this.events.emit(e.type, e.payload);
    return all;
  }

  /** `collection/progressed` and `collection/completed` for categories that grew. */
  private progressEvents(
    before: Snapshot,
    after: WorldState,
    events: readonly CoreEvent[],
  ): CoreEvent[] {
    if (!events.some((e) => PROGRESS_EVENTS.has(e.type))) return [];
    const out: CoreEvent[] = [];
    for (const category of CATEGORIES) {
      const was = categoryProgress(before, this.content, category);
      const now = categoryProgress(after, this.content, category);
      if (now.have <= was.have) continue;
      out.push(event('collection/progressed', { category, have: now.have, total: now.total }));
      if (now.have >= now.total && was.have < was.total)
        out.push(event('collection/completed', { category }));
    }
    return out;
  }

  private reject(command: string, reason: string): CommandResult {
    const rejected = event('game/commandRejected', { command, reason });
    this.events.emit(rejected.type, rejected.payload);
    return { ok: false, reason, events: [rejected] };
  }
}

export { SaveError };
