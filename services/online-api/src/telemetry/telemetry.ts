/**
 * Telemetry ingestion (docs/systems/telemetry.md, threat model C-26): fixed schema, invalid events
 * dropped one by one, per-install sampling, nothing personal stored.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const TELEMETRY_EVENTS = [
  'session-start',
  'session-end',
  'game-start',
  'decision',
  'death',
  'mystery-start',
  'mystery-end',
  'zone',
  'sample',
  'night-start',
  'night-end',
  'chapter-end',
  'prologue-end',
  'demo-end',
  'buy-click',
  'purchase',
  'js-error',
] as const;

export const MAX_EVENTS = 50;
export const TELEMETRY_BODY_LIMIT = 8 * 1024;

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const num = z.number().min(-1e9).max(1e9);

export const Envelope = z.strictObject({
  install: z.uuid(),
  session: z.uuid(),
  build: z.string().regex(/^[\w.+-]{1,32}$/),
  demo: z.boolean(),
  events: z.array(z.unknown()).max(MAX_EVENTS),
});

export const TelemetryEvent = z.strictObject({
  e: z.enum(TELEMETRY_EVENTS),
  t: z
    .int()
    .min(0)
    .max(7 * 86_400_000),
  zone: Id.optional(),
  key: z
    .string()
    .regex(/^[A-Za-z0-9][\w-]{0,63}$/)
    .optional(),
  cause: Id.optional(),
  value: num.optional(),
  n: num.optional(),
  /** Scrubbed JavaScript error text only. */
  text: z
    .string()
    .max(120)
    .refine((s) => !/@|\/\//.test(s))
    .optional(),
});
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

export interface TelemetryRow extends TelemetryEvent {
  install: string;
  session: string;
  build: string;
  demo: boolean;
}

export interface TelemetryStore {
  add(rows: readonly TelemetryRow[]): Promise<void>;
}

export class MemoryTelemetryStore implements TelemetryStore {
  readonly rows: TelemetryRow[] = [];
  add(rows: readonly TelemetryRow[]): Promise<void> {
    this.rows.push(...rows);
    return Promise.resolve();
  }
}

/** Deterministic per install: a sampled install sends whole sessions. */
export function sampled(install: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const h = createHash('sha256').update(install).digest().readUInt32BE(0);
  return h / 0x1_0000_0000 < rate;
}

/** Valid events of an envelope; invalid ones are dropped (counted for the log). */
export function rowsOf(env: z.infer<typeof Envelope>): { rows: TelemetryRow[]; dropped: number } {
  const rows: TelemetryRow[] = [];
  for (const raw of env.events) {
    const e = TelemetryEvent.safeParse(raw);
    if (!e.success) continue;
    if (e.data.text !== undefined && e.data.e !== 'js-error') continue;
    rows.push({
      ...e.data,
      install: env.install,
      session: env.session,
      build: env.build,
      demo: env.demo,
    });
  }
  return { rows, dropped: env.events.length - rows.length };
}
