/**
 * SaveStore: local save repository (docs/systems/save-system.md → Local saves).
 *
 * - Slots: 3 manual (`slot-1..3`), `quick`, and `auto` (rotation of the 3 latest autosaves).
 * - Atomic write: `stage` (data + entry under a fresh id) then `commit` (the slot's head points
 *   to the new id and old versions beyond retention are pruned). A crash between the two leaves
 *   the previous version current; unreferenced staged entries are deleted on open.
 * - Every read verifies the checksum; corrupt saves are reported, never loaded.
 */
import { AUTOSAVE_REASONS, type SealedSave, verifySealed } from '@mrak/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import { NullCloudSync, type CloudSync } from './cloud-sync';

export const MANUAL_SLOTS = ['slot-1', 'slot-2', 'slot-3'] as const;
export type ManualSlot = (typeof MANUAL_SLOTS)[number];
export const SLOT_IDS = [...MANUAL_SLOTS, 'quick', 'auto'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

/** Versions kept per slot. For manual/quick slots only the newest is listed; the rest is backup. */
export const RETENTION: Readonly<Record<SlotId, number>> = {
  'slot-1': 2,
  'slot-2': 2,
  'slot-3': 2,
  quick: 2,
  auto: 3,
};

export const SaveEntrySchema = z.strictObject({
  id: z.string().min(1).max(128),
  slot: z.enum(SLOT_IDS),
  /** Why an autosave was written (null for manual, quick and imported saves). */
  reason: z.enum(AUTOSAVE_REASONS).nullable(),
  savedAt: z.string().max(64),
  gameDate: z.strictObject({
    year: z.int(),
    month: z.int(),
    day: z.int(),
    minute: z.int(),
  }),
  zone: z.string().max(128).nullable(),
  generation: z.int().min(1),
  playtimeMs: z.number().min(0),
  contentVersion: z.string().max(64),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.int().min(0),
  /** Small JPEG data URL of the game view, or null. */
  thumbnail: z
    .string()
    .max(256 * 1024)
    .nullable(),
});
export type SaveEntry = z.infer<typeof SaveEntrySchema>;
/** What the caller provides; id, checksum and size are filled in by the store. */
export type SaveEntryInput = Omit<SaveEntry, 'id' | 'checksum' | 'bytes'>;

export interface Head {
  slot: SlotId;
  /** Entry ids, newest first. */
  ids: string[];
}

/** Storage primitives. Each method is one transaction. */
export interface SaveBackend {
  /** True when saves survive a page reload. */
  readonly persistent: boolean;
  heads(): Promise<Head[]>;
  entries(): Promise<SaveEntry[]>;
  data(id: string): Promise<string | undefined>;
  /** Writes the data and the entry together (not yet referenced by any head). */
  stage(entry: SaveEntry, data: string): Promise<void>;
  /** Replaces a head and deletes the given entries (and their data) together. */
  commit(head: Head, remove: readonly string[]): Promise<void>;
  /** Deletes a head and the given entries. */
  drop(slot: SlotId, remove: readonly string[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

/** In-memory backend: used when IndexedDB is unavailable (private mode) and in tests. */
export class MemoryBackend implements SaveBackend {
  readonly persistent = false;
  readonly headMap = new Map<SlotId, Head>();
  readonly entryMap = new Map<string, SaveEntry>();
  readonly dataMap = new Map<string, string>();

  heads(): Promise<Head[]> {
    return Promise.resolve([...this.headMap.values()].map((h) => ({ ...h, ids: [...h.ids] })));
  }

  entries(): Promise<SaveEntry[]> {
    return Promise.resolve([...this.entryMap.values()]);
  }

  data(id: string): Promise<string | undefined> {
    return Promise.resolve(this.dataMap.get(id));
  }

  stage(entry: SaveEntry, data: string): Promise<void> {
    this.dataMap.set(entry.id, data);
    this.entryMap.set(entry.id, entry);
    return Promise.resolve();
  }

  commit(head: Head, remove: readonly string[]): Promise<void> {
    this.headMap.set(head.slot, { slot: head.slot, ids: [...head.ids] });
    this.removeIds(remove);
    return Promise.resolve();
  }

  drop(slot: SlotId, remove: readonly string[]): Promise<void> {
    this.headMap.delete(slot);
    this.removeIds(remove);
    return Promise.resolve();
  }

  private removeIds(ids: readonly string[]): void {
    for (const id of ids) {
      this.entryMap.delete(id);
      this.dataMap.delete(id);
    }
  }
}

interface SavesDb extends DBSchema {
  data: { key: string; value: { id: string; text: string } };
  entries: { key: string; value: SaveEntry };
  heads: { key: SlotId; value: Head };
}

export const SAVE_DB_NAME = 'mrak-saves';

export class IdbBackend implements SaveBackend {
  readonly persistent = true;

  private constructor(private readonly db: IDBPDatabase<SavesDb>) {}

  static async open(name = SAVE_DB_NAME): Promise<IdbBackend> {
    const db = await openDB<SavesDb>(name, 1, {
      upgrade(database) {
        database.createObjectStore('data', { keyPath: 'id' });
        database.createObjectStore('entries', { keyPath: 'id' });
        database.createObjectStore('heads', { keyPath: 'slot' });
      },
    });
    return new IdbBackend(db);
  }

  close(): void {
    this.db.close();
  }

  heads(): Promise<Head[]> {
    return this.db.getAll('heads');
  }

  async entries(): Promise<SaveEntry[]> {
    // Untrusted at rest (extensions, devtools, bugs): drop anything malformed.
    const raw: unknown[] = await this.db.getAll('entries');
    return raw.flatMap((e) => {
      const parsed = SaveEntrySchema.safeParse(e);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async data(id: string): Promise<string | undefined> {
    const row = await this.db.get('data', id);
    return typeof row?.text === 'string' ? row.text : undefined;
  }

  async stage(entry: SaveEntry, data: string): Promise<void> {
    const tx = this.db.transaction(['data', 'entries'], 'readwrite');
    await Promise.all([
      tx.objectStore('data').put({ id: entry.id, text: data }),
      tx.objectStore('entries').put(entry),
      tx.done,
    ]);
  }

  async commit(head: Head, remove: readonly string[]): Promise<void> {
    const tx = this.db.transaction(['data', 'entries', 'heads'], 'readwrite');
    await Promise.all([
      tx.objectStore('heads').put(head),
      ...remove.flatMap((id) => [
        tx.objectStore('data').delete(id),
        tx.objectStore('entries').delete(id),
      ]),
      tx.done,
    ]);
  }

  async drop(slot: SlotId, remove: readonly string[]): Promise<void> {
    const tx = this.db.transaction(['data', 'entries', 'heads'], 'readwrite');
    await Promise.all([
      tx.objectStore('heads').delete(slot),
      ...remove.flatMap((id) => [
        tx.objectStore('data').delete(id),
        tx.objectStore('entries').delete(id),
      ]),
      tx.done,
    ]);
  }
}

/** IndexedDB when it works, memory otherwise. */
export async function openBackend(hasIndexedDb: boolean): Promise<SaveBackend> {
  if (!hasIndexedDb) return new MemoryBackend();
  try {
    return await IdbBackend.open();
  } catch {
    return new MemoryBackend();
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class SaveCorruptEntryError extends Error {
  override readonly name = 'SaveCorruptEntryError';
}

export interface SaveStoreOptions {
  cloud?: CloudSync;
  newId?: () => string;
}

const newestFirst = (a: SaveEntry, b: SaveEntry): number => b.savedAt.localeCompare(a.savedAt);

function defaultId(): string {
  return crypto.randomUUID();
}

export class SaveStore {
  private readonly cloud: CloudSync;
  private readonly newId: () => string;

  private constructor(
    private readonly backend: SaveBackend,
    options: SaveStoreOptions,
  ) {
    this.cloud = options.cloud ?? new NullCloudSync();
    this.newId = options.newId ?? defaultId;
  }

  /** Opens the store and deletes staged versions that were never committed (interrupted writes). */
  static async open(backend: SaveBackend, options: SaveStoreOptions = {}): Promise<SaveStore> {
    const store = new SaveStore(backend, options);
    await store.collectOrphans();
    return store;
  }

  get persistent(): boolean {
    return this.backend.persistent;
  }

  get cloudSync(): CloudSync {
    return this.cloud;
  }

  /** Atomic write: stage, then commit. */
  async write(input: SaveEntryInput, sealed: SealedSave): Promise<SaveEntry> {
    const entry = await this.stage(input, sealed);
    await this.commit(entry);
    return entry;
  }

  /** Phase 1: stores a new version that no slot points to yet. */
  async stage(input: SaveEntryInput, sealed: SealedSave): Promise<SaveEntry> {
    const entry: SaveEntry = {
      ...input,
      id: this.newId(),
      checksum: sealed.checksum,
      bytes: sealed.data.length,
    };
    await this.backend.stage(SaveEntrySchema.parse(entry), sealed.data);
    return entry;
  }

  /** Phase 2: makes a staged version current for its slot and prunes old versions. */
  async commit(entry: SaveEntry): Promise<void> {
    const head = (await this.backend.heads()).find((h) => h.slot === entry.slot);
    const ids = [entry.id, ...(head?.ids ?? []).filter((id) => id !== entry.id)];
    const keep = RETENTION[entry.slot];
    await this.backend.commit({ slot: entry.slot, ids: ids.slice(0, keep) }, ids.slice(keep));
    const data = await this.backend.data(entry.id);
    if (data !== undefined) {
      this.cloud.push(entry, data).catch((err: unknown) => {
        console.warn('[save] cloud push failed', err);
      });
    }
  }

  /** Saves shown to the player: current manual/quick saves and every autosave, newest first. */
  async list(): Promise<SaveEntry[]> {
    const [heads, entries] = await Promise.all([this.backend.heads(), this.backend.entries()]);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const visible = heads.flatMap((h) => (h.slot === 'auto' ? h.ids : h.ids.slice(0, 1)));
    return visible
      .map((id) => byId.get(id))
      .filter((e): e is SaveEntry => e !== undefined)
      .sort(newestFirst);
  }

  async latest(): Promise<SaveEntry | null> {
    return (await this.list())[0] ?? null;
  }

  async entry(id: string): Promise<SaveEntry | null> {
    return (await this.backend.entries()).find((e) => e.id === id) ?? null;
  }

  /** Reads a save and verifies its checksum. Throws SaveCorruptEntryError. */
  async read(id: string): Promise<{ entry: SaveEntry; sealed: SealedSave }> {
    const entry = await this.entry(id);
    if (!entry) throw new SaveCorruptEntryError(`no save ${id}`);
    const data = await this.backend.data(id);
    if (data === undefined) throw new SaveCorruptEntryError(`save ${id} has no data`);
    const sealed = { data, checksum: entry.checksum };
    if (!verifySealed(sealed)) throw new SaveCorruptEntryError(`save ${id} checksum mismatch`);
    return { entry, sealed };
  }

  /**
   * The newest intact save to offer instead of a broken one: the backups of the same slot first,
   * then autosaves, newest first. Only checksum-verified entries are returned.
   */
  async fallbackFor(
    brokenId: string,
    exclude: ReadonlySet<string> = new Set(),
  ): Promise<SaveEntry | null> {
    const [heads, entries] = await Promise.all([this.backend.heads(), this.backend.entries()]);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const broken = byId.get(brokenId);
    const sameSlot = heads.find((h) => h.slot === broken?.slot)?.ids ?? [];
    const autos = (heads.find((h) => h.slot === 'auto')?.ids ?? [])
      .map((id) => byId.get(id))
      .filter((e): e is SaveEntry => e !== undefined)
      .sort(newestFirst)
      .map((e) => e.id);
    for (const id of new Set([...sameSlot, ...autos])) {
      if (id === brokenId || exclude.has(id)) continue;
      try {
        return (await this.read(id)).entry;
      } catch {
        // Also broken: keep looking.
      }
    }
    return null;
  }

  /** Deletes a slot and all its versions. */
  async remove(slot: SlotId): Promise<void> {
    const head = (await this.backend.heads()).find((h) => h.slot === slot);
    await this.backend.drop(slot, head?.ids ?? []);
  }

  private async collectOrphans(): Promise<void> {
    const [heads, entries] = await Promise.all([this.backend.heads(), this.backend.entries()]);
    const referenced = new Set(heads.flatMap((h) => h.ids));
    const orphans = entries.filter((e) => !referenced.has(e.id)).map((e) => e.id);
    if (orphans.length === 0) return;
    // Rewrite one head (or none) while deleting: commit() carries the deletions in one transaction.
    const [first] = heads;
    if (first) await this.backend.commit(first, orphans);
    else await this.backend.drop('auto', orphans);
  }
}
