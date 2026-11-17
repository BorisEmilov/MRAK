/**
 * Abuse guards: Turnstile verification, rotating-salt IP hashing, shared counters (Redis or memory)
 * and the progressive login throttle (threat model C-04, C-05, C-09, C-11, C-34).
 */
import { createHmac } from 'node:crypto';
import type { Redis } from 'ioredis';
import { z } from 'zod';

// ------------------------------------------------------------------ Turnstile

export type HumanCheck = (
  token: string | undefined,
  ip: string,
  action: string,
) => Promise<boolean>;

const SiteVerify = z.object({
  success: z.boolean(),
  action: z.string().optional(),
  hostname: z.string().optional(),
});

/** Cloudflare Turnstile `siteverify`; checks action and hostname; fails closed. */
export function turnstile(
  secret: string,
  hostnames: readonly string[],
  fetchImpl: typeof fetch = fetch,
): HumanCheck {
  return async (token, ip, action) => {
    if (!token || token.length > 2048) return false;
    try {
      const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(5000),
      });
      const r = SiteVerify.safeParse(await res.json());
      return (
        r.success &&
        r.data.success &&
        r.data.action === action &&
        r.data.hostname !== undefined &&
        hostnames.includes(r.data.hostname)
      );
    } catch {
      return false;
    }
  };
}

// ------------------------------------------------------------------ hashing of identifiers

/** HMAC of an IP with a salt that rotates every UTC day: linkable within a day, not beyond. */
export function ipHasher(secret: string): (ip: string, now: Date) => string {
  return (ip, now) => {
    const salt = createHmac('sha256', secret)
      .update(`ip:${now.toISOString().slice(0, 10)}`)
      .digest();
    return createHmac('sha256', salt).update(ip).digest('hex');
  };
}

/** Stable keyed hash (user agents, emails in rate-limit keys); not reversible without the secret. */
export function keyedHash(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

// ------------------------------------------------------------------ counters

export interface Counters {
  /** Increments and returns the count; the window starts with the first hit. */
  hit(key: string, windowMs: number): Promise<number>;
  get(key: string): Promise<number>;
  reset(key: string): Promise<void>;
  /** Sets a block until `until` (ms epoch). */
  block(key: string, until: number): Promise<void>;
  blockedUntil(key: string): Promise<number>;
}

export class MemoryCounters implements Counters {
  private readonly rows = new Map<string, { n: number; expires: number }>();
  constructor(private readonly clock: () => number = Date.now) {}
  private live(key: string) {
    const r = this.rows.get(key);
    if (r && r.expires <= this.clock()) this.rows.delete(key);
    return this.rows.get(key);
  }
  hit(key: string, windowMs: number): Promise<number> {
    const r = this.live(key) ?? { n: 0, expires: this.clock() + windowMs };
    r.n += 1;
    this.rows.set(key, r);
    return Promise.resolve(r.n);
  }
  get(key: string): Promise<number> {
    return Promise.resolve(this.live(key)?.n ?? 0);
  }
  reset(key: string): Promise<void> {
    this.rows.delete(key);
    return Promise.resolve();
  }
  block(key: string, until: number): Promise<void> {
    this.rows.set(`block:${key}`, { n: until, expires: until });
    return Promise.resolve();
  }
  blockedUntil(key: string): Promise<number> {
    return Promise.resolve(this.live(`block:${key}`)?.n ?? 0);
  }
}

export class RedisCounters implements Counters {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'mrak:auth:',
  ) {}
  async hit(key: string, windowMs: number): Promise<number> {
    const k = this.prefix + key;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.pexpire(k, windowMs);
    return n;
  }
  async get(key: string): Promise<number> {
    return Number((await this.redis.get(this.prefix + key)) ?? 0);
  }
  async reset(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
  async block(key: string, until: number): Promise<void> {
    await this.redis.set(`${this.prefix}block:${key}`, String(until), 'PXAT', until);
  }
  async blockedUntil(key: string): Promise<number> {
    return Number((await this.redis.get(`${this.prefix}block:${key}`)) ?? 0);
  }
}

// ------------------------------------------------------------------ progressive login throttle

export const THROTTLE = {
  /** Failures (per account or per IP) after which Turnstile is required at login. */
  captchaAfter: 3,
  /** Failures after which each further failure blocks for 2^(n - freeFailures) s. */
  freeFailures: 5,
  maxBlockMs: 15 * 60_000,
  windowMs: 60 * 60_000,
  /** Per-IP failures count across all accounts with a higher allowance (shared NATs). */
  ipFactor: 4,
} as const;

export class LoginThrottle {
  constructor(
    private readonly counters: Counters,
    private readonly clock: () => number,
  ) {}

  private keys(account: string, ip: string): [string, string] {
    return [`login:acct:${account}`, `login:ip:${ip}`];
  }

  /** ms until login may be tried again (0: now), and whether a human check is required. */
  async status(account: string, ip: string): Promise<{ retryAfterMs: number; captcha: boolean }> {
    const [a, i] = this.keys(account, ip);
    const now = this.clock();
    const until = Math.max(
      await this.counters.blockedUntil(a),
      await this.counters.blockedUntil(i),
    );
    const fa = await this.counters.get(a);
    const fi = await this.counters.get(i);
    return {
      retryAfterMs: Math.max(0, until - now),
      captcha: fa >= THROTTLE.captchaAfter || fi >= THROTTLE.captchaAfter * THROTTLE.ipFactor,
    };
  }

  async failed(account: string, ip: string): Promise<void> {
    const [a, i] = this.keys(account, ip);
    const now = this.clock();
    const block = async (key: string, n: number, free: number): Promise<void> => {
      if (n <= free) return;
      const ms = Math.min(2 ** (n - free) * 1000, THROTTLE.maxBlockMs);
      await this.counters.block(key, now + ms);
    };
    await block(a, await this.counters.hit(a, THROTTLE.windowMs), THROTTLE.freeFailures);
    await block(
      i,
      await this.counters.hit(i, THROTTLE.windowMs),
      THROTTLE.freeFailures * THROTTLE.ipFactor,
    );
  }

  /** A success clears the account counter (never the IP one: stuffing hits many accounts). */
  async succeeded(account: string): Promise<void> {
    await this.counters.reset(`login:acct:${account}`);
  }
}
