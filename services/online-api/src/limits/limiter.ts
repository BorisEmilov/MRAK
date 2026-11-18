/**
 * Sliding-window-counter limiter: the previous fixed window is weighted by how much of it still
 * overlaps the sliding window. Redis (atomic Lua, shared by every instance) with a per-process
 * memory fallback. Fail-closed policies are rejected while Redis is unavailable.
 */
import type { Redis } from 'ioredis';
import type { Policy } from './policies.js';

export interface Decision {
  allowed: boolean;
  /** Requests left in the window after this one. */
  remaining: number;
  /** ms until a denied request may succeed (0 when allowed). */
  retryAfterMs: number;
  /** ms until the window rolls over. */
  resetMs: number;
  /** The shared store was unavailable and the policy fails closed. */
  unavailable?: boolean;
}

export interface Limiter {
  consume(key: string, policy: Policy): Promise<Decision>;
}

function decide(
  prev: number,
  curr: number,
  policy: Policy,
  elapsed: number,
  ok: boolean,
): Decision {
  const W = policy.windowMs;
  const resetMs = W - elapsed;
  const weighted = (prev * (W - elapsed)) / W + curr;
  if (ok)
    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(policy.limit - weighted)),
      retryAfterMs: 0,
      resetMs,
    };
  // Wait until the weighted count leaves room for one more request.
  const retry =
    curr + 1 > policy.limit
      ? // This window is full: wait for it to end and its weight to fall enough.
        resetMs + W * (1 - (policy.limit - 1) / Math.max(curr, 1))
      : // The previous window's weight must fall by enough for one more request.
        resetMs - ((policy.limit - curr - 1) * W) / Math.max(prev, 1);
  return { allowed: false, remaining: 0, retryAfterMs: Math.max(1000, Math.ceil(retry)), resetMs };
}

/** Per-process limiter (tests, fallback when Redis is down). */
export class MemoryLimiter implements Limiter {
  private readonly rows = new Map<string, number>();
  private sweepAt = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  consume(key: string, policy: Policy): Promise<Decision> {
    const now = this.clock();
    const W = policy.windowMs;
    const window = Math.floor(now / W);
    const elapsed = now - window * W;
    const currKey = `${key}:${String(window)}`;
    const prev = this.rows.get(`${key}:${String(window - 1)}`) ?? 0;
    const curr = this.rows.get(currKey) ?? 0;
    const ok = (prev * (W - elapsed)) / W + curr + 1 <= policy.limit;
    if (ok) this.rows.set(currKey, curr + 1);
    this.sweep(now);
    return Promise.resolve(decide(prev, ok ? curr + 1 : curr, policy, elapsed, ok));
  }

  /** Bounded memory: forget every counter every 10 minutes beyond the longest windows' need. */
  private sweep(now: number): void {
    if (this.rows.size < 50_000 || now < this.sweepAt) return;
    this.rows.clear();
    this.sweepAt = now + 10 * 60_000;
  }
}

const SCRIPT = `
local prev = tonumber(redis.call('GET', KEYS[2]) or '0')
local curr = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local elapsed = tonumber(ARGV[3])
if prev * (window - elapsed) / window + curr + 1 > limit then
  return {0, prev, curr}
end
curr = redis.call('INCR', KEYS[1])
if curr == 1 then redis.call('PEXPIRE', KEYS[1], window * 2) end
return {1, prev, curr}
`;

export class RedisLimiter implements Limiter {
  constructor(
    private readonly redis: Redis,
    private readonly clock: () => number = Date.now,
    private readonly prefix = 'mrak:rl:',
  ) {}

  async consume(key: string, policy: Policy): Promise<Decision> {
    const now = this.clock();
    const W = policy.windowMs;
    const window = Math.floor(now / W);
    const elapsed = now - window * W;
    const base = `${this.prefix}${key}:`;
    const [ok, prev, curr] = (await this.redis.eval(
      SCRIPT,
      2,
      `${base}${String(window)}`,
      `${base}${String(window - 1)}`,
      String(policy.limit),
      String(W),
      String(elapsed),
    )) as [number, number, number];
    return decide(prev, curr, policy, elapsed, ok === 1);
  }
}

/**
 * Redis first; on error: fail-closed policies are refused (`unavailable`), the others use the
 * memory limiter. Never unlimited.
 */
export class ResilientLimiter implements Limiter {
  constructor(
    private readonly primary: Limiter | null,
    private readonly fallback: Limiter,
    private readonly onDegraded: (err: unknown) => void = () => undefined,
  ) {}

  async consume(key: string, policy: Policy): Promise<Decision> {
    if (!this.primary) return this.fallback.consume(key, policy);
    try {
      return await this.primary.consume(key, policy);
    } catch (err) {
      this.onDegraded(err);
      if (policy.failClosed)
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: 5000,
          resetMs: 5000,
          unavailable: true,
        };
      return this.fallback.consume(key, policy);
    }
  }
}
