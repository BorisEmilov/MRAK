/** In-game bug reports (docs/systems/testing.md → Bug reports): validated, minimal, 90 days. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';

export const BUG_BODY_LIMIT = 1024 * 1024;
export const BUG_RETENTION_DAYS = 90;

export const BugReportBody = z.strictObject({
  version: z.string().regex(/^[\w.+@-]{1,64}$/),
  platform: z.enum(['web', 'desktop', 'mobile']),
  description: z.string().trim().min(1).max(2000),
  /** Only with the player's consent (the checkbox), together with the save. */
  seed: z.int().min(0).optional(),
  save: z
    .string()
    .max(BUG_BODY_LIMIT - 4096)
    .optional(),
});
export type BugReportInput = z.infer<typeof BugReportBody>;

export interface BugStore {
  add(report: BugReportInput): Promise<string>;
  purge(before: Date): Promise<number>;
}

export class MemoryBugStore implements BugStore {
  readonly reports: (BugReportInput & { id: string; createdAt: Date })[] = [];
  add(report: BugReportInput): Promise<string> {
    const id = randomUUID();
    this.reports.push({ ...report, id, createdAt: new Date() });
    return Promise.resolve(id);
  }
  purge(before: Date): Promise<number> {
    const keep = this.reports.filter((r) => r.createdAt >= before);
    const n = this.reports.length - keep.length;
    this.reports.splice(0, this.reports.length, ...keep);
    return Promise.resolve(n);
  }
}

export class PrismaBugStore implements BugStore {
  constructor(private readonly db: PrismaClient) {}
  async add(r: BugReportInput): Promise<string> {
    const id = randomUUID();
    await this.db.bugReport.create({
      data: {
        id,
        version: r.version,
        platform: r.platform,
        description: r.description,
        seed: r.seed ?? null,
        save: r.save ?? null,
      },
    });
    return id;
  }
  async purge(before: Date): Promise<number> {
    const { count } = await this.db.bugReport.deleteMany({ where: { createdAt: { lt: before } } });
    return count;
  }
}
