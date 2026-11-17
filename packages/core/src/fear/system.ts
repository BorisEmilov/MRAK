/** The fear engine as the Game drives it: over elapsed time, and in reaction to events. */
import type { CoreEvent } from '../events';
import type { WorldState } from '../state/world-state';
import { fearMoments, isNightAt, toTime, type FearContext } from './common';
import { directorTick } from './director';
import { hysteriaAfter, hysteriaAtDawn } from './hysteria';
import { sanityAfter, sanityAtDawn, sanityInLight } from './sanity';
import { advancePossessions, symptomsAtDawn } from '../occult/possession';
import { clausesAtDawn, factionsAfter, sacrificesAtDawn } from '../occult/pacts';
import { nightAfter, spawnTick } from '../night/night';

/** Director ticks, night hours in the light and dawns between two moments, in order. */
export function fearOverTime(
  draft: WorldState,
  ctx: FearContext,
  from: { day: number; minute: number },
  to: { day: number; minute: number },
): CoreEvent[] {
  const out: CoreEvent[] = [];
  for (const m of fearMoments(from, to)) {
    if (m.kind === 'hour') {
      if (isNightAt(m.at)) out.push(...sanityInLight(draft, ctx.db, ctx.rules));
    } else if (m.kind === 'dawn') {
      out.push(...sanityAtDawn(draft, ctx.db, ctx.rules));
      out.push(...hysteriaAtDawn(draft, ctx, toTime(m.at)));
      out.push(...symptomsAtDawn(draft, ctx));
      out.push(...clausesAtDawn(draft, ctx, toTime(m.at)));
      out.push(...sacrificesAtDawn(draft, ctx, toTime(m.at)));
    } else {
      if (m.kind === 'witching') out.push(...advancePossessions(draft, ctx));
      out.push(...directorTick(draft, ctx, m.at, m.kind === 'witching'));
      if (m.kind === 'tick') out.push(...spawnTick(draft, ctx, m.at));
    }
  }
  return out;
}

/** Reactions to a batch of events (Sanity shocks and tiers, hysteria incidents). */
export function fearAfterEvents(
  draft: WorldState,
  ctx: FearContext,
  events: readonly CoreEvent[],
): CoreEvent[] {
  const sanity = sanityAfter(draft, ctx.db, ctx.rules, events);
  const hysteria = hysteriaAfter(draft, ctx, [...events, ...sanity]);
  const factions = factionsAfter(draft, ctx, events);
  const night = nightAfter(draft, ctx, [...events, ...hysteria]);
  return [...sanity, ...hysteria, ...factions, ...night];
}
