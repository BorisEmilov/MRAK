import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

const at = (iso: string) => createApp({ now: () => new Date(iso) });

describe('GET /v1/seasonal', () => {
  it.each([
    ['2026-02-14T12:00:00Z', ['kukeri-season']],
    ['2026-06-24T00:00:00Z', ['enyovden-herbs']],
    ['2026-11-01T09:00:00Z', ['zadushnitsa-candles']],
    ['2026-12-31T23:00:00Z', ['unclean-days-watch']],
    ['2027-01-06T23:59:59Z', ['unclean-days-watch']],
    ['2027-01-07T00:00:00Z', []],
    ['2026-07-15T12:00:00Z', []],
  ])('changing the server date to %s activates %j', async (iso, active) => {
    const res = await request(at(iso)).get('/v1/seasonal');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ date: iso.slice(0, 10), active });
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });
});
