/** PostgreSQL implementation of the account progress store (table `account_progress`). */
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  MAX_ENTRIES_PER_ACCOUNT,
  ProgressEntry,
  type ProgressKind,
  type ProgressStore,
} from './store.js';

export class PrismaProgressStore implements ProgressStore {
  constructor(private readonly db: PrismaClient) {}

  async add(userId: string, entries: readonly ProgressEntry[]): Promise<ProgressEntry[]> {
    const room =
      MAX_ENTRIES_PER_ACCOUNT - (await this.db.accountProgress.count({ where: { userId } }));
    const fresh: ProgressEntry[] = [];
    let left = room;
    for (const e of entries) {
      const value = 'value' in e ? e.value : 0;
      const at = new Date(e.at);
      // Insert-or-ignore; counters are raised only when higher. Both are idempotent.
      const changed =
        e.kind === 'stat'
          ? await this.db.$executeRaw`
              INSERT INTO account_progress (user_id, kind, key, value, at)
              VALUES (${userId}, ${e.kind}, ${e.key}, ${value}, ${at})
              ON CONFLICT (user_id, kind, key) DO UPDATE SET value = EXCLUDED.value, at = EXCLUDED.at
              WHERE account_progress.value < EXCLUDED.value`
          : left > 0
            ? await this.db.$executeRaw`
              INSERT INTO account_progress (user_id, kind, key, value, at)
              VALUES (${userId}, ${e.kind}, ${e.key}, ${value}, ${at})
              ON CONFLICT (user_id, kind, key) DO NOTHING`
            : 0;
      if (changed > 0) {
        fresh.push(e);
        if (e.kind !== 'stat') left -= 1;
      }
    }
    return fresh;
  }

  async remove(userId: string): Promise<void> {
    await this.db.accountProgress.deleteMany({ where: { userId } });
  }

  async list(userId: string, kinds?: readonly ProgressKind[]): Promise<ProgressEntry[]> {
    const rows = await this.db.accountProgress.findMany({
      where: { userId, ...(kinds ? { kind: { in: [...kinds] } } : {}) },
      orderBy: { at: 'asc' },
      take: MAX_ENTRIES_PER_ACCOUNT,
    });
    return rows.flatMap((r) => {
      const base = { kind: r.kind, key: r.key, at: r.at.getTime() };
      const parsed = ProgressEntry.safeParse(
        r.kind === 'legacy' || r.kind === 'stat' ? { ...base, value: r.value } : base,
      );
      return parsed.success ? [parsed.data] : [];
    });
  }
}
