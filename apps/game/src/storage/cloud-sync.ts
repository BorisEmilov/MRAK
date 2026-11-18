/**
 * CloudSync (docs/systems/save-system.md → Cloud): local-first. Every save is committed to
 * IndexedDB first; committed manual slots and autosaves are then queued (persistently) and
 * uploaded in the background with backoff + jitter, honouring 429/Retry-After. Uploads name the
 * cloud version they replace; a divergence is a conflict the player resolves — the cloud never
 * overwrites a local save without confirmation. Quick saves stay on the device.
 */
import {
  ApiError,
  conflictOf,
  type CloudSaveInfo,
  type CloudSaveMeta,
  type CloudSlot,
  type SavesClient,
} from '@mrak/api-client';
import { AUTOSAVE_REASONS, sha256Hex } from '@mrak/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SaveEntry, SaveEntryInput, SaveStore, SlotId } from './save-store';

export type CloudStatus =
  | 'disabled' // no online service configured
  | 'signed-out'
  | 'synced'
  | 'pending'
  | 'offline'
  | 'conflict'
  | 'error';

export interface CloudSync {
  readonly status: CloudStatus;
  /** Queues a committed local save for upload. Fire-and-forget, never throws. */
  push(entry: SaveEntry, data: string): Promise<void>;
}

