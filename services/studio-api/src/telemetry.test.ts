import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { aggregate, sqlTelemetry, type TelemetryRow } from './telemetry.js';

const row = (
  install: string,
  session: string,
  name: string,
  t: number,
  f: Partial<TelemetryRow> = {},
): TelemetryRow => ({
  install,
  session,
  name,
  t,
  zone: null,
  key: null,
  cause: null,
  value: null,
  n: null,
  text: null,
  demo: true,
  ...f,
});

/** A test playthrough: prologue, two nights, a death, the demo end and a purchase. */
const playthrough: TelemetryRow[] = [
  row('a', 's1', 'session-start', 0),
  row('a', 's1', 'zone', 10, { zone: 'village', n: 0 }),
  row('a', 's1', 'prologue-end', 20, { value: 600 }),
  row('a', 's1', 'night-start', 30, { n: 1 }),
  row('a', 's1', 'zone', 40, { zone: 'old-forest', n: 1 }),
  row('a', 's1', 'sample', 50, { zone: 'old-forest', value: 70, n: 40 }),
  row('a', 's1', 'sample', 60, { zone: 'old-forest', value: 50, n: 60 }),
  row('a', 's1', 'death', 70, { zone: 'old-forest', cause: 'karakondzhul', n: 1 }),
  row('a', 's1', 'night-end', 80, { n: 1, value: 900 }),
  row('a', 's1', 'decision', 90, { key: 'spare-stoyan', cause: 'spare' }),
  row('a', 's1', 'mystery-end', 95, { key: 'first-death', cause: 'accuse' }),
  row('a', 's1', 'demo-end', 100),
  row('a', 's1', 'buy-click', 110),
  row('a', 's1', 'purchase', 120),
  row('a', 's1', 'js-error', 130, { key: 'TypeError', text: 'x is undefined' }),
  row('b', 's2', 'session-start', 0),
  row('b', 's2', 'js-error', 5, { key: 'TypeError', text: 'x is undefined' }),
];

describe('telemetry panel', () => {
  it('aggregates a test playthrough', () => {
    const d = aggregate(playthrough);
    expect(d).toMatchObject({ rows: 17, installs: 2, sessions: 2, meanTension: 50 });
    expect(d.funnel).toEqual([
      { step: 'session-start', installs: 2 },
      { step: 'prologue-end', installs: 1 },
      { step: 'demo-end', installs: 1 },
      { step: 'buy-click', installs: 1 },
      { step: 'purchase', installs: 1 },
    ]);
    expect(d.deaths).toEqual([{ zone: 'old-forest', night: 1, count: 1 }]);
    expect(d.deathCauses).toEqual([{ zone: 'old-forest', cause: 'karakondzhul', count: 1 }]);
    expect(d.routes).toEqual([{ from: 'village', to: 'old-forest', count: 1 }]);
    expect(d.nights).toEqual([
      {
        night: 1,
        runs: 1,
        medianMinutes: 15,
        meanMinutes: 15,
        meanTension: 50,
        meanSanity: 60,
      },
    ]);
    expect(d.decisions).toEqual([{ key: 'spare-stoyan', cause: 'spare', count: 1 }]);
    expect(d.mysteries).toEqual([{ key: 'first-death', cause: 'accuse', count: 1 }]);
    expect(d.errors).toEqual([{ key: 'TypeError', text: 'x is undefined', count: 2, installs: 2 }]);
  });

  it('GET /v1/telemetry: reads ≤ 90 days through the SQL source; 503 without it', async () => {
    const seen: unknown[][] = [];
    const telemetry = sqlTelemetry((text, values) => {
      expect(text).toContain('FROM telemetry.events');
      seen.push(values);
      return Promise.resolve({ rows: playthrough as unknown as Record<string, unknown>[] });
    });
    const res = await request(createApp({ telemetry })).get('/v1/telemetry?days=365');
    expect(res.status).toBe(200);
    expect((res.body as { funnel: unknown[]; days: number }).days).toBe(90);
    expect(seen).toEqual([[90]]);
    expect((await request(createApp()).get('/v1/telemetry')).status).toBe(503);
  });
});
