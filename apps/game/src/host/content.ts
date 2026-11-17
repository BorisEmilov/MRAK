/**
 * Loads the content pack bundled with the game, validates it with the same validator as CI, and
 * builds the core ContentDatabase.
 */
import {
  applyContentPacks,
  COLLECTION_NAMES,
  validatePack,
  type ContentPackFile,
  type CollectionName,
  type RawEntry,
  type RawPack,
} from '@mrak/content-schema';
import { ContentDatabase } from '@mrak/core';
import en from '@mrak/content/locales/en.json';
import manifest from '../../../../packages/content/manifest.json';

const dataFiles = import.meta.glob<unknown>('../../../../packages/content/data/**/*.json', {
  eager: true,
  import: 'default',
});

export class ContentLoadError extends Error {
  override readonly name = 'ContentLoadError';
}

export function buildRawPack(files: Record<string, unknown>): RawPack {
  const known = new Set<string>(COLLECTION_NAMES);
  const collections: Partial<Record<CollectionName, RawEntry[]>> = {};
  let registry: RawEntry | undefined;
  for (const [path, data] of Object.entries(files)) {
    const rel = path.slice(path.indexOf('/data/') + '/data/'.length);
    if (rel === 'flags.json') {
      registry = { file: `data/${rel}`, data };
      continue;
    }
    const collection = rel.split('/')[0] ?? '';
    if (!known.has(collection)) continue;
    (collections[collection as CollectionName] ??= []).push({ file: `data/${rel}`, data });
  }
  if (!registry) throw new ContentLoadError('content registry (flags.json) is missing');
  return { registry, locales: { en: { file: 'locales/en.json', data: en } }, collections };
}

/**
 * The bundled content plus verified live packs. A pack set that does not validate with the
 * bundled content is dropped (the game never breaks on a bad pack).
 */
export function loadContentDatabase(packs: readonly ContentPackFile[] = []): ContentDatabase {
  if (packs.length > 0) {
    try {
      const merged = validatePack(applyContentPacks(buildRawPack(dataFiles), packs));
      if (merged.ok)
        return new ContentDatabase(merged.pack, {
          version: `${manifest.version}+${packs.map((p) => `${p.packId}@${p.version}`).join(',')}`,
          hash: manifest.hash,
        });
      console.warn(
        '[packs] rejected:',
        merged.issues.filter((i) => i.severity === 'error').map((i) => i.code),
      );
    } catch (err) {
      console.warn('[packs] rejected:', err);
    }
  }
  const result = validatePack(buildRawPack(dataFiles));
  if (!result.ok) {
    const first = result.issues.find((i) => i.severity === 'error');
    throw new ContentLoadError(first ? `${first.code}: ${first.message}` : 'invalid content pack');
  }
  return new ContentDatabase(result.pack, { version: manifest.version, hash: manifest.hash });
}
