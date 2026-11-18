import { createHash } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { CSRF_HEADER } from '../auth/controller.js';
import { MemoryCounters } from '../auth/guards.js';
import { generateSigningJwk } from '../auth/keys.js';
import { MemoryMailer } from '../auth/mailer.js';
import { MemoryAuthRepository } from '../auth/repository.js';
import { buildAuth } from '../auth/setup.js';
import { MemoryLimiter } from '../limits/limiter.js';
import { DEFAULT_POLICIES, loadPolicies } from '../limits/policies.js';
import { StaticSwitches, type SwitchName } from '../limits/switches.js';
import { MemorySavesStore } from './store.js';

const PASSWORD = 'correct horse battery staple';
const settle = () => new Promise((r) => setImmediate(r));

const meta = (minute = 600) => ({
  savedAt: '2026-11-17T12:00:00.000Z',
  gameDate: { year: 1834, month: 12, day: 25, minute },
  zone: 'village',
  generation: 1,
  playtimeMs: 3_600_000,
  contentVersion: 'demo-1',
  reason: null,
  thumbnail: 'data:image/jpeg;base64,AAAA',
});
const save = (n = 1) => {
  const data = JSON.stringify({ format: 'mrak-save', version: 3, n });
  return { meta: meta(n), data, checksum: createHash('sha256').update(data).digest('hex') };
};

interface Info {
  slot: string;
  version: number;
  meta: { thumbnail: string | null; gameDate: { minute: number } };
}

async function harness(opts: { disabled?: SwitchName[]; policies?: string } = {}) {
  let clock = Date.parse('2026-11-17T12:00:00Z');
  const now = () => new Date(clock);
  const mailer = new MemoryMailer();
  const store = new MemorySavesStore();
  const relaxed = JSON.stringify(
    Object.fromEntries(Object.keys(DEFAULT_POLICIES).map((k) => [k, { limit: 10_000 }])),
  );
  const policies = loadPolicies(opts.policies ?? relaxed);
  const limiter = new MemoryLimiter(() => clock);
  const auth = await buildAuth({
    repo: new MemoryAuthRepository(),
    counters: new MemoryCounters(() => clock),
    mailer,
    jwtKeys: JSON.stringify([await generateSigningJwk('k')]),
    issuer: 'i',
    audience: 'a',
    appUrl: 'https://play.mrak.game',
    secret: 'test-secret-test-secret-test-secret!!',
    http: { allowedOrigins: [], cookieDomain: '' },
    human: () => Promise.resolve(true),
    hooks: [{ name: 'saves', export: () => Promise.resolve([]), erase: (u) => store.removeAll(u) }],
    now,
    limits: { limiter, policies },
  });
  const app = createApp({
    auth,
    saves: store,
    now,
    limiter,
    policies,
    switches: new StaticSwitches(new Set(opts.disabled ?? [])),
  });
  const agent = request(app);
  const post = (path: string, body: object) => agent.post(path).set(CSRF_HEADER, '1').send(body);

  async function user(email: string, verify = true) {
    await post('/v1/auth/register', { email, password: PASSWORD, captcha: 'x' });
    await settle();
    if (verify) {
      const token = mailer.sent
        .find((m) => m.to === email && m.kind === 'verify-email')
        ?.link?.split('#token=')[1];
      await post('/v1/auth/verify-email', { token });
    }
    const res = await post('/v1/auth/login', { email, password: PASSWORD, platform: 'android' });
    const access = (res.body as { accessToken: string }).accessToken;
    const auth = { Authorization: `Bearer ${access}` };
    return {
      access,
      me: () => agent.get('/v1/me').set(auth),
      list: () => agent.get('/v1/saves').set(auth),
      get: (slot: string, q = '') => agent.get(`/v1/saves/${slot}${q}`).set(auth),
      put: (slot: string, body: object, pre: Record<string, string>) =>
        agent.put(`/v1/saves/${slot}`).set(auth).set(pre).send(body),
      del: (slot: string, pre: Record<string, string>) =>
        agent.delete(`/v1/saves/${slot}`).set(auth).set(pre),
      deleteAccount: () =>
        agent.delete('/v1/me').set(auth).send({ password: PASSWORD, confirm: 'DELETE' }),
    };
  }
  return { user, store, advance: (ms: number) => (clock += ms) };
}

const create = { 'If-None-Match': '*' };
const ifMatch = (v: number) => ({ 'If-Match': `"v${String(v)}"` });

