import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadCatalog } from '../progress/catalog.js';
import { MemoryProgressStore } from '../progress/store.js';
import { FULL_GAME, type Account } from './progress.js';

const catalog = loadCatalog(
  fileURLToPath(new URL('../../../../packages/content/data', import.meta.url)),
);
interface Reply {
  recorded: unknown[];
  rejected: { reason: string }[];
  achievements: { at: number }[];
  entries: { kind: string; value?: number }[];
}
const r = (res: { body: unknown }): Reply => res.body as Reply;
const NOW = new Date('2026-11-17T12:00:00Z');

/** Test authenticator: the account is chosen by the test, never by the request. */
function app(account: Account | null = { userId: 'u1', entitlements: [], verified: true }) {
  const progress = new MemoryProgressStore();
  return createApp({
    now: () => NOW,
    catalog,
    progress,
    authenticate: () => Promise.resolve(account),
  });
}

describe('account achievements (docs/systems/achievements.md)', () => {
  it('needs an account: 401 without one, and without an authenticator at all', async () => {
    expect((await request(app(null)).get('/v1/achievements')).status).toBe(401);
    const bare = createApp({ catalog, progress: new MemoryProgressStore() });
    const res = await request(bare)
      .post('/v1/achievements/unlock')
      .set('Authorization', 'Bearer anything')
      .send({ achievements: [{ id: 'prologue', at: 1 }] });
    expect(res.status).toBe(401);
  });

  it('needs a verified email: 403 otherwise', async () => {
    const res = await request(app({ userId: 'u3', entitlements: [], verified: false })).get(
      '/v1/achievements',
    );
    expect(res.status).toBe(403);
    expect(res.type).toBe('application/problem+json');
  });

  it('repeating an unlock never duplicates it (idempotent)', async () => {
    const a = app();
    const body = { achievements: [{ id: 'prologue', at: 1000 }] };
    const first = await request(a).post('/v1/achievements/unlock').send(body);
    expect(first.status).toBe(200);
    expect(r(first).recorded).toEqual([{ kind: 'achievement', key: 'prologue' }]);
    const again = await request(a).post('/v1/achievements/unlock').send(body);
    expect(r(again).recorded).toEqual([]);
    const list = await request(a).get('/v1/achievements');
    expect(list.body).toEqual({ achievements: [{ id: 'prologue', at: 1000 }] });
    expect(list.headers['ratelimit-policy']).toBeDefined();
  });

  it('rejects unknown ids and full-tier ids without the purchase', async () => {
    const res = await request(app())
      .post('/v1/achievements/unlock')
      .send({
        achievements: [
          { id: 'not-real', at: 1 },
          { id: 'm1-right', at: 1 },
        ],
      });
    expect(
      r(res)
        .rejected.map((x) => x.reason)
        .sort(),
    ).toEqual(['entitlement', 'unknown']);
    const paid = await request(app({ userId: 'u2', entitlements: [FULL_GAME], verified: true }))
      .post('/v1/achievements/unlock')
      .send({ achievements: [{ id: 'm1-right', at: 1 }] });
    expect(r(paid).recorded).toHaveLength(1);
  });

  it('clamps future clocks and refuses oversized or malformed batches', async () => {
    const a = app();
    await request(a)
      .post('/v1/achievements/unlock')
      .send({ achievements: [{ id: 'prologue', at: 9e12 }] });
    expect(r(await request(a).get('/v1/achievements')).achievements[0]?.at).toBe(NOW.getTime());
    const many = Array.from({ length: 51 }, () => ({ id: 'prologue', at: 1 }));
    expect(
      (await request(a).post('/v1/achievements/unlock').send({ achievements: many })).status,
    ).toBe(400);
    expect((await request(a).post('/v1/achievements/unlock').send({ id: 'x' })).status).toBe(400);
  });
});

describe('account progress: Bloodline, Legacy, stats', () => {
  it('records nodes and Legacy once, keeps the highest counter', async () => {
    const a = app();
    const entries = [
      { kind: 'node', key: 'light-keepers', at: 1 },
      { kind: 'legacy', key: 'nikola@2400', value: 13, at: 1 },
      { kind: 'stat', key: 'nights', value: 5, at: 1 },
    ];
    expect(r(await request(a).post('/v1/progress').send({ entries })).recorded).toHaveLength(3);
    expect(r(await request(a).post('/v1/progress').send({ entries })).recorded).toEqual([]);
    await request(a)
      .post('/v1/progress')
      .send({ entries: [{ kind: 'stat', key: 'nights', value: 2, at: 2 }] });
    await request(a)
      .post('/v1/progress')
      .send({ entries: [{ kind: 'stat', key: 'nights', value: 9, at: 3 }] });
    const list = r(await request(a).get('/v1/progress')).entries as {
      kind: string;
      value?: number;
    }[];
    expect(list).toHaveLength(3);
    expect(list.find((e) => e.kind === 'stat')?.value).toBe(9);
  });

  it('refuses unknown nodes, full nodes without the purchase and bad Legacy', async () => {
    const res = await request(app())
      .post('/v1/progress')
      .send({
        entries: [
          { kind: 'node', key: 'no-such-node', at: 1 },
          { kind: 'node', key: 'stanas-eyes', at: 1 },
        ],
      });
    expect(r(res).recorded).toEqual([]);
    const bad = await request(app())
      .post('/v1/progress')
      .send({ entries: [{ kind: 'legacy', key: 'x', value: 100000, at: 1 }] });
    expect(bad.status).toBe(400);
  });
});
