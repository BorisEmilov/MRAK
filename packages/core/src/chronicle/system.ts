/** The long-term systems as the Game drives them: year turns, then reactions to events. */
import type { CoreEvent } from '../events';
import type { WorldState } from '../state/world-state';
import { yearOf, type ChronicleContext } from './common';
import { endlessAfter, endlessYear } from './endless';
import { growthAfter, villageYear } from './growth';
import { lineageAfter, lineageYear } from './lineage';

/** Turns every year from the last one turned up to `toYear`. */
export function turnYears(draft: WorldState, ctx: ChronicleContext, toYear: number): CoreEvent[] {
  const from = draft.village.year;
  if (from === null) {
    draft.village.year = toYear;
    return [];
  }
  const out: CoreEvent[] = [];
  for (let year = from + 1; year <= toYear; year++) {
    out.push(...villageYear(draft, ctx, year));
    out.push(...lineageYear(draft, ctx, year));
    out.push(...endlessYear(draft, ctx, year));
    draft.village.year = year;
  }
  return out;
}

export function chronicleAfter(
  draft: WorldState,
  ctx: ChronicleContext,
  events: readonly CoreEvent[],
): CoreEvent[] {
  const out: CoreEvent[] = [];
  for (const e of events)
    if (e.type === 'time/dayChanged') out.push(...turnYears(draft, ctx, yearOf(e.payload.day)));
  out.push(...growthAfter(draft, ctx, [...events, ...out]));
  out.push(...lineageAfter(draft, ctx, [...events, ...out]));
  out.push(...endlessAfter(draft, ctx, [...events, ...out]));
  return out;
}
