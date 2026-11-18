/**
 * Cloud saves: GET /v1/saves, GET|PUT|DELETE /v1/saves/:slot. The owner is always the signed-in
 * account (no user id in the path: no IDOR surface). Writes need `If-Match: "v<n>"` (replace
 * version n) or `If-None-Match: *` (create); a stale precondition is 412 with the current
 * version, never an overwrite. Data integrity: SHA-256 of the payload must match `checksum`.
 */
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { problem } from '../middleware/problem.js';
import {
  CLOUD_SLOTS,
  MAX_SAVE_DATA,
  SaveMeta,
  type CloudSaveInfo,
  type CloudSlot,
  type SavesStore,
} from '../saves/store.js';
import { defineRoute, MAX_BODY_LIMIT } from './defineRoute.js';
import type { Authenticate } from './progress.js';

const Slot = z.enum(CLOUD_SLOTS);
const Upload = z.strictObject({
  meta: SaveMeta,
  data: z.string().min(2).max(MAX_SAVE_DATA),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});

const InfoSchema = z.object({
  slot: Slot,
  version: z.int(),
  checksum: z.string(),
  bytes: z.int(),
  meta: SaveMeta,
  updatedAt: z.string(),
});
const errors = {
  401: { description: 'No account.' },
  403: { description: 'Email not verified.' },
  404: { description: 'No such slot or version.' },
  429: { description: 'Rate limit exceeded.' },
};

const etag = (version: number) => `"v${String(version)}"`;
const view = (s: CloudSaveInfo) => ({ ...s, updatedAt: s.updatedAt.toISOString() });

/** The signed-in, verified account and the store; otherwise answers itself. */
async function owner(
  req: Request,
  res: Response,
): Promise<{ userId: string; store: SavesStore } | null> {
  const locals = req.app.locals as Record<string, unknown>;
  const authenticate = locals['authenticate'] as Authenticate | undefined;
  const store = locals['saves'] as SavesStore | undefined;
  res.set('Cache-Control', 'no-store');
  const account = authenticate ? await authenticate(req) : null;
  if (!account) {
    res.set('WWW-Authenticate', 'Bearer');
    problem(res, 401, 'unauthorized');
    return null;
  }
  if (!account.verified) {
    problem(res, 403, 'email_not_verified');
    return null;
  }
  if (!store) {
    problem(res, 503, 'unavailable');
    return null;
  }
  return { userId: account.userId, store };
}

function slotOf(req: Request, res: Response): CloudSlot | null {
  const slot = Slot.safeParse(req.params['slot']);
  if (!slot.success) problem(res, 404, 'not_found');
  return slot.success ? slot.data : null;
}

/** null: "If-None-Match: *" (create); number: "If-Match"; undefined: missing (428). */
function precondition(req: Request): number | null | undefined {
  if (req.get('if-none-match') === '*') return null;
  const m = /^"v(\d{1,9})"$/.exec(req.get('if-match') ?? '');
  return m?.[1] ? Number(m[1]) : undefined;
}

function conflict(res: Response, current: CloudSaveInfo | null): void {
  if (current) res.set('ETag', etag(current.version));
  problem(res, 412, 'conflict', { current: current && view(current) });
}