/** No online service: does nothing, never fails. */
export class NullCloudSync implements CloudSync {
  readonly status: CloudStatus = 'disabled';
  push(): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------- persistent sync state

/** The cloud version this device last agreed on, per account and slot. */
export interface SyncBase {
  key: string; // `${userId}:${slot}`
  version: number;
  checksum: string;
}
/** A local save waiting for upload (newest per slot wins). */
export interface PendingUpload {
  slot: CloudSlot;
  entry: SaveEntry;
  data: string;
}

export interface SyncState {
  bases(): Promise<SyncBase[]>;
  setBase(base: SyncBase): Promise<void>;
  dropBase(key: string): Promise<void>;
  pending(): Promise<PendingUpload[]>;
  putPending(p: PendingUpload): Promise<void>;
  /** Removes it only if it is still that entry (a newer save may have replaced it). */
  dropPending(slot: CloudSlot, entryId: string): Promise<void>;
}

export class MemorySyncState implements SyncState {
  private readonly b = new Map<string, SyncBase>();
  private readonly p = new Map<CloudSlot, PendingUpload>();
  bases(): Promise<SyncBase[]> {
    return Promise.resolve([...this.b.values()]);
  }
  setBase(base: SyncBase): Promise<void> {
    this.b.set(base.key, base);
    return Promise.resolve();
  }
  dropBase(key: string): Promise<void> {
    this.b.delete(key);
    return Promise.resolve();
  }
  pending(): Promise<PendingUpload[]> {
    return Promise.resolve([...this.p.values()]);
  }
  putPending(p: PendingUpload): Promise<void> {
    this.p.set(p.slot, p);
    return Promise.resolve();
  }
  dropPending(slot: CloudSlot, entryId: string): Promise<void> {
    if (this.p.get(slot)?.entry.id === entryId) this.p.delete(slot);
    return Promise.resolve();
  }
}

interface SyncDb extends DBSchema {
  bases: { key: string; value: SyncBase };
  pending: { key: string; value: PendingUpload };
}

export class IdbSyncState implements SyncState {
  private constructor(private readonly db: IDBPDatabase<SyncDb>) {}
  static async open(name = 'mrak-cloud'): Promise<IdbSyncState> {
    const db = await openDB<SyncDb>(name, 1, {
      upgrade(d) {
        d.createObjectStore('bases', { keyPath: 'key' });
        d.createObjectStore('pending', { keyPath: 'slot' });
      },
    });
    return new IdbSyncState(db);
  }
  bases(): Promise<SyncBase[]> {
    return this.db.getAll('bases');
  }
  async setBase(base: SyncBase): Promise<void> {
    await this.db.put('bases', base);
  }
  async dropBase(key: string): Promise<void> {
    await this.db.delete('bases', key);
  }
  pending(): Promise<PendingUpload[]> {
    return this.db.getAll('pending');
  }
  async putPending(p: PendingUpload): Promise<void> {
    await this.db.put('pending', p);
  }
  async dropPending(slot: CloudSlot, entryId: string): Promise<void> {
    const tx = this.db.transaction('pending', 'readwrite');
    if ((await tx.store.get(slot))?.entry.id === entryId) await tx.store.delete(slot);
    await tx.done;
  }
}

export async function openSyncState(hasIndexedDb: boolean): Promise<SyncState> {
  if (!hasIndexedDb) return new MemorySyncState();
  try {
    return await IdbSyncState.open();
  } catch {
    return new MemorySyncState();
  }
}

// ---------------------------------------------------------------- mapping

/** Local slot → cloud slot (quick saves stay local). */
export function cloudSlotOf(slot: SlotId): CloudSlot | null {
  return slot === 'quick' ? null : slot;
}

/** Same limits as the server (MAX_SAVE_DATA, thumbnail format). */
export const MAX_CLOUD_DATA = 1536 * 1024;
const THUMB = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function metaOf(entry: SaveEntry): CloudSaveMeta {
  return {
    savedAt: entry.savedAt,
    gameDate: entry.gameDate,
    zone: entry.zone,
    generation: entry.generation,
    playtimeMs: entry.playtimeMs,
    contentVersion: entry.contentVersion,
    reason: entry.reason,
    thumbnail:
      entry.thumbnail && entry.thumbnail.length <= 256 * 1024 && THUMB.test(entry.thumbnail)
        ? entry.thumbnail
        : null,
  };
}

export function entryInputOf(info: CloudSaveInfo): SaveEntryInput {
  const reason = (AUTOSAVE_REASONS as readonly string[]).includes(info.meta.reason ?? '')
    ? (info.meta.reason as SaveEntryInput['reason'])
    : null;
  return {
    slot: info.slot,
    reason: info.slot === 'auto' ? reason : null,
    savedAt: info.meta.savedAt,
    gameDate: info.meta.gameDate,
    zone: info.meta.zone,
    generation: info.meta.generation,
    playtimeMs: info.meta.playtimeMs,
    contentVersion: info.meta.contentVersion,
    thumbnail: info.meta.thumbnail,
  };
}

// ---------------------------------------------------------------- the sync engine

export interface SyncConflict {
  slot: CloudSlot;
  /** This device's save. */
  local: SaveEntry;
  /** The cloud's newest version (null: deleted in the cloud). */
  cloud: CloudSaveInfo | null;
}

export interface CloudSnapshot {
  status: CloudStatus;
  conflicts: readonly SyncConflict[];
  /** Cloud saves of the account (refreshed after sign-in and each sync). */
  remote: readonly CloudSaveInfo[];
}

export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 5 * 60_000;

export interface HttpCloudSyncDeps {
  client: SavesClient;
  state: SyncState;
  /** The signed-in account id (bases are per account). */
  userId: () => string | null;
  online?: () => boolean;
  schedule?: (fn: () => void, ms: number) => unknown;
  random?: () => number;
}

export class HttpCloudSync implements CloudSync {
  private store: SaveStore | null = null;
  private readonly conflicts = new Map<CloudSlot, SyncConflict>();
  private remote: CloudSaveInfo[] = [];
  private queued = 0;
  private failures = 0;
  private retryTimer = false;
  private lastError = false;
  private sending: Promise<void> | null = null;
  private readonly listeners = new Set<(s: CloudSnapshot) => void>();

  constructor(private readonly d: HttpCloudSyncDeps) {}

  /** The local store (set after it is opened; downloads write into it). */
  attach(store: SaveStore): void {
    this.store = store;
  }

  get status(): CloudStatus {
    if (!this.d.client.signedIn()) return 'signed-out';
    if (this.conflicts.size > 0) return 'conflict';
    if (!(this.d.online?.() ?? true)) return 'offline';
    if (this.queued > 0) return this.lastError ? 'error' : 'pending';
    return 'synced';
  }

