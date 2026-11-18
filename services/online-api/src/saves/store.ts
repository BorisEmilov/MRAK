/**
 * Cloud saves (docs/systems/save-system.md → Cloud): per account, slots `slot-1..3` keep their
 * newest version and `auto` keeps the 3 newest (quota: 3 slots + 3 autosaves). Every write names
 * the version it replaces (optimistic concurrency); a mismatch is a conflict, never an overwrite.
 */
import { z } from 'zod';

export const CLOUD_SLOTS = ['slot-1', 'slot-2', 'slot-3', 'auto'] as const;
export type CloudSlot = (typeof CLOUD_SLOTS)[number];
/** Versions kept per slot. */
export const KEEP: Readonly<Record<CloudSlot, number>> = {
  'slot-1': 1,
  'slot-2': 1,
  'slot-3': 1,
  auto: 3,
};
/** Largest save payload (the serialized game); the request body limit is 2 MB. */
export const MAX_SAVE_DATA = 1536 * 1024;
export const MAX_THUMBNAIL = 256 * 1024;

/** What the game shows about a save without downloading it (mirrors the client SaveEntry). */
export const SaveMeta = z.strictObject({
  savedAt: z.string().max(64),
  gameDate: z.strictObject({
    year: z.int().min(1700).max(2100),
    month: z.int().min(1).max(12),
    day: z.int().min(1).max(31),
    minute: z.int().min(0).max(1439),
  }),
  zone: z.string().max(128).nullable(),
  generation: z.int().min(1).max(100),
  playtimeMs: z.number().min(0).max(1e12),
  contentVersion: z.string().max(64),
  reason: z.string().max(32).nullable(),
  thumbnail: z
    .string()
    .max(MAX_THUMBNAIL)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
    .nullable(),
});
export type SaveMeta = z.infer<typeof SaveMeta>;

export interface CloudSave {
  slot: CloudSlot;
  version: number;
  checksum: string;
  bytes: number;
  meta: SaveMeta;
  data: string;
  updatedAt: Date;
}
export type CloudSaveInfo = Omit<CloudSave, 'data'>;

export type PutResult =
  { ok: true; save: CloudSaveInfo } | { ok: false; current: CloudSaveInfo | null };

export interface SavesStore {
  /** Every stored version of the account (≤ 6), without data. */
  list(userId: string): Promise<CloudSaveInfo[]>;
  /** A version of a slot (default: the newest). */
  get(userId: string, slot: CloudSlot, version?: number): Promise<CloudSave | null>;
  /**
   * Writes a new version if the newest is `expected` (null: the slot must be empty); prunes old
   * versions beyond KEEP. Otherwise reports the current newest version.
   */
  put(
    userId: string,
    slot: CloudSlot,
    expected: number | null,
    save: Omit<CloudSave, 'slot' | 'version' | 'updatedAt'>,
    at: Date,
  ): Promise<PutResult>;
  /** Deletes the slot if its newest version is `expected`. */
  remove(userId: string, slot: CloudSlot, expected: number): Promise<PutResult>;
  /** Account deletion. */
  removeAll(userId: string): Promise<void>;
}

export const info = ({ data: _data, ...rest }: CloudSave): CloudSaveInfo => rest;

export class MemorySavesStore implements SavesStore {
  private readonly rows = new Map<string, CloudSave[]>();
  private key = (u: string, s: CloudSlot) => `${u}\u0000${s}`;

  list(userId: string): Promise<CloudSaveInfo[]> {
    return Promise.resolve(
      CLOUD_SLOTS.flatMap((s) => (this.rows.get(this.key(userId, s)) ?? []).map(info)),
    );
  }
  get(userId: string, slot: CloudSlot, version?: number): Promise<CloudSave | null> {
    const versions = this.rows.get(this.key(userId, slot)) ?? [];
    return Promise.resolve(
      (version === undefined ? versions[0] : versions.find((v) => v.version === version)) ?? null,
    );
  }
  put(
    userId: string,
    slot: CloudSlot,
    expected: number | null,
    save: Omit<CloudSave, 'slot' | 'version' | 'updatedAt'>,
    at: Date,
  ): Promise<PutResult> {
    const versions = this.rows.get(this.key(userId, slot)) ?? [];
    const newest = versions[0] ?? null;
    if ((newest?.version ?? null) !== expected)
      return Promise.resolve({ ok: false, current: newest && info(newest) });
    const row: CloudSave = { ...save, slot, version: (newest?.version ?? 0) + 1, updatedAt: at };
    this.rows.set(this.key(userId, slot), [row, ...versions].slice(0, KEEP[slot]));
    return Promise.resolve({ ok: true, save: info(row) });
  }
  remove(userId: string, slot: CloudSlot, expected: number): Promise<PutResult> {
    const newest = this.rows.get(this.key(userId, slot))?.[0] ?? null;
    if (!newest || newest.version !== expected)
      return Promise.resolve({ ok: false, current: newest && info(newest) });
    this.rows.delete(this.key(userId, slot));
    return Promise.resolve({ ok: true, save: info(newest) });
  }
  removeAll(userId: string): Promise<void> {
    for (const s of CLOUD_SLOTS) this.rows.delete(this.key(userId, s));
    return Promise.resolve();
  }
}
