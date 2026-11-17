/**
 * Save integrity (docs/systems/save-system.md): checksums for stored saves and the export file
 * envelope used for manual backups. Integrity against corruption only — never anti-cheat.
 */
import { z } from 'zod';
import { sha256Hex } from './checksum';
import {
  deserializeSave,
  MAX_SAVE_BYTES,
  SaveError,
  SaveTooNewError,
  serializeSave,
  type SaveFile,
} from './save';

/** A stored save failed its integrity check (bytes changed since it was written). */
export class SaveCorruptError extends SaveError {
  override readonly name = 'SaveCorruptError';
}

export interface SealedSave {
  /** Serialized save text (`serializeSave`). */
  data: string;
  /** SHA-256 hex of `data`. */
  checksum: string;
}

export function sealSave(save: SaveFile): SealedSave {
  const data = serializeSave(save);
  return { data, checksum: sha256Hex(data) };
}

export function verifySealed(sealed: SealedSave): boolean {
  return sha256Hex(sealed.data) === sealed.checksum;
}

/** Verifies the checksum, then migrates and validates. Throws SaveCorruptError / SaveError. */
export function openSealed(sealed: SealedSave): ReturnType<typeof deserializeSave> {
  if (!verifySealed(sealed)) throw new SaveCorruptError('save checksum mismatch');
  try {
    return deserializeSave(sealed.data);
  } catch (err) {
    // Newer-version saves are not corrupt: the player needs a different message.
    if (err instanceof SaveTooNewError) throw err;
    throw new SaveCorruptError(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Export file
// ---------------------------------------------------------------------------

export const EXPORT_FORMAT = 'mrak-export';
export const EXPORT_VERSION = 1;
/** Envelope overhead allowance on top of the save itself. */
export const MAX_EXPORT_BYTES = MAX_SAVE_BYTES + 64 * 1024;

const ExportEnvelopeSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string().max(64),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  save: z.string().max(MAX_SAVE_BYTES),
});

export function packExport(sealed: SealedSave, exportedAt: Date): string {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    checksum: sealed.checksum,
    save: sealed.data,
  });
}

/**
 * Validates an imported file (untrusted input): size, envelope, checksum, migration and schema.
 * Returns the save re-sealed in the current format.
 */
export function unpackExport(text: string): {
  save: SaveFile;
  sealed: SealedSave;
  migratedFrom: number | null;
} {
  if (text.length > MAX_EXPORT_BYTES) throw new SaveError('save file too large');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveCorruptError('save file is not valid JSON');
  }
  const envelope = ExportEnvelopeSchema.safeParse(raw);
  if (!envelope.success) throw new SaveCorruptError('not a MRAK save file');
  const { save, migratedFrom } = openSealed({
    data: envelope.data.save,
    checksum: envelope.data.checksum,
  });
  return { save, sealed: sealSave(save), migratedFrom };
}
