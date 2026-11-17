/** Stat access with registry ranges, defaults and passive modifiers. */
import type { ContentDatabase } from '../content/database';
import { activeModifiers } from '../items/modifiers';
import type { Snapshot, WorldState } from './world-state';

type ReadState = Snapshot | WorldState;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Base value of a stat (registry default if never set). Villager-scoped stats need `villager`. */
export function getStat(
  state: ReadState,
  db: ContentDatabase,
  stat: string,
  villager?: string,
): number {
  const decl = db.statDecl(stat);
  if (decl.scope === 'villager') {
    if (villager === undefined) throw new RangeError(`stat "${stat}" needs a villager`);
    return state.villagerStats[villager]?.[stat] ?? decl.default;
  }
  return state.stats[stat] ?? decl.default;
}

/** Sets a stat, clamped to its declared range. Returns [from, to]. Mutates the draft. */
export function setStat(
  draft: WorldState,
  db: ContentDatabase,
  stat: string,
  value: number,
  villager?: string,
): [number, number] {
  const decl = db.statDecl(stat);
  const from = getStat(draft, db, stat, villager);
  const to = clamp(value, decl.min, decl.max);
  if (decl.scope === 'villager') {
    if (villager === undefined) throw new RangeError(`stat "${stat}" needs a villager`);
    draft.villagerStats[villager] = { ...draft.villagerStats[villager], [stat]: to };
  } else {
    if (villager !== undefined) throw new RangeError(`stat "${stat}" is not villager-scoped`);
    draft.stats[stat] = to;
  }
  return [from, to];
}

/**
 * Stat value after passive modifiers: (base + Σ statBonus) × Π multiply, clamped to range.
 * Modifiers come from `state.modifiers` (talents, gear, bloodline nodes register them there) and
 * from cursed objects and cabinet sets (docs/systems/collection.md rule 4).
 */
export function effectiveStat(
  state: ReadState,
  db: ContentDatabase,
  stat: string,
  villager?: string,
): number {
  const decl = db.statDecl(stat);
  let value = getStat(state, db, stat, villager);
  let factor = 1;
  for (const modifier of activeModifiers(state, db)) {
    if ('statBonus' in modifier && modifier.statBonus === stat) value += modifier.value;
    if ('multiply' in modifier && modifier.multiply === stat) factor *= modifier.factor;
  }
  return clamp(value * factor, decl.min, decl.max);
}
