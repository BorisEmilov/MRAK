/**
 * Account progress endpoints (docs/systems/achievements.md → Account progress). Need an account:
 * the authenticator is injected (createApp `authenticate`); until accounts exist every request
 * is 401. Achievements give no advantage or money: the client is untrusted, but ids, tiers and
 * sizes are validated, writes are idempotent and rate-limited, and nothing is public.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Catalog } from '../progress/catalog.js';
import { problem } from '../middleware/problem.js';
import { ProgressEntry, type ProgressStore } from '../progress/store.js';
import { defineRoute } from './defineRoute.js';

export interface Account {
  userId: string;
  /** Purchased entitlements ("full-game" unlocks full-tier ids). */
  entitlements: readonly string[];
  /** Email verified: required for account progress (threat model C-10). */
  verified: boolean;
}
export type Authenticate = (req: Request) => Promise<Account | null>;

export const FULL_GAME = 'full-game';
export const MAX_BATCH = 50;

interface Deps {
  account: Account;
  store: ProgressStore;
  catalog: Catalog;
  now: Date;
}

/** Resolves the account and services, or answers 401/503 itself. */
async function deps(req: Request, res: Response): Promise<Deps | null> {
  const locals = req.app.locals as Record<string, unknown>;
  const authenticate = locals['authenticate'] as Authenticate | undefined;
  const store = locals['progress'] as ProgressStore | undefined;
  const catalog = locals['catalog'] as Catalog | undefined;
  const account = authenticate ? await authenticate(req) : null;
  if (!account) {
    res.set('WWW-Authenticate', 'Bearer');
    problem(res, 401, 'unauthorized');
    return null;
  }
  if (!account.verified) {
    problem(res, 403, 'email_not_verified');
    return null;
  }
  if (!store || !catalog) {
    problem(res, 503, 'unavailable');
    return null;
  }
  const now = (locals['now'] as () => Date)();
  return { account, store, catalog, now };
}

/** Why the account may not record this entry (null: it may). */
function refusal(e: ProgressEntry, { account, catalog }: Deps): 'unknown' | 'entitlement' | null {
  const def =
    e.kind === 'achievement'
      ? catalog.achievement(e.key)
      : e.kind === 'node'
        ? catalog.node(e.key)
        : { tier: 'demo' as const };
  if (!def) return 'unknown';
  if (def.tier === 'full' && !account.entitlements.includes(FULL_GAME)) return 'entitlement';
  return null;
}

async function record(req: Request, res: Response, entries: unknown): Promise<void> {
  const d = await deps(req, res);
  if (!d) return;
  const parsed = z.array(ProgressEntry).min(1).max(MAX_BATCH).safeParse(entries);
  if (!parsed.success) {
    problem(res, 400, 'bad_request');
    return;
  }
  const accepted: ProgressEntry[] = [];
  const rejected: { kind: string; key: string; reason: string }[] = [];
  for (const e of parsed.data) {
    const reason = refusal(e, d);
    if (reason) rejected.push({ kind: e.kind, key: e.key, reason });
    // A clock in the future is clamped to the server's.
    else accepted.push({ ...e, at: Math.min(e.at, d.now.getTime()) });
  }
  const fresh = await d.store.add(d.account.userId, accepted);
  res.status(200).json({ recorded: fresh.map((e) => ({ kind: e.kind, key: e.key })), rejected });
}

const Recorded = z.object({
  recorded: z.array(z.object({ kind: z.string(), key: z.string() })),
  rejected: z.array(
    z.object({ kind: z.string(), key: z.string(), reason: z.enum(['unknown', 'entitlement']) }),
  ),
});
const errors = {
  400: { description: 'Malformed body or more than 50 items.' },
  401: { description: 'No account.' },
  403: { description: 'Email not verified.' },
  429: { description: 'Rate limit exceeded.' },
};

const AchievementUnlock = z.strictObject({
  achievements: z
    .array(z.strictObject({ id: z.string().max(64), at: z.int().min(0) }))
    .min(1)
    .max(MAX_BATCH),
});

export const unlockAchievementsRoute = defineRoute({
  method: 'post',
  path: '/v1/achievements/unlock',
  rateLimit: { windowMs: 60_000, limit: 20 },
  handler: async (req, res) => {
    const body = AchievementUnlock.safeParse(req.body);
    if (!body.success) {
      problem(res, 400, 'bad_request');
      return;
    }
    await record(
      req,
      res,
      body.data.achievements.map((a) => ({ kind: 'achievement', key: a.id, at: a.at })),
    );
  },
  doc: {
    tag: 'progress',
    bearer: true,
    summary: 'Record unlocked achievements (idempotent per account + achievement id)',
    body: AchievementUnlock,
    responses: {
      200: { description: 'What was new and what was refused.', schema: Recorded },
      ...errors,
    },
  },
});

export const listAchievementsRoute = defineRoute({
  method: 'get',
  path: '/v1/achievements',
  rateLimit: { windowMs: 60_000, limit: 30 },
  handler: async (req, res) => {
    const d = await deps(req, res);
    if (!d) return;
    const rows = await d.store.list(d.account.userId, ['achievement']);
    res.status(200).json({ achievements: rows.map((r) => ({ id: r.key, at: r.at })) });
  },
  doc: {
    tag: 'progress',
    bearer: true,
    summary: "The account's unlocked achievements",
    responses: {
      200: {
        description: 'Unlocked achievements (≤ 6000).',
        schema: z.object({
          achievements: z.array(z.object({ id: z.string(), at: z.int() })).max(6000),
        }),
      },
      ...errors,
    },
  },
});

const ProgressBody = z.strictObject({ entries: z.array(z.unknown()).min(1).max(MAX_BATCH) });

export const recordProgressRoute = defineRoute({
  method: 'post',
  path: '/v1/progress',
  rateLimit: { windowMs: 60_000, limit: 20 },
  handler: async (req, res) => {
    const body = ProgressBody.safeParse(req.body);
    if (!body.success) {
      problem(res, 400, 'bad_request');
      return;
    }
    await record(req, res, body.data.entries);
  },
  doc: {
    tag: 'progress',
    bearer: true,
    summary: 'Record account progress (Bloodline, Legacy, stats, routes, endings); idempotent',
    body: z.object({ entries: z.array(ProgressEntry).min(1).max(MAX_BATCH) }),
    responses: {
      200: { description: 'What was new and what was refused.', schema: Recorded },
      ...errors,
    },
  },
});

export const listProgressRoute = defineRoute({
  method: 'get',
  path: '/v1/progress',
  rateLimit: { windowMs: 60_000, limit: 30 },
  handler: async (req, res) => {
    const d = await deps(req, res);
    if (!d) return;
    res.status(200).json({ entries: await d.store.list(d.account.userId) });
  },
  doc: {
    tag: 'progress',
    bearer: true,
    summary: 'All progress rows of the account (≤ 6000)',
    responses: {
      200: {
        description: 'Progress rows.',
        schema: z.object({ entries: z.array(ProgressEntry).max(6000) }),
      },
      ...errors,
    },
  },
});
