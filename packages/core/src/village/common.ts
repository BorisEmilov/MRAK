/**
 * Shared helpers of the village simulation (docs/systems/villagers.md → Implementation).
 */
import type { Condition, Villager, VillageRules } from '@mrak/content-schema';
import { ConditionEvaluator } from '../conditions';
import type { ContentDatabase } from '../content/database';
import { itemCount, takeItem } from '../items/inventory';
import { createRandom } from '../random';
import { getStat } from '../state/stats';
import type { Snapshot, WorldState } from '../state/world-state';
import { festivalsOn } from '../time/calendar';

export type ReadState = Snapshot | WorldState;

export class VillageRuleError extends Error {}

/** The village rules (data/village-rules/default), or null when the pack has none. */
export function villageRules(db: ContentDatabase): VillageRules | null {
  return db.find('village-rules', 'default') ?? null;
}

export const MINUTES_PER_DAY = 1440;

/** "HH:MM" → minute of the day. */
export function clockMinute(text: string): number {
  const [h = '0', m = '0'] = text.split(':');
  return Number(h) * 60 + Number(m);
}

/** 0 = Sunday … 6 = Saturday (JDN 0 was a Monday). */
export function weekday(jdn: number): number {
  return (((jdn + 1) % 7) + 7) % 7;
}

/** True while a villager has a possession nobody has uncovered. */
export function possessedHidden(state: ReadState, villager: string): boolean {
  return state.possessions.some((p) => p.host === villager && !p.revealed);
}

/** True fear (core rules: contagion, secrets). */
export function trueFear(state: ReadState, db: ContentDatabase, villager: string): number {
  return getStat(state, db, 'fear', villager);
}

/**
 * Fear as the villager acts on it and the UI shows it: a hidden possession fakes calm (rule 12).
 * Drives status, efficiency, refusals and the panel.
 */
export function perceivedFear(
  state: ReadState,
  db: ContentDatabase,
  rules: VillageRules,
  villager: string,
): number {
  const fear = trueFear(state, db, villager);
  return possessedHidden(state, villager) ? Math.round(fear * rules.fear.maskedFactor) : fear;
}

/** Product of a trait field over a villager's traits. */
export function traitFactor(
  db: ContentDatabase,
  villager: Villager,
  field: 'fearGain' | 'spread' | 'hungerRate' | 'coldRate',
): number {
  let f = 1;
  for (const id of villager.traits) f *= db.find('traits', id)?.[field] ?? 1;
  return f;
}

/** Multiplier on every fear gain: traits × faith damping. */
export function fearGainOf(
  state: ReadState,
  db: ContentDatabase,
  rules: VillageRules,
  villager: Villager,
): number {
  const faith = getStat(state, db, 'villager-faith', villager.id);
  return traitFactor(db, villager, 'fearGain') * (1 - (faith / 100) * rules.fear.faithDamping);
}

/** Villagers who take part in village life now (alive), in id order. */
export function livingVillagers(state: ReadState, db: ContentDatabase): Villager[] {
  return db
    .all('villagers')
    .filter((v) => state.villagers[v.id]?.alive === true)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Evaluates conditions as of a given moment: the clock is moved to it and the festival chapter
 * is derived from the calendar, so a long time skip and second-by-second ticking agree.
 */
export function evaluatorAt(
  state: ReadState,
  db: ContentDatabase,
  day: number,
  minute: number,
): (condition: Condition) => boolean {
  const chapter = festivalsOn(db.all('festivals'), day)[0]?.festival.id ?? null;
  const view = {
    ...state,
    clock: { ...state.clock, day, minute },
    calendar: { ...state.calendar, chapterId: chapter },
  } as Snapshot;
  // A query: `chance` conditions use a throwaway stream, never the game's RNG.
  const evaluator = new ConditionEvaluator(db, createRandom(0));
  return (condition) => evaluator.evaluate(condition, view);
}

/** Where village upkeep takes from: the house store (village), or pack + store (the guardian). */
export type Source = 'storage' | 'any';

/** Has the house store (or the guardian, for `any`) every stack? Returns the first missing item. */
export function hasItems(
  state: ReadState,
  stacks: readonly { item: string; qty: number }[],
  from: Source = 'storage',
): string | null {
  for (const s of stacks) if (itemCount(state, s.item, from) < s.qty) return s.item;
  return null;
}

/** Takes stacks (call `hasItems` first). */
export function takeItems(
  draft: WorldState,
  db: ContentDatabase,
  stacks: readonly { item: string; qty: number }[],
  from: Source = 'storage',
): void {
  for (const s of stacks) takeItem(draft, db, s.item, s.qty, from);
}
