/**
 * Demo / full split (docs/systems/store.md → Paid content). The public build bundles only the
 * demo half of the content; the full half is a separate pack downloaded with a short-lived signed
 * URL by accounts holding the full-game entitlement, then merged back on the client.
 *
 * What is "full": array entries and single-entity files with `tier: "full"`, full-tier nodes of
 * demo trees, and locale keys referenced only by full content.
 */
import { z } from 'zod';
import {
  COLLECTION_NAMES,
  COLLECTIONS,
  LocaleFile,
  type CollectionName,
  type RawPack,
} from './pack';
import { collectRefs } from './walk';

export const FULL_PACK_ID = 'mrak-full';
const DataPath = z.string().regex(/^data\/[a-z0-9-]+\/[a-z0-9-]+\.json$/);

export const FullContentPack = z
  .strictObject({
    packId: z.literal(FULL_PACK_ID),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    /** Full-tier entries appended to bundled array files. */
    entries: z.record(DataPath, z.array(z.unknown()).max(1000)),
    /** Whole full-tier files (single-entity files). */
    files: z.record(DataPath, z.unknown()),
    /** Full-tier nodes appended to bundled trees. */
    treeNodes: z.record(DataPath, z.array(z.unknown()).max(200)),
    locales: z.strictObject({ en: LocaleFile }),
  })
  .meta({ id: 'FullContentPack' });
export type FullContentPack = z.infer<typeof FullContentPack>;

const isFull = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && (v as { tier?: unknown }).tier === 'full';

function locKeys(c: CollectionName, data: unknown, into: Set<string>): void {
  const schema = COLLECTIONS[c].schema;
  for (const entity of Array.isArray(data) ? data : [data])
    for (const r of collectRefs(schema, entity)) if (r.kind === 'loc') into.add(r.id);
}

/** The demo half of a raw pack and the full pack body (everything except `version`). */
export function splitByTier(raw: RawPack): {
  demo: RawPack;
  full: Omit<FullContentPack, 'version'>;
} {
  const full: Omit<FullContentPack, 'version'> = {
    packId: FULL_PACK_ID,
    entries: {},
    files: {},
    treeNodes: {},
    locales: { en: {} },
  };
  const before = new Set<string>();
  const after = new Set<string>();
  const collections: RawPack['collections'] = {};
  for (const c of COLLECTION_NAMES) {
    const list = raw.collections[c];
    if (!list) continue;
    collections[c] = [];
    for (const entry of list) {
      locKeys(c, entry.data, before);
      let data: unknown = entry.data;
      if (Array.isArray(data)) {
        const paid = data.filter(isFull);
        if (paid.length > 0) {
          full.entries[entry.file] = paid;
          data = data.filter((e) => !isFull(e));
        }
      } else if (isFull(data)) {
        full.files[entry.file] = data;
        continue;
      } else if (c === 'trees' && typeof data === 'object' && data !== null) {
        const tree = data as { nodes?: unknown[] };
        const paid = (tree.nodes ?? []).filter(isFull);
        if (paid.length > 0) {
          full.treeNodes[entry.file] = paid;
          data = { ...tree, nodes: (tree.nodes ?? []).filter((n) => !isFull(n)) };
        }
      }
      locKeys(c, data, after);
      collections[c].push({ file: entry.file, data });
    }
  }
  const en: Record<string, string> = {};
  for (const [key, text] of Object.entries(raw.locales.en.data as Record<string, string>))
    if (before.has(key) && !after.has(key)) full.locales.en[key] = text;
    else en[key] = text;
  return {
    demo: { ...raw, collections, locales: { en: { ...raw.locales.en, data: en } } },
    full,
  };
}

/** Bundled demo content + the downloaded full pack = the whole game. */
export function mergeFullPack(raw: RawPack, pack: FullContentPack): RawPack {
  const en = { ...(raw.locales.en.data as Record<string, string>) };
  for (const [key, text] of Object.entries(pack.locales.en)) {
    if (key in en) throw new Error(`full pack: locale key "${key}" exists`);
    en[key] = text;
  }
  const collections: RawPack['collections'] = {};
  const seen = new Set<string>();
  for (const c of COLLECTION_NAMES) {
    const list = raw.collections[c];
    if (!list) continue;
    collections[c] = list.map((entry) => {
      seen.add(entry.file);
      let data = entry.data;
      const extra = pack.entries[entry.file];
      if (extra && Array.isArray(data)) data = [...(data as unknown[]), ...extra];
      const nodes = pack.treeNodes[entry.file];
      if (nodes && typeof data === 'object' && data !== null) {
        const tree = data as { nodes?: unknown[] };
        data = { ...tree, nodes: [...(tree.nodes ?? []), ...nodes] };
      }
      return { file: entry.file, data };
    });
  }
  for (const [file, data] of Object.entries(pack.files)) {
    const c = file.split('/')[1] as CollectionName;
    if (seen.has(file) || !(c in COLLECTIONS)) throw new Error(`full pack: bad file "${file}"`);
    (collections[c] ??= []).push({ file, data });
  }
  return { ...raw, collections, locales: { en: { ...raw.locales.en, data: en } } };
}
