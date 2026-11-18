/**
 * Store routes (docs/systems/store.md): entitlements, checkout, payment webhook, signed full-pack
 * URLs and the collector's credits name. Access is granted only by the verified webhook.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { problem } from '../middleware/problem.js';
import { SKUS, SOURCES, type LocalSigner, type Store } from '../store/store.js';
import { defineRoute } from './defineRoute.js';
import type { Authenticate } from './progress.js';

const svc = (req: Request) =>
  (req.app.locals as Record<string, unknown>)['store'] as Store | undefined;

/** Signed-in account (any) and the store; otherwise answers itself. */
async function buyer(req: Request, res: Response) {
  const authenticate = (req.app.locals as Record<string, unknown>)['authenticate'] as
    Authenticate | undefined;
  res.set('Cache-Control', 'no-store');
  const account = authenticate ? await authenticate(req) : null;
  if (!account) {
    res.set('WWW-Authenticate', 'Bearer');
    problem(res, 401, 'unauthorized');
    return null;
  }
  const store = svc(req);
  if (!store) {
    problem(res, 503, 'unavailable');
    return null;
  }
  return { ...account, store };
}

const Checkout = z.strictObject({
  sku: z.enum(SKUS),
  /** EU: consent to immediate access and acknowledgement of losing the right of withdrawal. */
  consent: z.literal(true),
});
const CollectorName = z.strictObject({ name: z.string().min(2).max(64) });
const EntitlementView = z.object({
  sku: z.enum(SKUS),
  source: z.enum(SOURCES),
  status: z.enum(['active', 'revoked']),
  purchasedAt: z.string(),
  refundedAt: z.string().nullable(),
});
const Ticket = z.object({
  url: z.string(),
  version: z.string(),
  sha256: z.string(),
  bytes: z.int(),
  expiresAt: z.string(),
});

