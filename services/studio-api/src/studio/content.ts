/**
 * Studio service (docs/systems/studio.md): validated edits with history, the review workflow,
 * import from packages/content and export of the pack (game files, manifest, demo and full packs).
 */
/* eslint-disable security/detect-non-literal-fs-filename -- paths = CONTENT_ROOT/EXPORT_DIR (deploy config) + entry files that come from the import or from `data/<known collection>/<validated id>.json` */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  COLLECTIONS,
  ContentManifest,
  FullContentPack,
  IssueList,
  LOC_KEY_PATTERN,
  Registry,
  splitByTier,
  validatePack,
  type CollectionName,
  type RawPack,
} from '@mrak/content-schema';
import { buildManifest, CONTENT_LAYOUT, loadRawPack } from '@mrak/content-schema/node';
import { z } from 'zod';
import type { ContentStore, Entry, Revision, Status } from './store.js';

export const REGISTRY = 'registry';
export const LOCALES = 'locales';
const REGISTRY_FILE = 'data/flags.json';
const LOCALE_FILE = 'locales/en.json';

export class StudioError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

const isCollection = (c: string): c is CollectionName => c in COLLECTIONS;
export const editable = (c: string): boolean => isCollection(c) || c === REGISTRY || c === LOCALES;

function schemaOf(collection: string): z.ZodType {
  if (isCollection(collection)) return COLLECTIONS[collection].schema;
  if (collection === REGISTRY) return Registry;
  if (collection === LOCALES) return z.string().min(1).max(4000);
  throw new StudioError(404, 'unknown_collection');
}

/** Field-level differences between two JSON values ("path", before, after). */
export function jsonDiff(
  a: unknown,
  b: unknown,
  path = '',
): { path: string; before: unknown; after: unknown }[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const obj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      out.push(...jsonDiff(a[i], b[i], `${path}[${String(i)}]`));
    return out;
  }
  if (obj(a) && obj(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => jsonDiff(a[k], b[k], path ? `${path}.${k}` : k));
  }
  return [{ path: path || '(root)', before: a ?? null, after: b ?? null }];
}

/** Stable stringify (sorted keys): JSONB does not keep key order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object' && v !== null)
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/** `value` with object keys in the order of `template` (the file on disk); new keys last. */
export function orderLike(value: unknown, template: unknown): unknown {
  if (Array.isArray(value))
    return value.map((v, i) => orderLike(v, Array.isArray(template) ? template[i] : undefined));
  if (typeof value !== 'object' || value === null) return value;
  const obj = value as Record<string, unknown>;
  const t =
    typeof template === 'object' && template !== null && !Array.isArray(template)
      ? (template as Record<string, unknown>)
      : {};
  const keys = [
    ...Object.keys(t).filter((k) => k in obj),
    ...Object.keys(obj).filter((k) => !(k in t)),
  ];
  return Object.fromEntries(keys.map((k) => [k, orderLike(obj[k], t[k])]));
}

export interface StudioDeps {
  store: ContentStore;
  /** packages/content (import source, "Export to game" target). */
  contentRoot: string;
  /** Where demo/full packs are written. */
  exportDir: string;
  now: () => Date;
  /** Formats exported JSON like the repository (Prettier); identity when unavailable. */
  format?: (path: string, text: string) => Promise<string>;
}

export class Studio {
  constructor(private readonly d: StudioDeps) {}

  list(collection?: string) {
    return this.d.store.all().then((all) =>
      all
        .filter((e) => !collection || e.collection === collection)
        .map(({ collection: c, entityId, status, version, deleted, updatedBy, updatedAt }) => ({
          collection: c,
          entityId,
          status,
          version,
          deleted,
          updatedBy,
          updatedAt,
        }))
        .sort((x, y) => x.entityId.localeCompare(y.entityId)),
    );
  }

  async get(collection: string, id: string): Promise<Entry> {
    const e = await this.d.store.get(collection, id);
    if (!e) throw new StudioError(404, 'not_found');
    return e;
  }

  /** Create or update the working copy → new draft version (optimistic: `expectedVersion`). */
  async put(
    collection: string,
    id: string,
    body: unknown,
    author: string,
    expectedVersion: number | null,
    note: string | null,
  ): Promise<Entry> {
    if (!editable(collection)) throw new StudioError(404, 'unknown_collection');
    if (collection === LOCALES ? !LOC_KEY_PATTERN.test(id) : !/^[a-z0-9][a-z0-9-]{0,159}$/.test(id))
      throw new StudioError(400, 'invalid_id');
    const parsed = schemaOf(collection).safeParse(body);
    if (!parsed.success) throw new StudioError(422, 'invalid_body', z.treeifyError(parsed.error));
    if (isCollection(collection) && (body as { id?: unknown }).id !== id)
      throw new StudioError(422, 'id_mismatch');
    const current = await this.d.store.get(collection, id);
    if ((current?.version ?? 0) !== (expectedVersion ?? 0))
      throw new StudioError(409, 'version_conflict', { current: current?.version ?? 0 });
    const place = current ?? (await this.placeNew(collection, id));
    const next: Entry = {
      ...place,
      body,
      status: 'draft',
      version: (current?.version ?? 0) + 1,
      deleted: false,
      updatedBy: author,
      updatedAt: this.d.now(),
    };
    await this.d.store.save(next, note);
    return next;
  }

