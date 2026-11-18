/**
 * Account progress (docs/systems/achievements.md → Account progress): achievements, Bloodline
 * nodes, Legacy awards, global stats and seen routes/endings. Every entry is keyed by
 * (user, kind, key): sending it again never duplicates it. Counters keep the highest value.
 */
import { z } from 'zod';

const Key = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- separator-delimited id: linear (timed in docs/security/test-report.md)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(64);
/** Epoch milliseconds; a time after the server clock is clamped to it by the route. */
const At = z.int().min(0);

export const ProgressEntry = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('achievement'), key: Key, at: At }),
  z.strictObject({ kind: z.literal('node'), key: Key, at: At }),
  z.strictObject({ kind: z.literal('route'), key: Key, at: At }),
  z.strictObject({ kind: z.literal('ending'), key: Key, at: At }),
  /** A Legacy award ("person@day", "goal:x", …) and its amount. */
  z.strictObject({
    kind: z.literal('legacy'),
    key: z
      .string()
      .regex(/^[\w:@.-]+$/)
      .max(80),
    value: z.int().min(1).max(1000),
    at: At,
  }),
  /** Lifetime counters: the highest value wins. */
  z.strictObject({
    kind: z.literal('stat'),
    key: z.enum(['nights', 'exorcisms']),
    value: z.int().min(0).max(1_000_000),
    at: At,
  }),
]);
export type ProgressEntry = z.infer<typeof ProgressEntry>;
export type ProgressKind = ProgressEntry['kind'];

/** Max entries per account (all kinds) — also the read cap. */
export const MAX_ENTRIES_PER_ACCOUNT = 6000;

export interface ProgressStore {
  /** Records entries idempotently; returns those that were new (or raised a counter). */
  add(userId: string, entries: readonly ProgressEntry[]): Promise<ProgressEntry[]>;
  list(userId: string, kinds?: readonly ProgressKind[]): Promise<ProgressEntry[]>;
  /** Erases every row of the account (account deletion). */
  remove(userId: string): Promise<void>;
}

const id = (e: Pick<ProgressEntry, 'kind' | 'key'>): string => `${e.kind}\u0000${e.key}`;

/** In-memory store (tests and local development without a database). */
export class MemoryProgressStore implements ProgressStore {
  private readonly users = new Map<string, Map<string, ProgressEntry>>();

  add(userId: string, entries: readonly ProgressEntry[]): Promise<ProgressEntry[]> {
    const rows = this.users.get(userId) ?? new Map<string, ProgressEntry>();
    this.users.set(userId, rows);
    const fresh: ProgressEntry[] = [];
    for (const e of entries) {
      const old = rows.get(id(e));
      if (old && !(e.kind === 'stat' && old.kind === 'stat' && e.value > old.value)) continue;
      if (!old && rows.size >= MAX_ENTRIES_PER_ACCOUNT) break;
      rows.set(id(e), e);
      fresh.push(e);
    }
    return Promise.resolve(fresh);
  }

  list(userId: string, kinds?: readonly ProgressKind[]): Promise<ProgressEntry[]> {
    const rows = [...(this.users.get(userId)?.values() ?? [])];
    return Promise.resolve(kinds ? rows.filter((r) => kinds.includes(r.kind)) : rows);
  }

  remove(userId: string): Promise<void> {
    this.users.delete(userId);
    return Promise.resolve();
  }
}
