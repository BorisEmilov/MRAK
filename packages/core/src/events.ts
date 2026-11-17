/**
 * Typed event bus for core domain events (`<domain>/<pastTense>`, see docs/systems/README.md).
 * This is the core bus; the game layer forwards a subset of these to its UI EventBus.
 */
import type { CheckResult } from './guardian/checks';
import type { GameTime } from './state/world-state';
import type { DayPhase } from './time/calendar';

export type { GameTime };

export interface CoreEventMap {
  // state
  'state/flagSet': { flag: string };
  'state/flagCleared': { flag: string };
  'state/statChanged': { stat: string; villager?: string; from: number; to: number };
  'state/counterChanged': { counter: string; from: number; to: number };
  'state/decisionRecorded': { id: string; choice: string; at: GameTime };
  'state/modifierAdded': { source: string };
  'state/abilityGranted': { ability: string; uses: number; per: string };
  'state/abilityUsed': { ability: string; usesLeft: number };
  'state/narrated': { key: string };
  // world
  'world/zoneEntered': { zone: string; firstVisit: boolean };
  'world/zoneVariantChanged': { zone: string; variant: string };
  'world/poiDiscovered': { zone: string; poi: string };
  'world/poiInteracted': { zone: string; poi: string; first: boolean };
  // light
  'light/lanternEquipped': { lantern: string | null };
  'light/lanternLit': { lit: boolean };
  /** A unit of oil was poured into the lantern; `left` units remain in the inventory. */
  'light/oilPoured': { left: number };
  /** The lantern ran out of oil. */
  'light/lanternOut': Record<string, never>;
  'light/darknessChanged': { dark: boolean };
  'light/darknessTick': { loss: number; sanity: number };
  'villager/affinityChanged': { villager: string; with: string; from: number; to: number };
  'villager/statusChanged': { villager: string; from: string; to: string };
  'villager/panicked': { villager: string };
  'villager/died': { villager: string; cause: string };
  'villager/buried': { villager: string; proper: boolean };
  'villager/returned': { villager: string };
  'villager/laidToRest': { villager: string };
  'villager/returnedAttacked': { villager: string; sanity: number };
  'villager/secretRevealed': { villager: string; secret: string };
  'village/mealShort': { villagers: string[] };
  'village/coldNight': { homes: string[] };
  // tasks (docs/systems/tasks.md)
  'task/assigned': { villager: string; slot: 'day' | 'night'; task: string | null };
  'task/completed': { villager: string; task: string; batches: number };
  'task/delivered': { items: Record<string, number> };
  'task/stalled': { villager: string; task: string; item: string };
  'task/interrupted': { villager: string; task: string; cause: string };
  'inventory/itemAdded': { item: string; qty: number; to: 'pack' | 'storage' | 'ground' };
  'inventory/itemRemoved': { item: string; qty: number };
  'inventory/moved': { item: string; qty: number; to: 'pack' | 'storage' };
  'inventory/dropped': { item: string; qty: number; zone: string };
  'inventory/pickedUp': { item: string; qty: number; zone: string };
  'inventory/full': { item: string; qty: number; where: 'storage' | 'ground' };
  'inventory/used': { item: string; potency: number };
  'gather/gathered': { zone: string; poi: string; item: string; qty: number; potency: number };
  'alchemy/brewed': { recipe: string; doses: number; potency: number };
  'alchemy/discovered': { recipe: string };
  'alchemy/failed': { hint: string };
  'villager/talked': {
    villager: string;
    tale: string | null;
    affinity: number;
    mood: 'calm' | 'uneasy' | 'afraid';
  };
  'collection/found': { item: string };
  'collection/memoryRecalled': { object: string; scene: string | null; first: boolean };
  'collection/progressed': { category: string; have: number; total: number };
  'collection/completed': { category: string };
  'cabinet/displayed': { item: string };
  'cabinet/removed': { item: string };
  'cabinet/setCompleted': { set: string };
  'cabinet/setBroken': { set: string };
  'photo/taken': { id: number; layers: string[] };
  'photo/layerRevealed': { layer: string };
  'photo/discarded': { id: number };
  'journal/collectibleGranted': { collectible: string };
  'unlock/tree': { tree: string };
  'unlock/recipe': { recipe: string };
  'quest/started': { quest: string; stage: string };
  'quest/failed': { quest: string; by?: string };
  'quest/stageAdvanced': { quest: string; stage: string };
  'quest/completed': { quest: string };
  'quest/blocked': { quest: string; by: string };
  'quest/noReturn': { quest: string; stage: string };
  'dialogue/choiceMade': { story: string; index: number; tags: string[] };
  'mystery/started': { mystery: string };
  'mystery/clueFound': { mystery: string; clue: string };
  'mystery/clueRetracted': { mystery: string; clue: string };
  'mystery/linked': { mystery: string; clue: string; proposition: string; linked: boolean };
  /** The final act was carried out. `correct` is for core and tests: the UI never shows it. */
  'mystery/concluded': {
    mystery: string;
    culprit: string;
    action: 'accuse' | 'exorcise' | 'burn' | 'exhume' | 'confront';
    correct: boolean;
  };
  'mystery/unsolved': { mystery: string };
  'debt/added': { source: string; amount: number; total: number };
  /** Hidden from the UI: possession is never revealed by events. */
  'possession/began': { demon: string; host: string };
  /** Hidden from the UI. */
  'possession/stageAdvanced': { demon: string; host: string; stage: number };
  /** A visible symptom — real, or false in an unpossessed villager. */
  'possession/symptomSeen': { villager: string; symptom: string };
  'possession/ended': { demon: string; host: string; how: 'cast-out' | 'bound' };
  'journal/nameFragmentFound': { demon: string; fragment: string };
  'journal/trueNameComposed': { demon: string };
  // exorcism (docs/systems/exorcism.md)
  'exorcism/started': { host: string };
  'exorcism/phaseChanged': { phase: 'preparation' | 'confrontation' | 'naming' | 'expulsion' };
  'exorcism/prepared': { item: string };
  'exorcism/taunted': { key: string; params: Record<string, string> };
  'exorcism/round': { round: number; progress: number };
  'exorcism/succeeded': { host: string };
  'exorcism/bound': { host: string };
  'exorcism/failed': { host: string };
  /** Nothing answered: there was no demon in that host. */
  'exorcism/empty': { host: string };
  'exorcism/demonJumped': { to: string };
  'director/eventTriggered': { event: string };
  /** A director event happened. Its category is never part of the payload (pillar 4). */
  'director/eventFired': { event: string; occurrence: number; zone: string | null };
  'director/peakReached': { event: string; tension: number };
  /** Probabilistic evidence about an occurrence: something was there, or nothing. */
  'director/evidenceFound': {
    occurrence: number;
    method: 'photograph' | 'witness' | 'relic';
    presence: boolean;
  };
  // sanity & hysteria (docs/systems/sanity.md, hysteria.md)
  'sanity/tierChanged': { from: number; to: number };
  'sanity/broken': { breaks: number };
  'hysteria/rumourSpread': { target: string };
  'hysteria/accusationMade': { target: string };
  'hysteria/mobFormed': { target: string; size: number };
  'hysteria/mobSteered': { from: string; to: string };
  'hysteria/mobDispersed': { target: string; reason: 'calmed' | 'target-died' };
  'hysteria/trialHeld': { target: string; verdict: 'spared' | 'beaten' | 'lynched' };
  'hysteria/lynching': { victim: string; innocent: boolean };
  'rule/invoked': {
    rule: string;
    params: Readonly<Record<string, string | number | boolean>>;
    handled: boolean;
  };
  // guardian progression (docs/systems/progression.md)
  'guardian/created': { calling: string; tree: string; virtue: string; sin: string };
  'attribute/raised': { attribute: string; to: number; cost: number };
  'skill/practiced': { skill: string; points: number };
  'skill/rankUp': { skill: string; rank: number };
  'skill/readyToGrow': { skill: string };
  'skill/capRaised': { skill: string; cap: number; cost: number };
  'revelation/awarded': { milestone: string; amount: number; reasonKey: string; target?: string };
  'revelation/spent': { target: string; amount: number; left: number };
  'tree/bought': { tree: string; cost: number };
  'talent/bought': { tree: string; cell: string; talent: string; cost: number };
  'check/resolved': CheckResult;
  'debt/collected': {
    collection: string;
    source: string;
    creditor: string;
    severity: string;
    descKey: string;
  };
  'debt/paid': { remedy: string; creditor: string; amount: number; total: number };
  'pact/signed': { pact: string; creditor: string };
  /** A hidden clause took effect: the player discovers it now. */
  'pact/clauseTriggered': { pact: string; clause: string };
  'pact/sinImposed': { pact: string; sin: string };
  'faction/angered': { faction: string; by: string; from: number; to: number };
  // night expedition (docs/systems/night-exploration.md, combat.md)
  'night/started': { candidates: number };
  'night/encounterSpawned': { encounter: number; creature: string; zone: string; poi: string };
  'night/flashed': { encounter: number };
  'night/actionResolved': {
    encounter: number;
    action: 'flash' | 'ritual' | 'strike' | 'dodge' | 'flee' | 'sneak';
    success: boolean;
  };
  'night/encounterEnded': {
    encounter: number;
    creature: string;
    how: 'active' | 'banished' | 'evaded' | 'defeated';
  };
  'night/dodged': { encounter: number };
  'night/hurt': { encounter: number; health: number };
  'night/originFound': { zone: string; poi: string };
  'night/originEmpty': { zone: string; poi: string };
  'night/completed': { day: number };
  'village/alert': { reason: 'death' | 'mob' | 'event' | 'attack' };
  'guardian/lastBreath': { health: number };
  'guardian/died': { cause: string };
  'lineage/heirNeeded': { deaths: number };
  'lineage/generationEnded': {
    guardian: string;
    cause: 'died' | 'retired' | 'old-age';
    legacy: number;
  };
  'lineage/heirChosen': { heir: string; generation: number };
  'lineage/familyChanged': { person: string; role: string };
  'lineage/lineEnded': { generation: number };
  'festival/ritePerformed': { festival: string; rite: string; option: string; success: boolean };
  'village/buildStarted': { building: string; level: number };
  'village/buildingBuilt': { building: string; level: number };
  'village/prosperityChanged': { from: number; to: number };
  'village/residentArrived': { person: string; origin: 'born' | 'outsider' };
  'village/residentLeft': { person: string; how: 'died' | 'fled' };
  'village/yearTurned': { year: number; population: number };
  'endless/unlocked': { route: string };
  /** Account-level, emitted by the host's AchievementSystem (docs/systems/achievements.md). */
  'achievement/unlocked': { id: string };
  'endless/started': { darkness: number };
  'endless/darknessChanged': { level: number };
  'endless/relicUnlocked': { relic: string };
  'endless/relicChosen': { relic: string; on: boolean };
  'endless/yearStarted': { year: number; darkness: number };
  'endless/mysteryGenerated': { mystery: string };
  'endless/harvest': { harvest: string };
  'endless/goalReached': { goal: string; legacy: number };
  'seasonal/activated': { event: string; year: number; legacy: number };
  'sacrifice/made': { sacrifice: string; target: string | null };
  'sacrifice/witnessed': { sacrifice: string };
  'sacrifice/shadowClaimed': { villager: string };
  'virtue/acted': { virtue: string; acts: number };
  'sin/acted': { sin: string };
  'sin/tookOver': { sin: string; wanted: string; chosen: string };
  'talk/toned': { villager: string; tone: string };
  'gear/equipped': { slot: string; gear: string | null };
  'gear/blessed': { gear: string; blessing: string; bonus: number };
  'gear/blessingFailed': { gear: string; blessing: string };
  'gear/blessingExpired': { gear: string; blessing: string };
  'gear/upgraded': { gear: string; upgrade: string };
  'journal/learned': { kind: 'demon' | 'creature'; id: string; entry: string };
  'journal/noteWritten': { id: number };
  'journal/noteRemoved': { id: number };
  'journal/heirMarked': { entry: string; heir: boolean };
  // time
  'time/dayChanged': { day: number };
  'time/phaseChanged': { from: DayPhase; to: DayPhase };
  'time/dawn': GameTime;
  'time/dayStarted': GameTime;
  'time/duskReached': GameTime;
  'time/nightStarted': GameTime & { nightIndex: number };
  'time/midnight': GameTime;
  'time/witchingMinute': GameTime;
  'time/cockCrow': GameTime;
  'time/chapterStarted': { chapter: string; day: number };
  'time/chapterEnded': { chapter: string; day: number };
  'time/yearSkipped': { years: number };
  'time/pausedChanged': { paused: boolean };
  'time/speedChanged': { speed: number };
  // game
  'game/commandRejected': { command: string; reason: string };
}

