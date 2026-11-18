/** SEC-TEL-26 (threat model C-26): fixed schema, drops, limits, kill switch, sampling. */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { StaticSwitches } from '../limits/switches.js';
import { MemoryTelemetryStore, sampled } from './telemetry.js';

const install = randomUUID();
const batch = (events: unknown[]) => ({
  install,
  session: randomUUID(),
  build: '0.1.0',
  demo: true,
  events,
});
const death = { e: 'death', t: 1000, zone: 'old-forest', cause: 'karakondzhul', n: 2 };

function app(opts: { off?: boolean; sample?: number } = {}) {
  const store = new MemoryTelemetryStore();
  const a = createApp({
    telemetry: { store, sample: opts.sample ?? 1 },
    switches: new StaticSwitches(new Set(opts.off ? ['telemetry'] : [])),
  });
  const post = (body: unknown) =>
    request(a)
      .post('/v1/telemetry')
      .set('X-MRAK-Install', install)
      .send(body as object);
  return { store, post };
}

describe('POST /v1/telemetry', () => {
  it('stores valid events with the envelope and nothing else', async () => {
    const { store, post } = app();
    const res = await post(batch([death, { e: 'session-start', t: 0 }]));
    expect(res.status).toBe(202);
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]).toEqual({
      ...death,
      install,
      session: expect.any(String) as string,
      build: '0.1.0',
      demo: true,
    });
  });

  it('drops unknown events, extra fields, free text and personal data', async () => {
    const { store, post } = app();
    const res = await post(
      batch([
        { e: 'keylogger', t: 1 },
        { ...death, email: 'a@b.c' },
        { e: 'death', t: 1, zone: 'Old Forest with spaces' },
        { e: 'decision', t: 1, key: 'x', text: 'not an error' },
        { e: 'js-error', t: 1, key: 'TypeError', text: 'see me@example.com' },
        { e: 'js-error', t: 1, key: 'TypeError', text: 'failed https://x.y/?token=1' },
        { e: 'js-error', t: 1, key: 'TypeError', text: 'x is undefined' },
      ]),
    );
    expect(res.status).toBe(202);
    expect(store.rows.map((r) => r.text)).toEqual(['x is undefined']);
  });

  it('51 events, a bad envelope or a body over 8 kB are refused', async () => {
    const { store, post } = app();
    expect((await post(batch(Array.from({ length: 51 }, () => death)))).status).toBe(400);
    expect((await post({ ...batch([death]), install: 'not-a-uuid' })).status).toBe(400);
    expect((await post({ ...batch([death]), ip: '1.2.3.4' })).status).toBe(400);
    const big = batch([{ ...death, pad: 'x'.repeat(9000) }]);
    expect((await post(big)).status).toBe(413);
    expect(store.rows).toHaveLength(0);
  });

  it('kill switch: 202 and nothing stored', async () => {
    const { store, post } = app({ off: true });
    expect((await post(batch([death]))).status).toBe(202);
    expect(store.rows).toHaveLength(0);
  });

  it('server sampling keeps or drops whole installs', async () => {
    const { store, post } = app({ sample: 0 });
    expect((await post(batch([death]))).status).toBe(202);
    expect(store.rows).toHaveLength(0);
    const ids = Array.from({ length: 2000 }, () => randomUUID());
    const kept = ids.filter((id) => sampled(id, 0.25)).length;
    expect(kept).toBeGreaterThan(400);
    expect(kept).toBeLessThan(600);
    expect(ids.every((id) => sampled(id, 0.25) === sampled(id, 0.25))).toBe(true);
  });

  it('per-install rate limit (60/h)', async () => {
    const { post } = app();
    for (let i = 0; i < 60; i++) expect((await post(batch([]))).status).toBe(202);
    expect((await post(batch([]))).status).toBe(429);
  });
});
