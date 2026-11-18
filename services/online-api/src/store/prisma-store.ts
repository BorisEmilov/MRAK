/** PostgreSQL store repository (entitlements, payment_events, purchase_blocks, collector_names). */
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { CollectorNameRow, EntitlementRow, StoreRepo, StoreTx } from './store.js';

export class PrismaStoreRepo implements StoreRepo {
  constructor(private readonly db: PrismaClient) {}
  async entitlementsOf(userId: string): Promise<EntitlementRow[]> {
    return (await this.db.entitlement.findMany({
      where: { userId },
      orderBy: { purchasedAt: 'asc' },
    })) as EntitlementRow[];
  }
  async once(
    id: string,
    type: string,
    at: Date,
    effect: (tx: StoreTx) => Promise<void>,
  ): Promise<boolean> {
    try {
      await this.db.$transaction(async (db) => {
        await db.paymentEvent.create({ data: { id, type, processedAt: at } });
        await effect({
          grant: async (row) => {
            await db.entitlement.upsert({
              where: {
                source_orderId_sku: { source: row.source, orderId: row.orderId, sku: row.sku },
              },
              create: row,
              update: {},
            });
          },
          revokeOrder: async (source, orderId, when) => {
            const rows = await db.entitlement.findMany({ where: { source, orderId } });
            await db.entitlement.updateMany({
              where: { source, orderId },
              data: { status: 'revoked', refundedAt: when },
            });
            return [...new Set(rows.map((r) => r.userId))];
          },
          block: async (userId, reason, when) => {
            await db.purchaseBlock.upsert({
              where: { userId },
              create: { userId, reason, createdAt: when },
              update: {},
            });
          },
        });
      });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }
  async blocked(userId: string): Promise<boolean> {
    return (await this.db.purchaseBlock.count({ where: { userId } })) > 0;
  }
  async setCollectorName(row: CollectorNameRow): Promise<void> {
    await this.db.collectorName.upsert({ where: { userId: row.userId }, create: row, update: row });
  }
  async eraseUser(userId: string): Promise<void> {
    await this.db.collectorName.deleteMany({ where: { userId } });
    await this.db.purchaseBlock.deleteMany({ where: { userId } });
  }
}
