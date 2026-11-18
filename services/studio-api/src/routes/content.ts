/** Studio content routes (docs/systems/studio.md → API). Author = the Access identity. */
/* eslint-disable security/detect-non-literal-fs-filename -- fixed json-schema directory of the repo */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLLECTIONS, REF_KINDS } from '@mrak/content-schema';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { analyse } from '../studio/analysis.js';
import { LOCALES, REGISTRY, StudioError, type Studio } from '../studio/content.js';
import { STATUSES } from '../studio/store.js';
import { defineRoute } from './defineRoute.js';

const studio = (req: Request) =>
  (req.app.locals as Record<string, unknown>)['studio'] as Studio | undefined;
const author = (res: Response) => String(res.locals['author'] ?? 'local');
const READ = { windowMs: 60_000, limit: 600 };
const WRITE = { windowMs: 60_000, limit: 120 };
const HEAVY = { windowMs: 60_000, limit: 10 };

/** Runs a handler with the studio; StudioError → JSON problem. */
const handle =
  (fn: (s: Studio, req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    const s = studio(req);
    if (!s) {
      res.status(503).json({ error: 'unavailable' });
      return;
    }
    fn(s, req, res)
      .then((body) => {
        if (!res.headersSent) res.json(body);
      })
      .catch((err: unknown) => {
        if (err instanceof StudioError)
          res.status(err.status).json({ error: err.code, details: err.details ?? null });
        else next(err);
      });
  };

const p = (req: Request, k: string) => String(req.params[k] ?? '');
const Put = z.strictObject({
  body: z.unknown(),
  expectedVersion: z.int().min(0).nullable(),
  note: z.string().max(500).nullable().optional(),
});
const StatusBody = z.strictObject({ status: z.enum(STATUSES) });
const Diff = z.object({ from: z.coerce.number().int(), to: z.coerce.number().int() });
// Resolved through the package (works in the repo and in the deployed image).
const SCHEMA_DIR = new URL(
  '.',
  import.meta.resolve('@mrak/content-schema/json-schema/condition.schema.json'),
);

export const contentRoutes = [
  defineRoute({
    method: 'get',
    path: '/v1/schemas',
    rateLimit: READ,
    handler: (_req, res) => {
      const dir = SCHEMA_DIR.pathname;
      const schemas = Object.fromEntries(
        readdirSync(dir)
          .filter((f) => f.endsWith('.schema.json'))
          .map((f) => [
            f.replace('.schema.json', ''),
            JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown,
          ]),
      );
      res.json({ collections: [...Object.keys(COLLECTIONS), REGISTRY, LOCALES], schemas });
    },
  }),
  defineRoute({
    method: 'get',
    path: '/v1/ids',
    rateLimit: READ,
    // Autocomplete: every id by reference kind (flags, stats, villagers, items, loc keys…) and
    // the English texts for loc-key previews.
    handler: handle(async (s) => {
      const { raw } = await s.rawPack(true);
      const ids: Record<string, string[]> = Object.fromEntries(REF_KINDS.map((k) => [k, []]));
      const reg = (raw.registry.data ?? {}) as Record<string, { id: string }[] | undefined>;
      ids['flag'] = (reg['flags'] ?? []).map((f) => f.id);
      ids['stat'] = (reg['stats'] ?? []).map((f) => f.id);
      ids['rule'] = (reg['rules'] ?? []).map((f) => f.id);
      ids['context'] = (reg['contexts'] ?? []).map((f) => f.id);
      ids['loc'] = Object.keys(raw.locales.en.data as object);
      for (const [c, list] of Object.entries(raw.collections)) {
        const kind = COLLECTIONS[c as keyof typeof COLLECTIONS].kind;
        for (const e of list)
          for (const item of Array.isArray(e.data)
            ? (e.data as { id: string }[])
            : [e.data as { id: string }])
            (ids[kind] ??= []).push(item.id);
      }
      return { ids, texts: raw.locales.en.data as Record<string, string> };
    }),
  }),
  defineRoute({
    method: 'get',
    path: '/v1/entries',
    rateLimit: READ,
    handler: handle(async (s, req) => ({
      entries: (
        await s.list(
          typeof req.query['collection'] === 'string' ? req.query['collection'] : undefined,
        )
      ).slice(0, 5000),
    })),
  }),
  defineRoute({
    method: 'get',
    path: '/v1/entries/:collection/:id',
    rateLimit: READ,
    handler: handle((s, req) => s.get(p(req, 'collection'), p(req, 'id'))),
  }),
  defineRoute({
    method: 'put',
    path: '/v1/entries/:collection/:id',
    rateLimit: WRITE,
    handler: handle(async (s, req, res) => {
      const b = Put.safeParse(req.body);
      if (!b.success) throw new StudioError(400, 'bad_request');
      return s.put(
        p(req, 'collection'),
        p(req, 'id'),
        b.data.body,
        author(res),
        b.data.expectedVersion,
        b.data.note ?? null,
      );
    }),
  }),
  defineRoute({
    method: 'delete',
    path: '/v1/entries/:collection/:id',
    rateLimit: WRITE,
    handler: handle((s, req, res) => s.remove(p(req, 'collection'), p(req, 'id'), author(res))),
  }),
  defineRoute({
    method: 'post',
    path: '/v1/entries/:collection/:id/status',
    rateLimit: WRITE,
    handler: handle(async (s, req, res) => {
      const b = StatusBody.safeParse(req.body);
      if (!b.success) throw new StudioError(400, 'bad_request');
      return s.setStatus(p(req, 'collection'), p(req, 'id'), b.data.status, author(res));
    }),
  }),
  defineRoute({
    method: 'get',
    path: '/v1/entries/:collection/:id/history',
    rateLimit: READ,
    handler: handle(async (s, req) => ({
      revisions: await s.history(p(req, 'collection'), p(req, 'id')),
    })),
  }),
  defineRoute({
    method: 'get',
    path: '/v1/entries/:collection/:id/diff',
    rateLimit: READ,
    handler: handle(async (s, req) => {
      const q = Diff.safeParse(req.query);
      if (!q.success) throw new StudioError(400, 'bad_request');
      return { changes: await s.diff(p(req, 'collection'), p(req, 'id'), q.data.from, q.data.to) };
    }),
  }),
  defineRoute({
    method: 'get',
    path: '/v1/analysis',
    rateLimit: HEAVY,
    // Working copies by default (what editors see); ?published=1 for what would be exported.
    handler: handle(async (s, req) =>
      analyse((await s.rawPack(req.query['published'] !== '1')).raw),
    ),
  }),
  defineRoute({
    method: 'post',
    path: '/v1/import',
    rateLimit: HEAVY,
    handler: handle((s, _req, res) => s.import(author(res))),
  }),
  defineRoute({
    method: 'post',
    path: '/v1/export',
    rateLimit: HEAVY,
    handler: handle((s) => s.export()),
  }),
];
