/**
 * Account progress sync (docs/systems/achievements.md → Account progress). Achievements, Bloodline
 * nodes, Legacy awards and global stats are account-level: kept in the local profile (guests) and,
 * with an account, sent to online-api. Entries wait in an IndexedDB outbox (survives reloads and
 * offline play, independent of saves) and are retried with backoff; the server is idempotent per
 * (account, kind, key), so resending is always safe.
 */
import { ApiError, PROGRESS_BATCH, type OnlineClient, type ProgressEntry } from '@mrak/api-client';
import { emptyProfile, type ContentDatabase, type Profile } from '@mrak/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type { ProgressEntry };

/** Outbox key: counters are per value (a higher one supersedes), the rest per (kind, key). */
const keyOf = (e: ProgressEntry): string => `${e.kind}:${e.key}`;

export interface Outbox {
  put(entries: readonly ProgressEntry[]): Promise<void>;
  all(): Promise<ProgressEntry[]>;
  remove(entries: readonly ProgressEntry[]): Promise<void>;
}

export class MemoryOutbox implements Outbox {
  private readonly rows = new Map<string, ProgressEntry>();
  put(entries: readonly ProgressEntry[]): Promise<void> {
    for (const e of entries) this.rows.set(keyOf(e), e);
    return Promise.resolve();
  }
  all(): Promise<ProgressEntry[]> {
    return Promise.resolve([...this.rows.values()]);
  }
  remove(entries: readonly ProgressEntry[]): Promise<void> {
    // Only what was sent: a counter raised meanwhile stays queued.
    for (const e of entries) if (this.rows.get(keyOf(e)) === e) this.rows.delete(keyOf(e));
    return Promise.resolve();
  }
}

interface OutboxDb extends DBSchema {
  outbox: { key: string; value: { id: string; entry: ProgressEntry } };
}

export class IdbOutbox implements Outbox {
  private constructor(private readonly db: IDBPDatabase<OutboxDb>) {}

  static async open(name = 'mrak-account'): Promise<IdbOutbox> {
    const db = await openDB<OutboxDb>(name, 1, {
      upgrade(database) {
        database.createObjectStore('outbox', { keyPath: 'id' });
      },
    });
    return new IdbOutbox(db);
  }

  async put(entries: readonly ProgressEntry[]): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    await Promise.all([...entries.map((e) => tx.store.put({ id: keyOf(e), entry: e })), tx.done]);
  }

  async all(): Promise<ProgressEntry[]> {
    return (await this.db.getAll('outbox')).map((r) => r.entry);
  }

  async remove(entries: readonly ProgressEntry[]): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    for (const e of entries) {
      const row = await tx.store.get(keyOf(e));
      if (row && JSON.stringify(row.entry) === JSON.stringify(e)) await tx.store.delete(keyOf(e));
    }
    await tx.done;
  }
}

export async function openOutbox(hasIndexedDb: boolean): Promise<Outbox> {
  if (!hasIndexedDb) return new MemoryOutbox();
  try {
    return await IdbOutbox.open();
  } catch {
    return new MemoryOutbox();
  }
}

export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 5 * 60_000;

export interface AccountSyncDeps {
  outbox: Outbox;
  /** Null: no online-api configured (entries still queue for a later build/session). */
  client: OnlineClient | null;
  schedule?: (fn: () => void, ms: number) => unknown;
}

export class AccountSync {
  private sending: Promise<void> | null = null;
  private failures = 0;
  private timer = false;

  constructor(private readonly deps: AccountSyncDeps) {}

  /** Queues entries and tries to send them. Never throws. */
  async record(entries: readonly ProgressEntry[]): Promise<void> {
    if (entries.length === 0) return;
    try {
      await this.deps.outbox.put(entries);
    } catch (err) {
      console.warn('[account] outbox write failed', err);
    }
    await this.flush();
  }

  /** Sends the outbox (reconnecting, signing in, startup). Retries with backoff on failure. */
  flush(): Promise<void> {
    this.sending ??= this.send().finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  private async send(): Promise<void> {
    const { client, outbox } = this.deps;
    if (!client?.signedIn()) return; // kept until there is an account to send to
    try {
      const all = await outbox.all();
      for (let i = 0; i < all.length; i += PROGRESS_BATCH) {
        const batch = all.slice(i, i + PROGRESS_BATCH);
        try {
          // Recorded or refused (unknown id, no entitlement): final either way, so dequeued.
          await client.recordProgress(batch);
        } catch (err) {
          // A malformed batch would block the outbox forever: it is dropped, not retried.
          if (!(err instanceof ApiError && err.status === 400)) throw err;
          console.warn('[account] the server refused a progress batch');
        }
        await outbox.remove(batch);
      }
      this.failures = 0;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      this.failures += 1;
      this.retryLater();
    }
  }

  private retryLater(): void {
    if (this.timer) return;
    this.timer = true;
    const ms = Math.min(RETRY_BASE_MS * 2 ** (this.failures - 1), RETRY_MAX_MS);
    (this.deps.schedule ?? setTimeout)(() => {
      this.timer = false;
      void this.flush();
    }, ms);
  }

  /** The account's progress as a profile, to merge into the local one after signing in. */
  async pull(db: ContentDatabase): Promise<Profile | null> {
    const client = this.deps.client;
    if (!client?.signedIn()) return null;
    try {
      return profileFromProgress(await client.listProgress(), db);
    } catch {
      return null;
    }
  }
}

/** Rebuilds an account profile from server rows (Legacy available = awarded − node costs). */
export function profileFromProgress(
  entries: readonly ProgressEntry[],
  db: ContentDatabase,
): Profile {
  const p = emptyProfile();
  let lifetime = 0;
  let spent = 0;
  for (const e of entries) {
    if (e.kind === 'achievement') p.achievements.push({ id: e.key, at: e.at });
    else if (e.kind === 'node' && db.has('bloodline-nodes', e.key)) {
      p.nodes.push(e.key);
      spent += db.get('bloodline-nodes', e.key).cost;
    } else if (e.kind === 'legacy') {
      p.awarded.push(e.key);
      lifetime += e.value;
    } else if (e.kind === 'stat') p.stats[e.key] = Math.max(p.stats[e.key], e.value);
    else if (e.kind === 'route') p.stats.routes.push(e.key);
    else p.stats.endings.push(e.key);
  }
  p.legacy = { lifetime, available: Math.max(0, lifetime - spent) };
  p.nodes.sort();
  p.awarded.sort();
  p.achievements.sort((a, b) => a.at - b.at);
  return p;
}

/** Everything in a guest profile that the account should hold (idempotent on the server). */
export function entriesOfProfile(profile: Profile, now: number): ProgressEntry[] {
  return [
    ...profile.achievements.map((a) => ({ kind: 'achievement' as const, key: a.id, at: a.at })),
    ...profile.nodes.map((key) => ({ kind: 'node' as const, key, at: now })),
    ...profile.stats.routes.map((key) => ({ kind: 'route' as const, key, at: now })),
    ...profile.stats.endings.map((key) => ({ kind: 'ending' as const, key, at: now })),
    ...(profile.stats.nights > 0
      ? [{ kind: 'stat' as const, key: 'nights' as const, value: profile.stats.nights, at: now }]
      : []),
    ...(profile.stats.exorcisms > 0
      ? [
          {
            kind: 'stat' as const,
            key: 'exorcisms' as const,
            value: profile.stats.exorcisms,
            at: now,
          },
        ]
      : []),
  ];
}