  snapshot(): CloudSnapshot {
    return { status: this.status, conflicts: [...this.conflicts.values()], remote: this.remote };
  }

  onChange(listener: (s: CloudSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }

  private baseKey(slot: CloudSlot): string | null {
    const user = this.d.userId();
    return user ? `${user}:${slot}` : null;
  }

  private async base(slot: CloudSlot): Promise<SyncBase | null> {
    const key = this.baseKey(slot);
    return key ? ((await this.d.state.bases()).find((b) => b.key === key) ?? null) : null;
  }

  private async agree(slot: CloudSlot, version: number, checksum: string): Promise<void> {
    const key = this.baseKey(slot);
    if (key) await this.d.state.setBase({ key, version, checksum });
  }

  async push(entry: SaveEntry, data: string): Promise<void> {
    const slot = cloudSlotOf(entry.slot);
    if (!slot || data.length > MAX_CLOUD_DATA) return;
    // Already the agreed cloud version (e.g. just downloaded): nothing to upload.
    if ((await this.base(slot))?.checksum === entry.checksum) return;
    try {
      await this.d.state.putPending({ slot, entry, data });
    } catch (err) {
      console.warn('[cloud] queue write failed', err);
      return;
    }
    await this.flush();
  }

  /** Uploads the queue (startup, sign-in, reconnect, after each save). Never throws. */
  flush(): Promise<void> {
    this.sending ??= this.send()
      .catch((err: unknown) => {
        console.warn('[cloud] sync failed', err);
      })
      .finally(() => {
        this.sending = null;
        this.changed();
      });
    return this.sending;
  }

  private async send(): Promise<void> {
    const pending = await this.d.state.pending();
    this.queued = pending.length;
    if (!this.d.client.signedIn() || !(this.d.online?.() ?? true)) return;
    for (const p of pending) {
      if (this.conflicts.has(p.slot)) continue; // waits for the player's choice
      const base = await this.base(p.slot);
      if (base?.checksum === p.entry.checksum) {
        await this.d.state.dropPending(p.slot, p.entry.id);
        continue;
      }
      try {
        const saved = await this.d.client.put(
          p.slot,
          { meta: metaOf(p.entry), data: p.data, checksum: p.entry.checksum },
          base?.version ?? null,
        );
        await this.agree(p.slot, saved.version, saved.checksum);
        await this.d.state.dropPending(p.slot, p.entry.id);
      } catch (err) {
        const current = conflictOf(err);
        if (current !== undefined) {
          if (current?.checksum === p.entry.checksum) {
            await this.agree(p.slot, current.version, current.checksum);
            await this.d.state.dropPending(p.slot, p.entry.id);
          } else this.conflicts.set(p.slot, { slot: p.slot, local: p.entry, cloud: current });
          continue;
        }
        if (err instanceof ApiError && err.status === 401) return; // signed out: keep the queue
        if (err instanceof ApiError && [400, 413, 422, 428].includes(err.status)) {
          console.warn('[cloud] save refused by the server', err.code);
          await this.d.state.dropPending(p.slot, p.entry.id); // permanent: stays local only
          continue;
        }
        // Network, 429, 5xx, switch off: retry later, in order.
        this.lastError = !(err instanceof ApiError && (err.status === 0 || err.status === 429));
        this.retryLater(err instanceof ApiError ? err.retryAfterS : undefined);
        this.queued = (await this.d.state.pending()).length;
        return;
      }
    }
    this.failures = 0;
    this.lastError = false;
    this.queued = (await this.d.state.pending()).length;
    await this.refreshRemote();
  }

  /** Exponential backoff with jitter (0.5–1.5×), or the server's Retry-After. */
  private retryLater(retryAfterS?: number): void {
    this.failures += 1;
    if (this.retryTimer) return;
    this.retryTimer = true;
    const backoff = Math.min(RETRY_BASE_MS * 2 ** (this.failures - 1), RETRY_MAX_MS);
    const ms =
      retryAfterS !== undefined && retryAfterS > 0
        ? retryAfterS * 1000
        : Math.round(backoff * (0.5 + (this.d.random ?? Math.random)()));
    (this.d.schedule ?? setTimeout)(() => {
      this.retryTimer = false;
      void this.flush();
    }, ms);
  }

  /** Lists the account's cloud saves (for the load screen on a new device). */
  async refreshRemote(): Promise<readonly CloudSaveInfo[]> {
    if (!this.d.client.signedIn()) {
      this.remote = [];
      return this.remote;
    }
    try {
      this.remote = await this.d.client.list();
    } catch {
      // keep the last list
    }
    this.changed();
    return this.remote;
  }

  /**
   * Copies a cloud save into this device. Manual slots that hold a different local save need
   * `confirmed` (never overwrite silently); autosaves rotate, so nothing local is lost.
   * Returns the new local entry, or the conflict to show.
   */
  async download(
    slot: CloudSlot,
    opts: { version?: number; confirmed?: boolean } = {},
  ): Promise<{ entry: SaveEntry } | { conflict: SyncConflict }> {
    const store = this.store;
    if (!store) throw new Error('cloud sync is not attached to the save store');
    const cloud = await this.d.client.get(slot, opts.version);
    if (sha256Hex(cloud.data) !== cloud.checksum) throw new Error('cloud save is corrupt');
    const local = (await store.list()).find((e) => e.slot === slot) ?? null;
    if (slot !== 'auto' && local && local.checksum !== cloud.checksum && opts.confirmed !== true) {
      const { data: _data, ...info } = cloud;
      const conflict = { slot, local, cloud: info };
      this.conflicts.set(slot, conflict);
      this.changed();
      return { conflict };
    }
    // Agree first: the commit below re-queues the same bytes, which are then skipped.
    await this.agree(slot, cloud.version, cloud.checksum);
    const entry = await store.write(entryInputOf(cloud), {
      data: cloud.data,
      checksum: cloud.checksum,
    });
    this.conflicts.delete(slot);
    await this.flush();
    return { entry };
  }

  /** The player's choice for a conflict. "local" uploads this device's save over the cloud's. */
  async resolve(slot: CloudSlot, keep: 'local' | 'cloud'): Promise<SaveEntry | null> {
    const c = this.conflicts.get(slot);
    if (!c) return null;
    if (keep === 'cloud') {
      if (!c.cloud) {
        this.conflicts.delete(slot);
        this.changed();
        return null;
      }
      await this.d.state.dropPending(slot, c.local.id);
      const r = await this.download(slot, { confirmed: true });
      return 'entry' in r ? r.entry : null;
    }
    const key = this.baseKey(slot);
    if (key) {
      if (c.cloud) await this.agree(slot, c.cloud.version, c.cloud.checksum);
      else await this.d.state.dropBase(key);
    }
    const data = this.store ? (await this.store.read(c.local.id)).sealed.data : null;
    this.conflicts.delete(slot);
    if (data !== null) await this.d.state.putPending({ slot, entry: c.local, data });
    await this.flush();
    return c.local;
  }

  /**
   * Guest → account: queues this device's newest save of every cloud slot. Nothing is lost:
   * slots the cloud already holds differently become conflicts for the player to resolve.
   */
  async uploadLocal(): Promise<number> {
    const store = this.store;
    if (!store) return 0;
    const newest = new Map<CloudSlot, SaveEntry>();
    for (const e of await store.list()) {
      const slot = cloudSlotOf(e.slot);
      if (slot && !newest.has(slot)) newest.set(slot, e);
    }
    for (const [slot, entry] of newest) {
      const { sealed } = await store.read(entry.id);
      if (sealed.data.length <= MAX_CLOUD_DATA)
        await this.d.state.putPending({ slot, entry, data: sealed.data });
    }
    await this.flush();
    return newest.size;
  }

  /** Sign-out: conflicts and the remote list belong to the old account. */
  reset(): void {
    this.conflicts.clear();
    this.remote = [];
    this.changed();
  }
}