  async remove(collection: string, id: string, author: string): Promise<Entry> {
    const e = await this.get(collection, id);
    const next: Entry = {
      ...e,
      status: 'draft',
      deleted: true,
      version: e.version + 1,
      updatedBy: author,
      updatedAt: this.d.now(),
    };
    await this.d.store.save(next, 'deleted');
    return next;
  }

  /** draft → reviewed (by someone else) → published (copies the body for export). */
  async setStatus(collection: string, id: string, status: Status, author: string): Promise<Entry> {
    const e = await this.get(collection, id);
    if (status === 'reviewed') {
      if (e.status !== 'draft') throw new StudioError(409, 'not_a_draft');
      if (e.updatedBy === author && author !== 'local')
        throw new StudioError(403, 'review_by_another_person');
    } else if (status === 'published') {
      if (e.status !== 'reviewed') throw new StudioError(409, 'needs_review');
    } else throw new StudioError(400, 'bad_status');
    const next: Entry = {
      ...e,
      status,
      version: e.version + 1,
      publishedBody: status === 'published' ? (e.deleted ? null : e.body) : e.publishedBody,
      updatedBy: author,
      updatedAt: this.d.now(),
    };
    await this.d.store.save(next, status);
    return next;
  }

  history(collection: string, id: string): Promise<Revision[]> {
    return this.d.store.history(collection, id);
  }

  async diff(collection: string, id: string, from: number, to: number) {
    const revs = await this.history(collection, id);
    const a = revs.find((r) => r.version === from);
    const b = revs.find((r) => r.version === to);
    if (!a || !b) throw new StudioError(404, 'not_found');
    return jsonDiff(a.body, b.body);
  }

  private async placeNew(collection: string, id: string): Promise<Entry> {
    const same = (await this.d.store.all()).filter((e) => e.collection === collection);
    const arrayFile = same.find((e) => e.position >= 0)?.file;
    const last = Math.max(-1, ...same.filter((e) => e.file === arrayFile).map((e) => e.position));
    const file =
      collection === LOCALES
        ? LOCALE_FILE
        : collection === REGISTRY
          ? REGISTRY_FILE
          : (arrayFile ?? `data/${collection}/${id}.json`);
    return {
      collection,
      entityId: id,
      file,
      position: arrayFile || collection === LOCALES ? last + 1 : -1,
      body: null,
      publishedBody: null,
      status: 'draft',
      version: 0,
      deleted: false,
      updatedBy: '',
      updatedAt: this.d.now(),
    };
  }

  // ------------------------------------------------------------- import / pack building

  /** Every entity, the registry and each locale key of `contentRoot` become published entries. */
  async import(author: string): Promise<{ created: number; updated: number; unchanged: number }> {
    const raw = loadRawPack(this.d.contentRoot, new IssueList());
    const incoming: {
      collection: string;
      id: string;
      file: string;
      position: number;
      body: unknown;
    }[] = [];
    for (const [c, list] of Object.entries(raw.collections))
      for (const entry of list) {
        const items = Array.isArray(entry.data) ? (entry.data as unknown[]) : [entry.data];
        items.forEach((item, i) => {
          incoming.push({
            collection: c,
            id: String((item as { id?: unknown }).id),
            file: entry.file,
            position: Array.isArray(entry.data) ? i : -1,
            body: item,
          });
        });
      }
    incoming.push({
      collection: REGISTRY,
      id: 'flags',
      file: REGISTRY_FILE,
      position: -1,
      body: raw.registry.data,
    });
    Object.entries(raw.locales.en.data as Record<string, string>).forEach(([k, text], i) => {
      incoming.push({ collection: LOCALES, id: k, file: LOCALE_FILE, position: i, body: text });
    });
    const existing = new Map(
      (await this.d.store.all()).map((e) => [`${e.collection}/${e.entityId}`, e]),
    );
    const counts = { created: 0, updated: 0, unchanged: 0 };
    for (const n of incoming) {
      const e = existing.get(`${n.collection}/${n.id}`);
      if (e && !e.deleted && canonical(e.publishedBody) === canonical(n.body)) {
        counts.unchanged++;
        continue;
      }
      counts[e ? 'updated' : 'created']++;
      await this.d.store.save(
        {
          collection: n.collection,
          entityId: n.id,
          file: n.file,
          position: n.position,
          body: n.body,
          publishedBody: n.body,
          status: 'published',
          version: (e?.version ?? 0) + 1,
          deleted: false,
          updatedBy: author,
          updatedAt: this.d.now(),
        },
        'import',
      );
    }
    return counts;
  }

