/** Gathering points (docs/systems/inventory.md → Gathering points). */
import type { ItemRules, Poi } from '@mrak/content-schema';
import { ConditionEvaluator } from '../conditions';
import type { ContentDatabase } from '../content/database';
import { createRandom } from '../random';
import type { Snapshot, WorldState } from '../state/world-state';

type ReadState = Snapshot | WorldState;

export type GatherStatus = 'ready' | 'regrowing' | 'season';

export function gatherKey(zone: string, poi: string): string {
  return `${zone}/${poi}`;
}

/** A read-only evaluator (chance conditions never advance the game's RNG). */
function evaluator(db: ContentDatabase, state: ReadState) {
  const e = new ConditionEvaluator(db, createRandom(0));
  return (c: Parameters<typeof e.evaluate>[0]) => e.evaluate(c, state);
}

/** Is the plant there now, and has it regrown? */
export function gatherStatus(
  state: ReadState,
  db: ContentDatabase,
  zone: string,
  poi: Poi,
): GatherStatus | null {
  const spec = poi.gather;
  if (!spec) return null;
  if (spec.when && !evaluator(db, state)(spec.when)) return 'season';
  const last = state.collection.gathered[gatherKey(zone, poi.id)];
  if (last !== undefined && state.clock.day - last < Math.max(1, spec.regrowDays))
    return 'regrowing';
  return 'ready';
}

/** Potency of what is gathered now: base, then each boost (add, then multiply), max 3. */
export function gatherPotency(
  state: ReadState,
  db: ContentDatabase,
  rules: ItemRules | null,
  base: number,
): { potency: number; boosts: string[] } {
  let p = base;
  const boosts: string[] = [];
  const holds = evaluator(db, state);
  for (const b of rules?.gathering.boosts ?? [])
    if (holds(b.when)) {
      p = (p + b.add) * b.factor;
      boosts.push(b.labelKey);
    }
  return { potency: Math.min(3, Math.max(1, Math.round(p))), boosts };
}

/** Status of every gathering point of a zone (for the world scene). */
export function zoneGathering(
  state: ReadState,
  db: ContentDatabase,
  zone: string,
): Record<string, GatherStatus> {
  const out: Record<string, GatherStatus> = {};
  for (const poi of db.get('zones', zone).pois) {
    const status = gatherStatus(state, db, zone, poi);
    if (status) out[poi.id] = status;
  }
  return out;
}

/** Records a gathering (the caller gives the items). */
export function markGathered(draft: WorldState, zone: string, poi: string): void {
  draft.collection.gathered[gatherKey(zone, poi)] = draft.clock.day;
}
