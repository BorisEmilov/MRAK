/**
 * Emergency backup (docs/systems/save-system.md → Closing the page): a synchronous copy of the
 * game written to localStorage on `pagehide` / `visibilitychange`, because IndexedDB writes are
 * asynchronous and may not finish while the tab closes. Absorbed into the autosave rotation on the
 * next boot when it is newer than the newest autosave.
 */
import { MAX_SAVE_BYTES, verifySealed, type SealedSave } from '@mrak/core';
import { z } from 'zod';
import { SaveEntrySchema, type SaveEntryInput, type SaveStore } from './save-store';

export const EMERGENCY_KEY = 'mrak.emergency.v1';

type SyncStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const BackupSchema = z.strictObject({
  entry: SaveEntrySchema.omit({ id: true, checksum: true, bytes: true }),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  data: z.string().max(MAX_SAVE_BYTES),
});
export type EmergencyBackup = z.infer<typeof BackupSchema>;

/** Synchronous. Returns false when storage is unavailable or full (never throws). */
export function writeEmergency(
  storage: SyncStorage | undefined,
  entry: SaveEntryInput,
  sealed: SealedSave,
): boolean {
  if (!storage) return false;
  try {
    const backup: EmergencyBackup = { entry, checksum: sealed.checksum, data: sealed.data };
    storage.setItem(EMERGENCY_KEY, JSON.stringify(backup));
    return true;
  } catch {
    return false;
  }
}

export function readEmergency(storage: SyncStorage | undefined): EmergencyBackup | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(EMERGENCY_KEY);
    if (raw === null) return null;
    const parsed = BackupSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearEmergency(storage: SyncStorage | undefined): void {
  try {
    storage?.removeItem(EMERGENCY_KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

/**
 * Moves a pending emergency backup into the autosave rotation if it is intact and newer than every
 * stored save. Always clears it afterwards. Returns true when it was absorbed.
 */
export async function absorbEmergency(
  storage: SyncStorage | undefined,
  saves: SaveStore,
): Promise<boolean> {
  const backup = readEmergency(storage);
  if (!backup) {
    clearEmergency(storage);
    return false;
  }
  const sealed = { data: backup.data, checksum: backup.checksum };
  const latest = await saves.latest();
  const newer = latest === null || backup.entry.savedAt > latest.savedAt;
  let absorbed = false;
  if (newer && verifySealed(sealed)) {
    await saves.write({ ...backup.entry, slot: 'auto', reason: 'suspend' }, sealed);
    absorbed = true;
  }
  clearEmergency(storage);
  return absorbed;
}
