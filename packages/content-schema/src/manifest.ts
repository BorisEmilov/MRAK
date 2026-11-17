import { z } from 'zod';
import { Id } from './primitives';

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/, 'expected lowercase hex SHA-256');

/**
 * Content pack manifest (docs/systems/content-model.md). Each file's `sha256` is taken over its
 * canonical JSON (formatting-insensitive). `hash` is the SHA-256 of the sorted lines
 * `<path>:<sha256>\n`, so any data change in any file changes the pack hash.
 * Signing (Ed25519) is added when packs are distributed by online-api.
 */
export const ContentManifest = z
  .strictObject({
    packId: Id,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'expected semver x.y.z'),
    schemaVersion: z.int().min(1),
    files: z
      .array(
        z.strictObject({
          path: z.string().min(1),
          sha256: Sha256,
          bytes: z
            .int()
            .min(0)
            .max(2 * 1024 * 1024),
        }),
      )
      .min(1),
    hash: Sha256,
  })
  .meta({ id: 'ContentManifest' });
export type ContentManifest = z.infer<typeof ContentManifest>;

/** Current version of the content schema. Bump when content must be migrated. */
export const CONTENT_SCHEMA_VERSION = 1;

/** Canonical text the pack hash is computed from. */
export function manifestHashInput(files: readonly { path: string; sha256: string }[]): string {
  return [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}:${f.sha256}\n`)
    .join('');
}
