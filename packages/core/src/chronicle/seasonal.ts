/**
 * Real-date seasonal events (docs/systems/seasonal-events.md → Implementation). The server
 * publishes which events are active; the client checks each against its own content windows for
 * the date given and activates it once per season: in-world effects, Legacy, a cosmetic title.
 */
import type { SeasonalEvent } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import type { WorldState } from '../state/world-state';
import { ChronicleError, type ChronicleContext } from './common';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Is "MM-DD" inside a window (which may wrap the new year)? */
export function inSeasonWindow(md: string, window: SeasonalEvent['window']): boolean {
  return window.start <= window.end
    ? md >= window.start && md <= window.end
    : md >= window.start || md <= window.end;
}

/** Events whose real-world window contains a UTC date ("YYYY-MM-DD"). */
export function seasonalActive(db: ContentDatabase, date: string): SeasonalEvent[] {
  const m = DATE.exec(date);
  if (!m) return [];
  const md = `${m[2] ?? ''}-${m[3] ?? ''}`;
  return db.all('seasonal-events').filter((e) => inSeasonWindow(md, e.window));
}

/** The year a season belongs to (a window wrapping New Year counts from its start). */
function seasonYear(e: SeasonalEvent, date: string): number {
  const year = Number(date.slice(0, 4));
  const md = date.slice(5);
  return e.window.start > e.window.end && md <= e.window.end ? year - 1 : year;
}

export function activateSeasonal(
  draft: WorldState,
  ctx: ChronicleContext,
  id: string,
  date: string,
): CoreEvent[] {
  const e = seasonalActive(ctx.db, date).find((x) => x.id === id);
  if (!e) throw new ChronicleError('not in season');
  const year = seasonYear(e, date);
  const key = `${id}@${String(year)}`;
  if (draft.seasonal.activated.includes(key)) throw new ChronicleError('already activated');
  draft.seasonal.activated.push(key);
  if (draft.seasonal.activated.length > 500) draft.seasonal.activated.shift();
  return [
    event('seasonal/activated', { event: id, year, legacy: e.legacy }),
    ...ctx.apply(e.effects, `seasonal:${id}`),
  ];
}