export type CoreEventType = keyof CoreEventMap;

/** A discriminated union of every core event. */
export type CoreEvent = {
  [K in CoreEventType]: { type: K; payload: CoreEventMap[K] };
}[CoreEventType];

export function event<K extends CoreEventType>(type: K, payload: CoreEventMap[K]): CoreEvent {
  return { type, payload } as CoreEvent;
}

type Handler<M, K extends keyof M> = (payload: M[K]) => void;
type AnyHandler<M> = (event: { [K in keyof M]: { type: K; payload: M[K] } }[keyof M]) => void;

/** Generic typed event bus. One instance per Game — never a global singleton. */
export class EventBus<M extends object> {
  private readonly handlers = new Map<keyof M, Set<(payload: never) => void>>();
  private readonly anyHandlers = new Set<AnyHandler<M>>();

  on<K extends keyof M>(type: K, handler: Handler<M, K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  /** Receives every event (useful for logs, replays and forwarding). */
  onAny(handler: AnyHandler<M>): () => void {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    for (const handler of [...(this.handlers.get(type) ?? [])]) (handler as Handler<M, K>)(payload);
    const evt = { type, payload } as Parameters<AnyHandler<M>>[0];
    for (const handler of [...this.anyHandlers]) handler(evt);
  }

  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }
}
