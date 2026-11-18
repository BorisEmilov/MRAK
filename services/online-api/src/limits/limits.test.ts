import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { CSRF_HEADER } from '../auth/controller.js';
import { MemoryCounters } from '../auth/guards.js';
import { generateSigningJwk } from '../auth/keys.js';
import { BudgetedMailer, MemoryMailer } from '../auth/mailer.js';
import { MemoryAuthRepository } from '../auth/repository.js';
import { buildAuth } from '../auth/setup.js';
import { loadCatalog } from '../progress/catalog.js';
import { MemoryProgressStore } from '../progress/store.js';
import { MemoryLimiter, RedisLimiter, ResilientLimiter, type Limiter } from './limiter.js';
import { DEFAULT_POLICIES, HOUR, loadPolicies, MIN, type Policies } from './policies.js';
import { RedisSwitches, StaticSwitches, SWITCH_KEY, type SwitchName } from './switches.js';

const ORIGIN = 'https://play.mrak.game';
const PASSWORD = 'correct horse battery staple';
const catalog = loadCatalog(
  fileURLToPath(new URL('../../../../packages/content/data', import.meta.url)),
);

interface Problem {
  error: string;
  policy?: string;
}

async function harness(
  opts: { limiter?: Limiter; policies?: Policies; disabled?: SwitchName[] } = {},
) {
  let clock = Date.parse('2026-11-17T12:00:30Z');
  const now = () => new Date(clock);
  const limiter = opts.limiter ?? new MemoryLimiter(() => clock);
  const policies = opts.policies ?? loadPolicies();
  const repo = new MemoryAuthRepository();
  const auth = await buildAuth({
    repo,
    counters: new MemoryCounters(() => clock),
    mailer: new MemoryMailer(),
    jwtKeys: JSON.stringify([await generateSigningJwk('k1')]),
    issuer: 'i',
    audience: 'a',
    appUrl: 'https://play.mrak.game',
    secret: 'test-secret-test-secret-test-secret!!',
    http: { allowedOrigins: [ORIGIN], cookieDomain: '' },
    human: () => Promise.resolve(true),
    now,
    limits: { limiter, policies },
  });
  const app = createApp({
    auth,
    catalog,
    progress: new MemoryProgressStore(),
    corsOrigins: [ORIGIN],
    now,
    limiter,
    policies,
    switches: new StaticSwitches(new Set(opts.disabled ?? [])),
  });
  const agent = request(app);
  const post = (path: string, body: object, ip: string) =>
    agent
      .post(path)
      .set(CSRF_HEADER, '1')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send(body);
  /** Fires `n` requests; returns the statuses. */
  const burst = async (n: number, send: (i: number) => Promise<{ status: number }>) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await send(i)).status);
    return out;
  };
  const signIn = async (email: string, ip = '198.51.100.200') => {
    await post(
      '/v1/auth/register',
      { email, password: PASSWORD, captcha: 'x' },
      `10.9.${email.length}.1`,
    );
    const res = await post('/v1/auth/login', { email, password: PASSWORD }, ip);
    const cookie =
      ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? [])[0]?.split(';')[0] ??
      '';
    return { access: (res.body as { accessToken: string }).accessToken, cookie };
  };
  return {
    agent,
    post,
    burst,
    signIn,
    repo,
    auth,
    limiter,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** The last response of a burst must be a 429 for `policy`, with Retry-After and RateLimit. */
function expect429(
  res: { status: number; body: unknown; headers: Record<string, string> },
  policy: string,
) {
  expect(res.status).toBe(429);
  expect((res.body as Problem).policy).toBe(policy);
  expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  expect(res.headers['ratelimit']).toContain(`"${policy}";r=0`);
  expect(res.headers['ratelimit-policy']).toContain(`"${policy}"`);
}

describe('one 429 per application limit', () => {
  it('login: 5/min per IP+email', async () => {
    const h = await harness();
    const statuses = await h.burst(5, () =>
      h.post('/v1/auth/login', { email: 'a@x.com', password: 'nope nope nope' }, '1.1.1.1'),
    );
    expect(statuses.every((s) => s !== 429)).toBe(true);
    expect429(
      await h.post('/v1/auth/login', { email: 'a@x.com', password: 'nope nope nope' }, '1.1.1.1'),
      'login-ip-email',
    );
    // Another email from the same IP is still allowed.
    expect(
      (await h.post('/v1/auth/login', { email: 'b@x.com', password: 'nope nope nope' }, '1.1.1.1'))
        .status,
    ).not.toBe(429);
  });

  it('login: 20/min per IP', async () => {
    const h = await harness();
    await h.burst(20, (i) =>
      h.post(
        '/v1/auth/login',
        { email: `u${String(i)}@x.com`, password: 'nope nope nope', captcha: 'x' },
        '1.1.1.2',
      ),
    );
    expect429(
      await h.post(
        '/v1/auth/login',
        { email: 'z@x.com', password: 'nope nope nope', captcha: 'x' },
        '1.1.1.2',
      ),
      'login-ip',
    );
  });

  it('register: 3/hour per IP and 5 accounts per IP per day', async () => {
    const h = await harness();
    const reg = (i: number) =>
      h.post(
        '/v1/auth/register',
        { email: `r${String(i)}@x.com`, password: PASSWORD, captcha: 'x' },
        '1.1.1.3',
      );
    expect(await h.burst(3, reg)).toEqual([202, 202, 202]);
    expect429(await reg(3), 'register-ip');
    h.advance(2 * HOUR);
    expect(await h.burst(2, (i) => reg(10 + i))).toEqual([202, 202]);
    expect429(await reg(20), 'register-ip-day');
  });

  it('forgot-password and resend: 3/hour per email, 10/hour per IP', async () => {
    const h = await harness();
    await h.burst(3, (i) =>
      h.post('/v1/auth/forgot-password', { email: 'f@x.com', captcha: 'x' }, `2.2.2.${String(i)}`),
    );
    expect429(
      await h.post('/v1/auth/resend-verification', { email: 'F@x.com', captcha: 'x' }, '2.2.2.9'),
      'email-send-email',
    );
    await h.burst(10, (i) =>
      h.post(
        '/v1/auth/resend-verification',
        { email: `e${String(i)}@x.com`, captcha: 'x' },
        '2.2.3.1',
      ),
    );
    expect429(
      await h.post('/v1/auth/forgot-password', { email: 'other@x.com', captcha: 'x' }, '2.2.3.1'),
      'email-send-ip',
    );
  });

  it('refresh: 30/hour per session', async () => {
    const h = await harness();
    let { cookie } = await h.signIn('s@x.com');
    for (let i = 0; i < 30; i++) {
      const r = await h.agent
        .post('/v1/auth/refresh')
        .set(CSRF_HEADER, '1')
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send({});
      expect(r.status).toBe(200);
      cookie = ((r.headers['set-cookie'] as unknown as string[])[0] ?? '').split(';')[0] ?? '';
      h.advance(61_000); // stay under the per-IP refresh limit
    }
    const res = await h.agent
      .post('/v1/auth/refresh')
      .set(CSRF_HEADER, '1')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('achievements unlock: 120/hour per user', async () => {
    const h = await harness();
    const { access } = await h.signIn('ach@x.com');
    const unlock = () =>
      h.agent
        .post('/v1/achievements/unlock')
        .set('Authorization', `Bearer ${access}`)
        .send({ achievements: [{ id: 'prologue', at: 1 }] });
    await h.burst(100, unlock);
    h.advance(2 * MIN); // the per-minute user limit rolls over, the hourly one does not
    await h.burst(20, unlock);
    expect429(await unlock(), 'achievements-unlock-user');
  });

  it('every other signed-in route: 120/min per user, keyed by the verified user', async () => {
    const h = await harness();
    const a = await h.signIn('me@x.com', '3.3.3.1');
    const b = await h.signIn('you@x.com', '3.3.3.1');
    const me = (t: string) =>
      h.agent.get('/v1/me').set('Authorization', `Bearer ${t}`).set('X-Forwarded-For', '3.3.3.1');
    expect((await h.burst(120, () => me(a.access))).every((s) => s === 200)).toBe(true);
    expect429(await me(a.access), 'authed-user');
    // Same IP, other user: own budget. A forged token falls back to the IP key, not the victim's.
    expect((await me(b.access)).status).toBe(200);
    const [head, payload] = a.access.split('.');
    expect((await me(`${head ?? ''}.${payload ?? ''}.AAAA`)).status).toBe(401);
  });

  it('public routes: per IP (health 120/min, seasonal 30/min)', async () => {
    const h = await harness();
    await h.burst(30, () => h.agent.get('/v1/seasonal').set('X-Forwarded-For', '4.4.4.4'));
    expect429(await h.agent.get('/v1/seasonal').set('X-Forwarded-For', '4.4.4.4'), 'seasonal-ip');
  });

  it.each([
    ['save-upload-user', 30],
    ['checkout-user', 5],
    ['telemetry-install', 60],
  ] as const)('%s allows %i per hour (policy ready for its endpoint)', async (name, limit) => {
    let t = 0;
    const limiter = new MemoryLimiter(() => t);
    const policy = DEFAULT_POLICIES[name];
    expect(policy).toMatchObject({ limit, windowMs: HOUR });
    for (let i = 0; i < limit; i++) expect((await limiter.consume('k', policy)).allowed).toBe(true);
    const denied = await limiter.consume('k', policy);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    t += 2 * HOUR;
    expect((await limiter.consume('k', policy)).allowed).toBe(true);
  });

  it('sends RateLimit headers on allowed requests and reads overrides from the environment', async () => {
    const h = await harness({ policies: loadPolicies('{"public-ip":{"limit":2}}') });
    const ok = await h.agent.get('/health');
    expect(ok.headers['ratelimit-policy']).toBe('"public-ip";q=2;w=60');
    expect(ok.headers['ratelimit']).toMatch(/^"public-ip";r=1;t=\d+$/);
    await h.agent.get('/health');
    expect((await h.agent.get('/health')).status).toBe(429);
    expect(() => loadPolicies('{"no-such":{"limit":1}}')).toThrow();
  });
});

describe('sliding window', () => {
  it('weights the previous window instead of resetting at the boundary', async () => {
    let t = 0;
    const l = new MemoryLimiter(() => t);
    const policy = { limit: 10, windowMs: 1000, key: 'ip' as const, failClosed: false };
    for (let i = 0; i < 10; i++) await l.consume('k', policy);
    t = 1100; // 10 % into the next window: the previous 10 still weigh 9
    expect((await l.consume('k', policy)).allowed).toBe(true);
    expect((await l.consume('k', policy)).allowed).toBe(false);
    t = 1600;
    expect((await l.consume('k', policy)).allowed).toBe(true);
  });
});

describe('Redis unavailable', () => {
  const broken = new Redis(6390, '127.0.0.1', {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  broken.on('error', () => undefined);
  afterAll(() => {
    broken.disconnect();
  });

  it('auth fails closed (503) and the rest keeps limits in memory — never unlimited', async () => {
    let degraded = 0;
    const limiter = new ResilientLimiter(new RedisLimiter(broken), new MemoryLimiter(), () => {
      degraded += 1;
    });
    const h = await harness({ limiter });
    const login = await h.post(
      '/v1/auth/login',
      { email: 'a@x.com', password: PASSWORD },
      '5.5.5.5',
    );
    expect(login.status).toBe(503);
    expect((login.body as Problem).error).toBe('unavailable');
    expect(Number(login.headers['retry-after'])).toBeGreaterThan(0);
    const statuses = await h.burst(121, () =>
      h.agent.get('/health').set('X-Forwarded-For', '5.5.5.6'),
    );
    expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true);
    expect(statuses[120]).toBe(429);
    expect(degraded).toBeGreaterThan(0);
  });
});

const hasRedis = spawnSync('redis-server', ['--version']).status === 0;

describe.runIf(hasRedis)('with a real Redis', () => {
  const port = 6400 + Math.floor(Math.random() * 500);
  let server: ChildProcess;
  let redis: Redis;
  beforeAll(async () => {
    server = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no']);
    redis = new Redis(port, '127.0.0.1', { maxRetriesPerRequest: 1 });
    redis.on('error', () => undefined);
    for (let i = 0; i < 50; i++) {
      try {
        await redis.ping();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  });
  afterAll(() => {
    redis.disconnect();
    server.kill();
  });

  it('two instances share one counter atomically', async () => {
    const a = new RedisLimiter(redis, () => 1_000_000, 't1:');
    const b = new RedisLimiter(redis, () => 1_000_000, 't1:');
    const policy = DEFAULT_POLICIES['login-ip-email'];
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).consume('k', policy)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it('switches flip at runtime without a deploy', async () => {
    let t = 0;
    const switches = new RedisSwitches(redis, new Set(), () => t);
    expect(await switches.enabled('registration')).toBe(true);
    await redis.hset(SWITCH_KEY, 'registration', 'off');
    expect(await switches.enabled('registration')).toBe(true); // cached ≤ 5 s
    t += 5000;
    expect(await switches.enabled('registration')).toBe(false);
    await redis.hdel(SWITCH_KEY, 'registration');
  });
});

describe('emergency switches', () => {
  it('registration off → 503 feature_disabled with Retry-After', async () => {
    const h = await harness({ disabled: ['registration'] });
    const res = await h.post(
      '/v1/auth/register',
      { email: 'a@x.com', password: PASSWORD, captcha: 'x' },
      '6.6.6.6',
    );
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'feature_disabled', feature: 'registration' });
    expect(res.headers['retry-after']).toBe('300');
    // Sign-in keeps working.
    expect(
      (await h.post('/v1/auth/login', { email: 'a@x.com', password: PASSWORD }, '6.6.6.7')).status,
    ).toBe(401);
  });

  it('cloud-saves off → progress writes 503, reads still work', async () => {
    const h = await harness({ disabled: ['cloud-saves'] });
    const { access } = await h.signIn('cs@x.com');
    const write = await h.agent
      .post('/v1/progress')
      .set('Authorization', `Bearer ${access}`)
      .send({ entries: [] });
    expect(write.status).toBe(503);
    expect((await h.agent.get('/v1/me').set('Authorization', `Bearer ${access}`)).status).toBe(200);
  });

  it('emails off or over the daily budget → nothing is sent; alerts at 50 %, 80 % and 100 %', async () => {
    const inner = new MemoryMailer();
    const alerts: number[] = [];
    let on = true;
    const mailer = new BudgetedMailer(
      inner,
      new MemoryCounters(),
      10,
      () => Promise.resolve(on),
      (e) => alerts.push(e.level),
    );
    for (let i = 0; i < 12; i++)
      await mailer.send({ to: `${String(i)}@x.com`, kind: 'verify-email' });
    expect(inner.sent).toHaveLength(10);
    expect(alerts).toEqual([50, 80, 100]);
    on = false;
    const fresh = new BudgetedMailer(
      inner,
      new MemoryCounters(),
      10,
      () => Promise.resolve(on),
      () => undefined,
    );
    await fresh.send({ to: 'x@x.com', kind: 'verify-email' });
    expect(inner.sent).toHaveLength(10);
  });
});

describe('quotas', () => {
  it('keeps at most 10 active sessions (least recently used revoked)', async () => {
    const h = await harness({
      policies: loadPolicies('{"login-ip-email":{"limit":100},"login-ip":{"limit":100}}'),
    });
    const first = await h.signIn('many@x.com');
    for (let i = 0; i < 10; i++) {
      h.advance(1000);
      await h.post('/v1/auth/login', { email: 'many@x.com', password: PASSWORD }, '7.7.7.7');
    }
    const user = [...h.repo.users.values()][0];
    const active = [...h.repo.sessionRows.values()].filter(
      (s) => s.userId === user?.id && !s.revokedAt,
    );
    expect(active).toHaveLength(10);
    expect(
      (await h.agent.get('/v1/me').set('Authorization', `Bearer ${first.access}`)).status,
    ).toBe(401);
  });

  it('deletes accounts left unverified for 7 days', async () => {
    const h = await harness();
    await h.post(
      '/v1/auth/register',
      { email: 'old@x.com', password: PASSWORD, captcha: 'x' },
      '8.8.8.1',
    );
    h.advance(6 * 24 * HOUR);
    await h.post(
      '/v1/auth/register',
      { email: 'new@x.com', password: PASSWORD, captcha: 'x' },
      '8.8.8.2',
    );
    expect(await h.auth.deps.service.purgeUnverified()).toBe(0);
    h.advance(1 * 24 * HOUR + 1000);
    expect(await h.auth.deps.service.purgeUnverified()).toBe(1);
    expect([...h.repo.users.values()].map((u) => u.email)).toEqual(['new@x.com']);
  });
});
