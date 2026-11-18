/** PostgreSQL cloud saves (table cloud_saves). The primary key makes concurrent writes of the
 * same version collide, so only one of two racing uploads wins; the other is a conflict. */
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import {
  CLOUD_SLOTS,
  KEEP,
  SaveMeta,
  type CloudSave,
  type CloudSaveInfo,
  type CloudSlot,
  type PutResult,
  type SavesStore,
} from './store.js';

const select = {
  slot: true,
  version: true,
  checksum: true,
  bytes: true,
  meta: true,
  updatedAt: true,
} as const;

type Row = {
  slot: string;
  version: number;
  checksum: string;
  bytes: number;
  meta: unknown;
  updatedAt: Date;
};

const toInfo = (r: Row): CloudSaveInfo => ({
  ...r,
  slot: r.slot as CloudSlot,
  meta: SaveMeta.parse(r.meta),
});

export class PrismaSavesStore implements SavesStore {
  constructor(private readonly db: PrismaClient) {}

  async list(userId: string): Promise<CloudSaveInfo[]> {
    const rows = await this.db.cloudSave.findMany({
      where: { userId, slot: { in: [...CLOUD_SLOTS] } },
      select,
      orderBy: [{ slot: 'asc' }, { version: 'desc' }],
      take: 6,
    });
    return rows.map(toInfo);
  }

  async get(userId: string, slot: CloudSlot, version?: number): Promise<CloudSave | null> {
    const r = await this.db.cloudSave.findFirst({
      where: { userId, slot, ...(version === undefined ? {} : { version }) },
      orderBy: { version: 'desc' },
    });
    return r && { ...toInfo(r), data: r.data };
  }

  private async newest(userId: string, slot: CloudSlot): Promise<CloudSaveInfo | null> {
    const r = await this.db.cloudSave.findFirst({
      where: { userId, slot },
      select,
      orderBy: { version: 'desc' },
    });
    return r && toInfo(r);
  }

  async put(
    userId: string,
    slot: CloudSlot,
    expected: number | null,
    save: Omit<CloudSave, 'slot' | 'version' | 'updatedAt'>,
    at: Date,
  ): Promise<PutResult> {
    try {
      return await this.db.$transaction(async (tx) => {
        const newest = await tx.cloudSave.findFirst({
          where: { userId, slot },
          select,
          orderBy: { version: 'desc' },
        });
        if ((newest?.version ?? null) !== expected)
          return { ok: false as const, current: newest && toInfo(newest) };
        const version = (newest?.version ?? 0) + 1;
        const row = await tx.cloudSave.create({
          data: { userId, slot, version, ...save, meta: save.meta, updatedAt: at },
          select,
        });
        await tx.cloudSave.deleteMany({
          where: { userId, slot, version: { lte: version - KEEP[slot] } },
        });
        return { ok: true as const, save: toInfo(row) };
      });
    } catch (err) {
      // Another upload created this version first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        return { ok: false, current: await this.newest(userId, slot) };
      throw err;
    }
  }

  async remove(userId: string, slot: CloudSlot, expected: number): Promise<PutResult> {
    const newest = await this.newest(userId, slot);
    if (!newest || newest.version !== expected) return { ok: false, current: newest };
    await this.db.cloudSave.deleteMany({ where: { userId, slot, version: { lte: expected } } });
    return { ok: true, save: newest };
  }

  async removeAll(userId: string): Promise<void> {
    await this.db.cloudSave.deleteMany({ where: { userId } });
  }
}