export const storeRoutes = [
  defineRoute({
    method: 'get',
    path: '/v1/store/entitlements',
    rateLimit: ['authed-user'],
    handler: async (req, res) => {
      const b = await buyer(req, res);
      if (!b) return;
      res.json({
        entitlements: (await b.store.entitlements(b.userId)).map((e) => ({
          sku: e.sku,
          source: e.source,
          status: e.status,
          purchasedAt: e.purchasedAt.toISOString(),
          refundedAt: e.refundedAt?.toISOString() ?? null,
        })),
      });
    },
    doc: {
      tag: 'store',
      bearer: true,
      summary: 'What the account owns (the return page polls this after checkout)',
      responses: {
        200: {
          description: 'Entitlements.',
          schema: z.object({ entitlements: z.array(EntitlementView) }),
        },
        401: { description: 'No account.' },
      },
    },
  }),
  defineRoute({
    method: 'post',
    path: '/v1/store/checkout',
    rateLimit: ['authed-user', 'checkout-user', 'checkout-ip'],
    feature: 'purchases',
    handler: async (req, res) => {
      const b = await buyer(req, res);
      if (!b) return;
      const body = Checkout.safeParse(req.body);
      if (!body.success) {
        problem(res, 400, 'bad_request');
        return;
      }
      const r = await b.store.checkout(b.userId, b.verified, body.data.sku, req.ip ?? '0.0.0.0');
      if (r.ok) res.status(201).json({ url: r.url });
      else if (r.reason === 'unverified') problem(res, 403, 'email_not_verified');
      else if (r.reason === 'owned') problem(res, 409, 'already_owned');
      else if (r.reason === 'blocked') problem(res, 403, 'purchases_blocked');
      else problem(res, 503, 'unavailable');
    },
    doc: {
      tag: 'store',
      bearer: true,
      summary: 'Hosted checkout session for a verified account (price chosen by the server)',
      body: Checkout,
      responses: {
        201: { description: 'Redirect the browser here.', schema: z.object({ url: z.string() }) },
        400: { description: 'Invalid body or missing consent.' },
        401: { description: 'No account.' },
        403: { description: 'Email not verified or purchases blocked.' },
        409: { description: 'Already owned.' },
        429: { description: 'Rate limited.' },
        503: { description: 'Store not configured or switched off.' },
      },
    },
  }),
  defineRoute({
    method: 'post',
    path: '/v1/store/webhook',
    rateLimit: ['webhook-ip'],
    bodyLimit: 64 * 1024,
    rawBody: true,
    handler: async (req, res) => {
      const store = svc(req);
      const raw = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!store || !raw) {
        problem(res, store ? 400 : 503, store ? 'bad_request' : 'unavailable');
        return;
      }
      const r = await store.webhook(raw, (n) => req.get(n), req.ip ?? '0.0.0.0');
      if (r === 'invalid') problem(res, 400, 'invalid_signature');
      else res.status(200).json({ status: r });
    },
    doc: {
      tag: 'store',
      csrf: false,
      summary: 'Payment provider webhook (signature + timestamp verified, idempotent by event id)',
      responses: {
        200: {
          description: 'Processed, duplicate or ignored.',
          schema: z.object({ status: z.string() }),
        },
        400: { description: 'Invalid signature, stale timestamp or body.' },
      },
    },
  }),
  defineRoute({
    method: 'post',
    path: '/v1/content/full',
    rateLimit: ['authed-user', 'content-url-user'],
    handler: async (req, res) => {
      const b = await buyer(req, res);
      if (!b) return;
      const t = await b.store.fullPackTicket(b.userId);
      if (t === 'forbidden') problem(res, 403, 'entitlement_required');
      else if (t === 'unavailable') problem(res, 503, 'unavailable');
      else res.json(t);
    },
    doc: {
      tag: 'store',
      bearer: true,
      summary: 'Signed URL (5 min) of the paid full content pack; full-game entitlement required',
      responses: {
        200: { description: 'Download ticket.', schema: Ticket },
        401: { description: 'No account.' },
        403: { description: 'No full-game entitlement.' },
        429: { description: 'Rate limited.' },
      },
    },
  }),
  defineRoute({
    method: 'get',
    path: '/v1/content/files/:name',
    rateLimit: ['public-ip'],
    handler: (req, res) => {
      // Development/E2E stand-in for R2 presigned URLs (LocalSigner is refused in production).
      const local = (req.app.locals as Record<string, unknown>)['localContent'] as
        { signer: LocalSigner; read: (name: string) => Buffer | null; now: () => Date } | undefined;
      const name = String(req.params['name'] ?? '');
      const exp = Number(req.query['exp']);
      const sig = typeof req.query['sig'] === 'string' ? req.query['sig'] : '';
      const bytes =
        local && /^[\w.-]{1,96}$/.test(name) && local.signer.verify(name, exp, sig, local.now())
          ? local.read(name)
          : null;
      if (!bytes) {
        problem(res, 403, 'forbidden');
        return;
      }
      res.set('Cache-Control', 'private, no-store').type('application/json').send(bytes);
    },
    doc: {
      tag: 'store',
      summary: 'Development only: signed content file (production uses R2 presigned URLs)',
      responses: {
        200: { description: 'The file.' },
        403: { description: 'Bad or expired signature.' },
      },
    },
  }),
  defineRoute({
    method: 'post',
    path: '/v1/store/collector-name',
    rateLimit: ['authed-user', 'collector-name-user'],
    handler: async (req, res) => {
      const b = await buyer(req, res);
      if (!b) return;
      const body = CollectorName.safeParse(req.body);
      const r = body.success ? await b.store.collectorName(b.userId, body.data.name) : 'invalid';
      if (r === 'forbidden') problem(res, 403, 'entitlement_required');
      else if (r === 'invalid') problem(res, 400, 'invalid_name');
      else res.status(202).json({ status: r });
    },
    doc: {
      tag: 'store',
      bearer: true,
      summary: "Collector's edition: villager name for the credits (moderated before use)",
      body: CollectorName,
      responses: {
        202: { description: 'Awaiting moderation.', schema: z.object({ status: z.string() }) },
        400: { description: 'Name not allowed.' },
        403: { description: "No collector's edition." },
      },
    },
  }),
];