export const savesRoutes = [
  defineRoute({
    method: 'get',
    path: '/v1/saves',
    rateLimit: ['authed-user'],
    handler: async (req, res) => {
      const o = await owner(req, res);
      if (!o) return;
      // Thumbnails are only sent with single saves (list stays small).
      res.status(200).json({
        saves: (await o.store.list(o.userId)).map((s) => ({
          ...view(s),
          meta: { ...s.meta, thumbnail: null },
        })),
      });
    },
    doc: {
      tag: 'saves',
      bearer: true,
      summary: 'Cloud saves of the account (metadata, ≤ 6 versions)',
      responses: {
        200: { description: 'Saves.', schema: z.object({ saves: z.array(InfoSchema).max(6) }) },
        ...errors,
      },
    },
  }),
  defineRoute({
    method: 'get',
    path: '/v1/saves/:slot',
    rateLimit: ['authed-user'],
    handler: async (req, res) => {
      const o = await owner(req, res);
      const slot = o && slotOf(req, res);
      if (!o || !slot) return;
      const v = z.coerce.number().int().min(1).optional().safeParse(req.query['version']);
      const save = v.success ? await o.store.get(o.userId, slot, v.data) : null;
      if (!save) {
        problem(res, 404, 'not_found');
        return;
      }
      res.set('ETag', etag(save.version));
      res.status(200).json({ ...view(save), data: save.data });
    },
    doc: {
      tag: 'saves',
      bearer: true,
      summary: 'Download a save (newest, or ?version= for older autosaves)',
      responses: {
        200: { description: 'The save.', schema: InfoSchema.extend({ data: z.string() }) },
        ...errors,
      },
    },
  }),
  defineRoute({
    method: 'put',
    path: '/v1/saves/:slot',
    rateLimit: ['save-upload-user', 'authed-user'],
    feature: 'cloud-saves',
    bodyLimit: MAX_BODY_LIMIT,
    handler: async (req, res) => {
      const o = await owner(req, res);
      const slot = o && slotOf(req, res);
      if (!o || !slot) return;
      const expected = precondition(req);
      if (expected === undefined) {
        problem(res, 428, 'bad_request', { detail: 'Send If-Match: "v<n>" or If-None-Match: *' });
        return;
      }
      const body = Upload.safeParse(req.body);
      if (!body.success) {
        problem(res, 400, 'bad_request');
        return;
      }
      const { meta, data, checksum } = body.data;
      if (createHash('sha256').update(data).digest('hex') !== checksum) {
        problem(res, 422, 'bad_request', { detail: 'checksum does not match the data' });
        return;
      }
      let format: unknown;
      try {
        format = (JSON.parse(data) as { format?: unknown }).format;
      } catch {
        format = null;
      }
      if (format !== 'mrak-save') {
        problem(res, 422, 'bad_request', { detail: 'not a MRAK save' });
        return;
      }
      const now = (req.app.locals['now'] as () => Date)();
      const r = await o.store.put(
        o.userId,
        slot,
        expected,
        { meta, data, checksum, bytes: Buffer.byteLength(data) },
        now,
      );
      if (!r.ok) {
        conflict(res, r.current);
        return;
      }
      res.set('ETag', etag(r.save.version));
      res.status(expected === null ? 201 : 200).json(view(r.save));
    },
    doc: {
      tag: 'saves',
      bearer: true,
      summary: 'Upload a save (If-Match: "v<n>" to replace, If-None-Match: * to create)',
      body: Upload,
      responses: {
        200: { description: 'Replaced.', schema: InfoSchema },
        201: { description: 'Created.', schema: InfoSchema },
        400: { description: 'Malformed body.' },
        412: { description: 'Conflict: the cloud has another version (in `current`).' },
        413: { description: 'Body over 2 MB.' },
        422: { description: 'Checksum mismatch or not a MRAK save.' },
        428: { description: 'Missing If-Match / If-None-Match.' },
        503: { description: 'Cloud saves switched off.' },
        ...errors,
      },
    },
  }),
  defineRoute({
    method: 'delete',
    path: '/v1/saves/:slot',
    rateLimit: ['save-upload-user', 'authed-user'],
    feature: 'cloud-saves',
    handler: async (req, res) => {
      const o = await owner(req, res);
      const slot = o && slotOf(req, res);
      if (!o || !slot) return;
      const expected = precondition(req);
      if (typeof expected !== 'number') {
        problem(res, 428, 'bad_request', { detail: 'Send If-Match: "v<n>"' });
        return;
      }
      const r = await o.store.remove(o.userId, slot, expected);
      if (!r.ok) {
        if (r.current) conflict(res, r.current);
        else problem(res, 404, 'not_found');
        return;
      }
      res.status(204).end();
    },
    doc: {
      tag: 'saves',
      bearer: true,
      summary: 'Delete a cloud slot (If-Match: "v<n>")',
      responses: {
        204: { description: 'Deleted.' },
        412: { description: 'Conflict: the cloud has another version.' },
        428: { description: 'Missing If-Match.' },
        ...errors,
      },
    },
  }),
];
