/**
 * Talking, the cabinet and memories (docs/systems/collection.md rules 1–5).
 */
import type { Condition, Effect, ItemRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import type { WorldState } from '../state/world-state';
import { completeSets } from './modifiers';
import { itemCount, takeItem } from './inventory';
import { atHome, ItemRuleError, type ReadState } from './rules';

/** Activities during which a villager will not talk (asleep, hidden, away, dead). */
const SILENT: ReadonlySet<string> = new Set(['sleep', 'hide', 'absent', 'haunt', 'sleepwalk']);

/** The collectible a villager would tell now, if any. */
export function taleOf(
  state: ReadState,
  db: ContentDatabase,
  villager: string,
  evaluate: (c: Condition) => boolean,
): string | null {
  const affinity = state.villagers[villager]?.affinity['guardian'] ?? 0;
  const tale = db
    .all('collectibles')
    .find(
      (c) =>
        c.source?.talk === villager &&
        !state.guardian.collectibles.includes(c.id) &&
        (c.source.minAffinity === undefined || affinity >= c.source.minAffinity) &&
        (!c.source.when || evaluate(c.source.when)),
    );
  return tale?.id ?? null;
}

/**
 * The guardian talks to a villager. Returns the events and the collectible to grant (the caller
 * applies `grantCollectible`, which runs its `grants`).
 */
export function talkTo(
  draft: WorldState,
  db: ContentDatabase,
  rules: ItemRules,
  villager: string,
  activity: string,
  evaluate: (c: Condition) => boolean,
  /** Fear as the villager shows it (a hidden possession fakes calm). */
  fear: number,
): { events: CoreEvent[]; grant: Effect[] } {
  const v = draft.villagers[villager];
  db.get('villagers', villager);
  if (!v || !v.alive) throw new ItemRuleError('cannot talk to the dead');
  if (!atHome(draft, rules)) throw new ItemRuleError('not in the village');
  if (SILENT.has(activity)) throw new ItemRuleError('not now');
  const events: CoreEvent[] = [];
  const today = draft.clock.day;
  if (draft.collection.talked[villager] !== today) {
    draft.collection.talked[villager] = today;
    const from = v.affinity['guardian'] ?? 0;
    const to = Math.min(100, from + rules.talk.affinityPerDay);
    if (to !== from) {
      v.affinity['guardian'] = to;
      events.push(event('villager/affinityChanged', { villager, with: 'guardian', from, to }));
    }
  }
  const tale = taleOf(draft, db, villager, evaluate);
  events.push(
    event('villager/talked', {
      villager,
      tale,
      affinity: v.affinity['guardian'] ?? 0,
      mood: fear >= 60 ? 'afraid' : fear >= 30 ? 'uneasy' : 'calm',
    }),
  );
  return { events, grant: tale ? [{ grantCollectible: tale }] : [] };
}

function setsChanged(
  before: readonly string[],
  draft: WorldState,
  db: ContentDatabase,
): CoreEvent[] {
  const after = completeSets(draft, db).map((s) => s.id);
  return [
    ...after
      .filter((s) => !before.includes(s))
      .map((set) => event('cabinet/setCompleted', { set })),
    ...before.filter((s) => !after.includes(s)).map((set) => event('cabinet/setBroken', { set })),
  ];
}

/** Displays a cursed item (from the pack or the store) in the cellar cabinet. */
export function displayObject(
  draft: WorldState,
  db: ContentDatabase,
  rules: ItemRules,
  item: string,
): CoreEvent[] {
  if (!atHome(draft, rules)) throw new ItemRuleError('not at home');
  if (!db.get('items', item).cursed) throw new ItemRuleError('not a cursed object');
  if (draft.collection.cabinet.includes(item)) throw new ItemRuleError('already displayed');
  if (draft.collection.cabinet.length >= rules.cabinet.slots)
    throw new ItemRuleError('cabinet full');
  if (itemCount(draft, item) === 0) throw new ItemRuleError('not owned');
  const before = completeSets(draft, db).map((s) => s.id);
  takeItem(draft, db, item, 1);
  draft.collection.cabinet.push(item);
  return [event('cabinet/displayed', { item }), ...setsChanged(before, draft, db)];
}

/** Takes an object out of the cabinet into the house store. */
export function removeObject(
  draft: WorldState,
  db: ContentDatabase,
  rules: ItemRules,
  item: string,
): CoreEvent[] {
  if (!atHome(draft, rules)) throw new ItemRuleError('not at home');
  const index = draft.collection.cabinet.indexOf(item);
  if (index < 0) throw new ItemRuleError('not displayed');
  const before = completeSets(draft, db).map((s) => s.id);
  draft.collection.cabinet.splice(index, 1);
  draft.guardian.storage.push({ item, qty: 1 });
  return [event('cabinet/removed', { item }), ...setsChanged(before, draft, db)];
}

/** Recalls the memory of an owned cursed object; returns the first-recall effects to apply. */
export function recallMemory(
  draft: WorldState,
  db: ContentDatabase,
  object: string,
): { events: CoreEvent[]; effects: Effect[] } {
  const def = db.get('cursed-objects', object);
  const item = db.all('items').find((i) => i.cursed === object);
  const owned =
    item !== undefined &&
    (itemCount(draft, item.id) > 0 || draft.collection.cabinet.includes(item.id));
  if (!owned) throw new ItemRuleError('not owned');
  const first = !draft.collection.memories.includes(object);
  if (first) draft.collection.memories.push(object);
  return {
    events: [event('collection/memoryRecalled', { object, scene: def.memoryScene ?? null, first })],
    effects: first ? def.memoryEffects : [],
  };
}
