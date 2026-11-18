/**
 * Sales panel data (docs/systems/store.md → Studio). Reads the online database through a
 * restricted role (SELECT on users, entitlements, collector_names; UPDATE on
 * collector_names.status only). Aggregates only: no emails, no per-buyer lists.
 */
export interface SalesSummary {
  days: number;
  /** Accounts created in the window (verified email). */
  accounts: number;
  /** Of those, accounts that bought anything. */
  buyers: number;
  /** buyers / accounts (demo account → purchase); guests are not counted. */
  conversion: number;
  sales: { sku: string; source: string; count: number }[];
  refunds: number;
  pendingNames: number;
}

export interface CollectorNameView {
  userId: string;
  name: string;
  status: string;
}

export interface SalesSource {
  summary(days: number): Promise<SalesSummary>;
  pendingNames(): Promise<CollectorNameView[]>;
  moderate(userId: string, status: 'approved' | 'rejected'): Promise<boolean>;
}

type Query = (text: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export function sqlSales(query: Query): SalesSource {
  const n = (v: unknown) => Number(v ?? 0);
  return {
    async summary(days) {
      const since = new Date(Date.now() - days * 86_400_000);
      const [funnel, sales, refunds, names] = await Promise.all([
        query(
          `SELECT count(*) AS accounts,
                  count(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM entitlements e WHERE e.user_id = u.id)) AS buyers
             FROM users u WHERE u.created_at >= $1 AND u.email_verified_at IS NOT NULL`,
          [since],
        ),
        query(
          `SELECT sku, source, count(*) AS count FROM entitlements
            WHERE purchased_at >= $1 GROUP BY sku, source ORDER BY sku, source`,
          [since],
        ),
        query(`SELECT count(*) AS count FROM entitlements WHERE refunded_at >= $1`, [since]),
        query(`SELECT count(*) AS count FROM collector_names WHERE status = 'pending'`, []),
      ]);
      const accounts = n(funnel.rows[0]?.['accounts']);
      const buyers = n(funnel.rows[0]?.['buyers']);
      return {
        days,
        accounts,
        buyers,
        conversion: accounts === 0 ? 0 : buyers / accounts,
        sales: sales.rows.map((r) => ({
          sku: String(r['sku']),
          source: String(r['source']),
          count: n(r['count']),
        })),
        refunds: n(refunds.rows[0]?.['count']),
        pendingNames: n(names.rows[0]?.['count']),
      };
    },
    async pendingNames() {
      const r = await query(
        `SELECT user_id, name, status FROM collector_names WHERE status = 'pending'
          ORDER BY updated_at LIMIT 100`,
        [],
      );
      return r.rows.map((x) => ({
        userId: String(x['user_id']),
        name: String(x['name']),
        status: String(x['status']),
      }));
    },
    async moderate(userId, status) {
      const r = await query(
        `UPDATE collector_names SET status = $2, updated_at = now() WHERE user_id = $1 RETURNING 1`,
        [userId, status],
      );
      return r.rows.length > 0;
    },
  };
}