describe('cloud saves', () => {
  it('uploads, lists (without thumbnails), downloads with ETag and deletes', async () => {
    const h = await harness();
    const a = await h.user('a@x.com');
    const up = await a.put('slot-1', save(1), create);
    expect(up.status).toBe(201);
    expect(up.headers['etag']).toBe('"v1"');
    const list = await a.list();
    expect((list.body as { saves: Info[] }).saves).toHaveLength(1);
    expect((list.body as { saves: Info[] }).saves[0]?.meta.thumbnail).toBeNull();
    const got = await a.get('slot-1');
    expect(got.headers['etag']).toBe('"v1"');
    expect(got.body).toMatchObject({
      slot: 'slot-1',
      version: 1,
      data: save(1).data,
      meta: { thumbnail: 'data:image/jpeg;base64,AAAA' },
    });
    expect(got.headers['cache-control']).toBe('no-store');
    expect((await a.del('slot-1', ifMatch(1))).status).toBe(204);
    expect((await a.get('slot-1')).status).toBe(404);
  });

  it('optimistic concurrency: a stale version is a 412 conflict with the current one, never an overwrite', async () => {
    const h = await harness();
    const a = await h.user('c@x.com');
    await a.put('slot-2', save(1), create);
    // Device B replaces v1 → v2.
    expect((await a.put('slot-2', save(2), ifMatch(1))).status).toBe(200);
    // Device A, still on v1, tries to replace v1.
    const stale = await a.put('slot-2', save(3), ifMatch(1));
    expect(stale.status).toBe(412);
    expect(stale.headers['etag']).toBe('"v2"');
    expect(stale.body).toMatchObject({
      error: 'conflict',
      current: { version: 2, meta: { gameDate: { minute: 2 } } },
    });
    expect((await a.get('slot-2')).body).toMatchObject({ version: 2, data: save(2).data });
    // Creating over an existing slot is also a conflict; a missing precondition is 428.
    expect((await a.put('slot-2', save(4), create)).status).toBe(412);
    expect((await a.put('slot-2', save(4), {})).status).toBe(428);
    expect((await a.del('slot-2', ifMatch(1))).status).toBe(412);
    expect((await a.del('slot-2', {})).status).toBe(428);
  });

  it('IDOR: another account cannot list, read, overwrite or delete your saves', async () => {
    const h = await harness();
    const a = await h.user('alice@x.com');
    const b = await h.user('bob@x.com');
    await a.put('slot-1', save(1), create);
    expect((await b.list()).body).toEqual({ saves: [] });
    expect((await b.get('slot-1')).status).toBe(404);
    expect((await b.del('slot-1', ifMatch(1))).status).toBe(404);
    // Bob's write lands in Bob's slot, Alice's is untouched.
    expect((await b.put('slot-1', save(9), create)).status).toBe(201);
    expect((await a.get('slot-1')).body).toMatchObject({ version: 1, data: save(1).data });
  });

  it('quotas: only 3 slots + auto, auto keeps the 3 newest versions', async () => {
    const h = await harness();
    const a = await h.user('q@x.com');
    expect((await a.put('slot-4', save(1), create)).status).toBe(404);
    expect((await a.put('quick', save(1), create)).status).toBe(404);
    await a.put('auto', save(1), create);
    for (let v = 1; v <= 4; v++) await a.put('auto', save(v + 1), ifMatch(v));
    const autos = ((await a.list()).body as { saves: Info[] }).saves.filter(
      (s) => s.slot === 'auto',
    );
    expect(autos.map((s) => s.version)).toEqual([5, 4, 3]);
    expect((await a.get('auto', '?version=3')).body).toMatchObject({ version: 3 });
    expect((await a.get('auto', '?version=1')).status).toBe(404);
  });

  it('validates integrity, format and size', async () => {
    const h = await harness();
    const a = await h.user('v@x.com');
    expect((await a.put('slot-1', { ...save(1), checksum: 'a'.repeat(64) }, create)).status).toBe(
      422,
    );
    const notSave = JSON.stringify({ hello: 1 });
    const wrong = {
      meta: meta(),
      data: notSave,
      checksum: createHash('sha256').update(notSave).digest('hex'),
    };
    expect((await a.put('slot-1', wrong, create)).status).toBe(422);
    expect((await a.put('slot-1', { ...save(1), extra: 1 }, create)).status).toBe(400);
    expect(
      (
        await a.put(
          'slot-1',
          { ...save(1), meta: { ...meta(), thumbnail: 'javascript:alert(1)' } },
          create,
        )
      ).status,
    ).toBe(400);
    const big = 'x'.repeat(1600 * 1024);
    expect(
      (await a.put('slot-1', { meta: meta(), data: big, checksum: 'a'.repeat(64) }, create)).status,
    ).toBe(400);
    const huge = await a.put(
      'slot-1',
      { meta: meta(), data: 'x'.repeat(2100 * 1024), checksum: 'a'.repeat(64) },
      create,
    );
    expect(huge.status).toBe(413);
  });

  it('needs a signed-in, verified account; honours the cloud-saves switch', async () => {
    const h = await harness({ disabled: ['cloud-saves'] });
    const u = await h.user('unverified@x.com', false);
    expect((await u.list()).status).toBe(403);
    const v = await h.user('verified@x.com');
    expect((await v.put('slot-1', save(1), create)).status).toBe(503);
    expect((await v.list()).status).toBe(200);
  });

  it('rate limit: 30 uploads per hour per user', async () => {
    const h = await harness({ policies: '{"authed-user":{"limit":1000}}' });
    const a = await h.user('rl@x.com');
    await a.put('auto', save(1), create);
    for (let v = 1; v < 30; v++) await a.put('auto', save(v + 1), ifMatch(v));
    const res = await a.put('auto', save(99), ifMatch(30));
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ policy: 'save-upload-user' });
  });

  it('account deletion erases the cloud saves', async () => {
    const h = await harness();
    const a = await h.user('gone@x.com');
    await a.put('slot-1', save(1), create);
    const { id } = (await a.me()).body as { id: string };
    expect(await h.store.list(id)).toHaveLength(1);
    expect((await a.deleteAccount()).status).toBe(204);
    expect(await h.store.list(id)).toEqual([]);
  });
});
