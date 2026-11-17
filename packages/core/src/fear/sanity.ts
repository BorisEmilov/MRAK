/**
 * Sanity (docs/systems/sanity.md → Implementation): perception tiers, shocks, restores and the
 * break. Darkness drain lives in world/light.ts; this module reacts to the rest.
 */
import type { FearRules, PerceptionEffect } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { effectiveStat, getStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { fearRules, FearRuleError, type ReadState } from './common';

export interface Perception {
  /** 0 = steady; higher = worse. */
  tier: number;
  effects: PerceptionEffect[];
  whisperKeys: string[];
}

const STEADY: Perception = { tier: 0, effects: [], whisperKeys: [] };

export function sanityRatio(state: ReadState, db: ContentDatabase): number {
  if (!db.hasStat('sanity')) return 1;
  const max = db.hasStat('sanity-max') ? effectiveStat(state, db, 'sanity-max') : 100;
  return max > 0 ? effectiveStat(state, db, 'sanity') / max : 0;
}

/** The deepest tier whose threshold the current Sanity is under (0 = none). */
export function sanityTier(state: ReadState, db: ContentDatabase, rules: FearRules): number {
  const ratio = sanityRatio(state, db);
  let tier = 0;
  rules.sanity.tiers.forEach((t, i) => {
    if (ratio < t.below) tier = i + 1;
  });
  return tier;
}

/** What the presentation layer should distort now (empty when steady or without rules). */
export function perception(state: ReadState, db: ContentDatabase): Perception {
  const rules = fearRules(db);
  if (!rules) return STEADY;
  const tier = sanityTier(state, db, rules);
  const def = rules.sanity.tiers[tier - 1];
  return def ? { tier, effects: [...def.effects], whisperKeys: [...def.whisperKeys] } : STEADY;
}

/** Changes Sanity by `delta` (clamped to [0, max]); returns the stat event. */
export function changeSanity(draft: WorldState, db: ContentDatabase, delta: number): CoreEvent[] {
  if (delta === 0 || !db.hasStat('sanity')) return [];
  const max = db.hasStat('sanity-max') ? effectiveStat(draft, db, 'sanity-max') : Infinity;
  const value = Math.min(max, getStat(draft, db, 'sanity') + delta);
  const [from, to] = setStat(draft, db, 'sanity', value);
  return from === to ? [] : [event('state/statChanged', { stat: 'sanity', from, to })];
}

/** The `sanity-shock { cause }` engine rule: content's sacrifices, sightings, failed rituals. */
export function sanityShock(draft: WorldState, db: ContentDatabase, cause: string): CoreEvent[] {
  const rules = fearRules(db);
  if (!rules) throw new FearRuleError('this content has no fear rules');
  const loss = rules.sanity.shocks.causes[cause];
  if (loss === undefined) throw new FearRuleError(`unknown sanity shock cause "${cause}"`);
  return changeSanity(draft, db, -loss);
}

/**
 * Reactions to a batch of events: forbidden knowledge and demons learned shock the guardian;
 * then the tier and the break are brought up to date.
 */
export function sanityAfter(
  draft: WorldState,
  db: ContentDatabase,
  rules: FearRules,
  events: readonly CoreEvent[],
): CoreEvent[] {
  const out: CoreEvent[] = [];
  const { shocks } = rules.sanity;
  for (const e of events) {
    if (e.type === 'journal/learned' && e.payload.kind === 'demon')
      out.push(...changeSanity(draft, db, -shocks.demonLearned));
    else if (
      e.type === 'state/statChanged' &&
      e.payload.stat === 'notice' &&
      e.payload.to > e.payload.from
    )
      out.push(
        ...changeSanity(draft, db, -(e.payload.to - e.payload.from) * shocks.forbiddenPerNotice),
      );
  }
  out.push(...syncSanity(draft, db, rules));
  return out;
}

/** Emits `sanity/tierChanged` and `sanity/broken` when the state crosses them. */
export function syncSanity(draft: WorldState, db: ContentDatabase, rules: FearRules): CoreEvent[] {
  if (!db.hasStat('sanity')) return [];
  const out: CoreEvent[] = [];
  const tier = sanityTier(draft, db, rules);
  if (tier !== draft.sanity.tier) {
    out.push(event('sanity/tierChanged', { from: draft.sanity.tier, to: tier }));
    draft.sanity.tier = tier;
  }
  if (getStat(draft, db, 'sanity') <= 0 && !draft.sanity.broken) {
    draft.sanity.broken = true;
    draft.sanity.breaks += 1;
    out.push(event('sanity/broken', { breaks: draft.sanity.breaks }));
  }
  return out;
}

export function atHome(state: ReadState, rules: FearRules): boolean {
  return state.currentZone === null || rules.sanity.restore.homeZones.includes(state.currentZone);
}

/** Dawn: rest at home and faith restore; a broken mind wakes up. */
export function sanityAtDawn(
  draft: WorldState,
  db: ContentDatabase,
  rules: FearRules,
): CoreEvent[] {
  const { restore } = rules.sanity;
  const out: CoreEvent[] = [];
  if (atHome(draft, rules)) {
    const faith = db.hasStat('faith') ? effectiveStat(draft, db, 'faith') : 0;
    out.push(
      ...changeSanity(draft, db, restore.dawnAtHome + Math.floor(faith / restore.faithDivisor)),
    );
  }
  if (draft.sanity.broken && getStat(draft, db, 'sanity') > 0) draft.sanity.broken = false;
  return out;
}

/** A night hour spent in the lantern's light restores a little. */
export function sanityInLight(
  draft: WorldState,
  db: ContentDatabase,
  rules: FearRules,
): CoreEvent[] {
  if (!draft.light.lit || draft.light.inDarkness) return [];
  return changeSanity(draft, db, rules.sanity.restore.lightPerHour);
}
