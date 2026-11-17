/** Node-only helpers: load a content pack from disk and compute its manifest. */
import { INK_DIR, loadInk } from './ink';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CONTENT_SCHEMA_VERSION, ContentManifest, manifestHashInput } from '../manifest';
import {
  COLLECTION_NAMES,
  type CollectionName,
  type RawEntry,
  type RawMaps,
  type RawPack,
} from '../pack';
import type { IssueList } from '../validate/issues';

/** Layout of a content root (packages/content). */
export const CONTENT_LAYOUT = {
  dataDir: 'data',
  registry: 'data/flags.json',
  locale: 'locales/en.json',
  manifest: 'manifest.json',
  mapsDir: 'maps',
} as const;

function listFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? listFiles(full) : [full];
    })
    .sort();
}

/** Zone maps (`maps/**.tmj`, parsed) and every file beside them, for map validation. */
export function loadRawMaps(root: string, issues: IssueList): RawMaps {
  const files = listFiles(join(root, CONTENT_LAYOUT.mapsDir));
  const maps: Record<string, unknown> = {};
  for (const file of files.filter((f) => f.endsWith('.tmj'))) {
    const entry = readEntry(root, file, issues);
    if (entry.data !== undefined) maps[entry.file] = entry.data;
  }
  return { maps, files: new Set(files.map((f) => toPosix(relative(root, f)))) };
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function listJson(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? listJson(full) : name.endsWith('.json') ? [full] : [];
    })
    .sort();
}

function readEntry(root: string, file: string, issues: IssueList): RawEntry {
  const rel = toPosix(relative(root, file));
  try {
    return { file: rel, data: JSON.parse(readFileSync(file, 'utf8')) as unknown };
  } catch (err) {
    issues.error('invalid-json', err instanceof Error ? err.message : String(err), { file: rel });
    return { file: rel, data: undefined };
  }
}

/** Loads `data/<collection>/**.json`, `data/flags.json` and `locales/en.json`. */
export function loadRawPack(root: string, issues: IssueList): RawPack {
  const dataDir = join(root, CONTENT_LAYOUT.dataDir);
  const collections: Partial<Record<CollectionName, RawEntry[]>> = {};
  const known = new Set<string>(COLLECTION_NAMES);

  for (const name of readdirSafe(dataDir)) {
    const full = join(dataDir, name);
    if (!statSync(full).isDirectory()) continue;
    if (!known.has(name)) {
      issues.error('unknown-collection', `folder "data/${name}" is not a known collection`, {
        file: `data/${name}`,
      });
      continue;
    }
    collections[name as CollectionName] = listJson(full)
      .map((file) => readEntry(root, file, issues))
      .filter((entry) => entry.data !== undefined);
  }

  return {
    registry: readEntry(root, join(root, CONTENT_LAYOUT.registry), issues),
    locales: { en: readEntry(root, join(root, CONTENT_LAYOUT.locale), issues) },
    collections,
    maps: loadRawMaps(root, issues),
    ink: loadInk(root),
  };
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** Every file that belongs to the pack (data, locales, maps, ink), as posix paths relative to root. */
export function packFiles(root: string): string[] {
  return [
    ...listJson(join(root, CONTENT_LAYOUT.dataDir)),
    ...listJson(join(root, 'locales')),
    ...listFiles(join(root, CONTENT_LAYOUT.mapsDir)),
    ...listFiles(join(root, INK_DIR)),
  ].map((f) => toPosix(relative(root, f)));
}

/**
 * SHA-256 of the file's canonical JSON (parsed and re-serialized without whitespace), so
 * reformatting a file (Prettier, editors) does not change its hash but any data change does.
 */
export function canonicalHash(bytes: Buffer): string {
  let canonical: string;
  try {
    canonical = JSON.stringify(JSON.parse(bytes.toString('utf8')));
  } catch {
    // Not JSON (tileset images…): hash the raw bytes.
    return createHash('sha256').update(bytes).digest('hex');
  }
  return createHash('sha256').update(canonical).digest('hex');
}

export function buildManifest(
  root: string,
  meta: { packId: string; version: string },
): ContentManifest {
  const files = packFiles(root).map((path) => {
    const bytes = readFileSync(join(root, path));
    return { path, sha256: canonicalHash(bytes), bytes: bytes.length };
  });
  const hash = createHash('sha256').update(manifestHashInput(files)).digest('hex');
  return ContentManifest.parse({ ...meta, schemaVersion: CONTENT_SCHEMA_VERSION, files, hash });
}

/** Compares the manifest on disk with the files; reports a stale or missing manifest. */
export function checkManifest(root: string, issues: IssueList): void {
  const file = CONTENT_LAYOUT.manifest;
  let onDisk: ContentManifest;
  try {
    onDisk = ContentManifest.parse(JSON.parse(readFileSync(join(root, file), 'utf8')));
  } catch (err) {
    issues.error(
      'manifest-invalid',
      `missing or invalid manifest — run "pnpm content:manifest" (${err instanceof Error ? (err.message.split('\n')[0] ?? '') : ''})`,
      { file },
    );
    return;
  }
  const fresh = buildManifest(root, { packId: onDisk.packId, version: onDisk.version });
  if (fresh.hash !== onDisk.hash) {
    const before = new Map(onDisk.files.map((f) => [f.path, f.sha256]));
    const changed = fresh.files.filter((f) => before.get(f.path) !== f.sha256).map((f) => f.path);
    const removed = onDisk.files
      .filter((f) => !fresh.files.some((g) => g.path === f.path))
      .map((f) => f.path);
    issues.error(
      'manifest-stale',
      `manifest hash does not match the files (changed: ${[...changed, ...removed].join(', ') || 'order'}) — run "pnpm content:manifest"`,
      { file },
    );
  }
  if (onDisk.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    issues.error(
      'manifest-schema-version',
      `manifest schemaVersion ${String(onDisk.schemaVersion)} ≠ ${String(CONTENT_SCHEMA_VERSION)}`,
      { file },
    );
  }
}
