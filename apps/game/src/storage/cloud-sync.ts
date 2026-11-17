/**
 * CloudSync (docs/systems/save-system.md): the seam for cloud saves through online-api. Only the
 * null implementation exists now; the real one (authenticated `GET/PUT /saves/:slot` with
 * `baseRevision` conflict detection) arrives in phase 25. Local saves never depend on it.
 */
import type { SaveEntry, SlotId } from './save-store';

export type CloudStatus = 'disabled' | 'idle' | 'syncing' | 'conflict' | 'error';

export interface CloudSave {
  entry: SaveEntry;
  data: string;
}

export interface CloudSync {
  readonly status: CloudStatus;
  /** Uploads a committed local save. Fire-and-forget from the caller's point of view. */
  push(entry: SaveEntry, data: string): Promise<void>;
  /** Downloads the cloud copy of a slot, if any. */
  pull(slot: SlotId): Promise<CloudSave | null>;
  /** Cloud saves visible to the player. */
  list(): Promise<SaveEntry[]>;
  remove(slot: SlotId): Promise<void>;
}

/** No account / not implemented yet: does nothing, never fails. */
export class NullCloudSync implements CloudSync {
  readonly status: CloudStatus = 'disabled';

  push(): Promise<void> {
    return Promise.resolve();
  }

  pull(): Promise<CloudSave | null> {
    return Promise.resolve(null);
  }

  list(): Promise<SaveEntry[]> {
    return Promise.resolve([]);
  }

  remove(): Promise<void> {
    return Promise.resolve();
  }
}