  /** Raw pack from published bodies (`working`: from working copies), with the repo's ink/maps. */
  async rawPack(working = false): Promise<{ raw: RawPack; files: Map<string, unknown> }> {
    const disk = loadRawPack(this.d.contentRoot, new IssueList());
    const bodyOf = (e: Entry) => (working ? (e.deleted ? null : e.body) : e.publishedBody);
    const live = (await this.d.store.all()).filter((e) => bodyOf(e) !== null);
    const byFile = new Map<string, Entry[]>();
    for (const e of live) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
    const files = new Map<string, unknown>();
    const collections: RawPack['collections'] = {};
    for (const [file, list] of byFile) {
      list.sort((a, b) => a.position - b.position);
      const first = list[0];
      if (!first) continue;
      if (first.collection === LOCALES)
        files.set(file, Object.fromEntries(list.map((e) => [e.entityId, bodyOf(e)])));
      else files.set(file, first.position < 0 ? bodyOf(first) : list.map(bodyOf));
      if (isCollection(first.collection))
        (collections[first.collection] ??= []).push({ file, data: files.get(file) });
    }
    const raw: RawPack = {
      registry: { file: REGISTRY_FILE, data: files.get(REGISTRY_FILE) ?? {} },
      locales: { en: { file: LOCALE_FILE, data: files.get(LOCALE_FILE) ?? {} } },
      collections,
      ...(disk.maps ? { maps: disk.maps } : {}),
      ...(disk.ink ? { ink: disk.ink } : {}),
    };
    return { raw, files };
  }

  // ------------------------------------------------------------- export

  async export(): Promise<{
    version: string;
    hash: string;
    written: string[];
    removed: string[];
    demo: { file: string; sha256: string; bytes: number };
    full: { file: string; sha256: string; bytes: number };
  }> {
    const { raw, files } = await this.rawPack();
    const result = validatePack(raw);
    const errors = result.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) throw new StudioError(422, 'pack_invalid', errors.slice(0, 50));

    const root = this.d.contentRoot;
    const format = this.d.format ?? ((_p: string, t: string) => Promise.resolve(t));
    const written: string[] = [];
    for (const [file, data] of files) {
      const path = join(root, file);
      const onDisk: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
      // Entities are matched by id so key order survives reordering and insertions.
      const template =
        Array.isArray(data) && Array.isArray(onDisk)
          ? data.map((d) =>
              (onDisk as { id?: unknown }[]).find((o) => o.id === (d as { id?: unknown }).id),
            )
          : onDisk;
      if (onDisk !== undefined && canonical(onDisk) === canonical(data)) continue;
      const text = await format(path, `${JSON.stringify(orderLike(data, template), null, 2)}\n`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      written.push(file);
    }
    // Single-entity files whose entity was deleted and published.
    const removed: string[] = [];
    for (const e of await this.d.store.all())
      if (
        e.position < 0 &&
        e.publishedBody === null &&
        !files.has(e.file) &&
        existsSync(join(root, e.file))
      ) {
        rmSync(join(root, e.file));
        removed.push(e.file);
      }

    const manifestPath = join(root, CONTENT_LAYOUT.manifest);
    const old = ContentManifest.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    const changed = written.length + removed.length > 0;
    const [maj, min, pat] = old.version.split('.').map(Number);
    const version = changed
      ? `${String(maj)}.${String(min)}.${String((pat ?? 0) + 1)}`
      : old.version;
    const manifest = buildManifest(root, { packId: old.packId, version });
    if (changed)
      writeFileSync(
        manifestPath,
        await format(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
      );

    const { demo, full } = splitByTier(raw);
    const out = join(this.d.exportDir, version);
    mkdirSync(out, { recursive: true });
    const write = (name: string, data: unknown) => {
      const bytes = Buffer.from(JSON.stringify(data));
      writeFileSync(join(out, name), bytes);
      return {
        file: join(out, name),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
      };
    };
    const demoFiles = Object.fromEntries(
      Object.values(demo.collections).flatMap((list) => list.map((e) => [e.file, e.data])),
    );
    return {
      version,
      hash: manifest.hash,
      written,
      removed,
      demo: write('demo.json', {
        packId: `${old.packId}-demo`,
        version,
        files: { ...demoFiles, [REGISTRY_FILE]: raw.registry.data },
        locales: { en: demo.locales.en.data },
      }),
      full: write(`mrak-full-${version}.json`, FullContentPack.parse({ ...full, version })),
    };
  }
}
