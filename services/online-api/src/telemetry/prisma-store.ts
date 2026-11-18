/** PostgreSQL telemetry store: `telemetry.events`, partitioned by the server day (raw SQL). */
import type { PrismaClient } from '../generated/prisma/client.js';
import type { TelemetryRow, TelemetryStore } from './telemetry.js';

export const TELEMETRY_RETENTION_DAYS = 90;

export class PrismaTelemetryStore implements TelemetryStore {
  constructor(private readonly db: PrismaClient) {}

  async add(rows: readonly TelemetryRow[]): Promise<void> {
    if (rows.length === 0) return;
    const col = <K extends keyof TelemetryRow>(k: K) => rows.map((r) => r[k] ?? null);
    await this.db.$executeRaw`
      INSERT INTO telemetry.events
        (install, session, build, demo, name, t, zone, key, cause, value, n, text)
      SELECT * FROM unnest(
        ${col('install')}::uuid[], ${col('session')}::uuid[], ${col('build')}::text[],
        ${col('demo')}::boolean[], ${col('e')}::text[], ${col('t')}::integer[],
        ${col('zone')}::text[], ${col('key')}::text[], ${col('cause')}::text[],
        ${col('value')}::double precision[], ${col('n')}::double precision[], ${col('text')}::text[])`;
  }

  /** Creates the coming partitions and drops the expired ones. */
  async maintain(days = TELEMETRY_RETENTION_DAYS): Promise<void> {
    await this.db.$executeRaw`SELECT telemetry.maintain(${days}::integer)`;
  }
}
