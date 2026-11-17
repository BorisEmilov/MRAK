import { z } from 'zod';
import { defineRoute } from './defineRoute.js';

/**
 * The published live-season calendar (real-world UTC dates, "MM-DD", windows may wrap the new
 * year). Ids match `seasonal-events` in the game content; the client re-checks each window
 * against its own content before activating anything (docs/systems/seasonal-events.md).
 */
export const SEASONS: readonly { event: string; start: string; end: string }[] = [
  { event: 'kukeri-season', start: '02-01', end: '02-28' },
  { event: 'enyovden-herbs', start: '06-23', end: '06-25' },
  { event: 'zadushnitsa-candles', start: '10-28', end: '11-08' },
  { event: 'unclean-days-watch', start: '12-25', end: '01-06' },
];

export function activeSeasons(now: Date): { date: string; active: string[] } {
  const date = now.toISOString().slice(0, 10);
  const md = date.slice(5);
  const active = SEASONS.filter((s) =>
    s.start <= s.end ? md >= s.start && md <= s.end : md >= s.start || md <= s.end,
  ).map((s) => s.event);
  return { date, active };
}

/** Which seasonal events are live today (server clock: the authority for online rewards). */
export const seasonalRoute = defineRoute({
  method: 'get',
  path: '/v1/seasonal',
  rateLimit: { windowMs: 60_000, limit: 30 },
  handler: (req, res) => {
    const now = (req.app.locals['now'] as (() => Date) | undefined) ?? (() => new Date());
    res.set('Cache-Control', 'public, max-age=300');
    res.status(200).json(activeSeasons(now()));
  },
  doc: {
    tag: 'live',
    summary: 'Seasonal events live today (server UTC date)',
    responses: {
      200: {
        description: "Today's date and the active seasonal event ids.",
        schema: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          active: z.array(z.string()).max(20),
        }),
      },
      429: { description: 'Rate limit exceeded.' },
    },
  },
});
