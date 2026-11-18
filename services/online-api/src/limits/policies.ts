/**
 * Rate-limit policies (threat model C-05). Each route names the policies it consumes; every
 * policy has a limit, a window, what it is keyed by and whether it fails closed when Redis is
 * down (auth: reject; the rest: fall back to per-process memory limits — never unlimited).
 * Override per environment with RATE_LIMITS='{"login-ip":{"limit":40}}'.
 */
import { z } from 'zod';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export type KeyKind = 'ip' | 'ip+email' | 'email' | 'user' | 'session' | 'install';

export interface Policy {
  limit: number;
  windowMs: number;
  key: KeyKind;
  /** Redis unavailable → reject (503) instead of falling back to memory. */
  failClosed: boolean;
}

const p = (limit: number, windowMs: number, key: KeyKind, failClosed = false): Policy => ({
  limit,
  windowMs,
  key,
  failClosed,
});

export const DEFAULT_POLICIES = {
  // --- auth (fail closed)
  'login-ip-email': p(5, MIN, 'ip+email', true),
  'login-ip': p(20, MIN, 'ip', true),
  'register-ip': p(3, HOUR, 'ip', true),
  /** New accounts per IP per day (anti-bot, task 6). */
  'register-ip-day': p(5, DAY, 'ip', true),
  'email-send-email': p(3, HOUR, 'email', true),
  'email-send-ip': p(10, HOUR, 'ip', true),
  'auth-token-ip': p(20, 15 * MIN, 'ip', true),
  'refresh-ip': p(60, MIN, 'ip', true),
  'refresh-session': p(30, HOUR, 'session', true),
  'logout-ip': p(30, MIN, 'ip', true),
  'sensitive-user': p(5, 15 * MIN, 'user', true),
  // --- signed-in features
  'authed-user': p(120, MIN, 'user'),
  'export-user': p(3, DAY, 'user'),
  'achievements-unlock-user': p(120, HOUR, 'user'),
  'progress-write-user': p(120, HOUR, 'user'),
  'save-upload-user': p(30, HOUR, 'user'),
  'checkout-user': p(5, HOUR, 'user', true),
  'checkout-ip': p(10, HOUR, 'ip', true),
  'content-url-user': p(30, DAY, 'user', true),
  'collector-name-user': p(5, DAY, 'user'),
  'telemetry-install': p(60, HOUR, 'install'),
  'telemetry-ip': p(600, HOUR, 'ip'),
  // --- public
  'public-ip': p(120, MIN, 'ip'),
  'seasonal-ip': p(30, MIN, 'ip'),
  'newsletter-ip': p(5, HOUR, 'ip'),
  'bug-report-ip': p(10, HOUR, 'ip'),
  /** Payment provider webhooks (retries included); signatures do the real gatekeeping. */
  'webhook-ip': p(300, MIN, 'ip'),
} satisfies Record<string, Policy>;

export type PolicyName = keyof typeof DEFAULT_POLICIES;
export type Policies = Record<PolicyName, Policy>;

const Override = z.record(
  z.string(),
  z.strictObject({
    limit: z.int().min(1).max(1_000_000).optional(),
    windowMs: z
      .int()
      .min(1000)
      .max(31 * DAY)
      .optional(),
  }),
);

/** Defaults with the environment overrides applied (unknown names are an error). */
export function loadPolicies(json?: string): Policies {
  const out: Policies = structuredClone(DEFAULT_POLICIES);
  if (!json) return out;
  for (const [name, o] of Object.entries(Override.parse(JSON.parse(json)))) {
    if (!(name in out)) throw new Error(`RATE_LIMITS: unknown policy "${name}"`);
    Object.assign(out[name as PolicyName], o);
  }
  return out;
}
