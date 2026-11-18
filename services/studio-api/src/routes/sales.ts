/** Internal sales panel (studio is never exposed to the internet). */
import type { Request } from 'express';
import { z } from 'zod';
import type { SalesSource } from '../sales.js';
import { defineRoute } from './defineRoute.js';

const source = (req: Request) =>
  (req.app.locals as Record<string, unknown>)['sales'] as SalesSource | undefined;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
const Days = z.coerce.number().int().min(1).max(365).default(30);
const Moderation = z.strictObject({ status: z.enum(['approved', 'rejected']) });

export const salesRoutes = [
  defineRoute({
    method: 'get',
    path: '/v1/sales/summary',
    rateLimit: { windowMs: 60_000, limit: 60 },
    handler: async (req, res) => {
      const s = source(req);
      if (!s) {
        res.status(503).json({ error: 'unavailable' });
        return;
      }
      res.json(await s.summary(Days.parse(req.query['days'] ?? undefined)));
    },
  }),
  defineRoute({
    method: 'get',
    path: '/sales',
    rateLimit: { windowMs: 60_000, limit: 60 },
    handler: async (req, res) => {
      const s = source(req);
      if (!s) {
        res.status(503).send('Sales database not configured.');
        return;
      }
      const days = Days.parse(req.query['days'] ?? undefined);
      const [sum, names] = await Promise.all([s.summary(days), s.pendingNames()]);
      const rows = sum.sales
        .map(
          (r) =>
            `<tr><td>${esc(r.sku)}</td><td>${esc(r.source)}</td><td>${String(r.count)}</td></tr>`,
        )
        .join('');
      const pending = names
        .map((x) => `<tr><td>${esc(x.name)}</td><td><code>${esc(x.userId)}</code></td></tr>`)
        .join('');
      res
        .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
        .type('html')
        .send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>MRAK studio — sales</title>
<style>body{font:15px system-ui;margin:2rem;max-width:60rem}td,th{padding:.3rem .8rem;border-bottom:1px solid #ccc;text-align:left}</style>
<h1>Sales — last ${String(days)} days</h1>
<p>Verified accounts: <b>${String(sum.accounts)}</b> · buyers: <b>${String(sum.buyers)}</b> ·
demo → purchase: <b>${(sum.conversion * 100).toFixed(1)} %</b> · refunds/chargebacks: <b>${String(sum.refunds)}</b></p>
<table><tr><th>SKU</th><th>Source</th><th>Sales</th></tr>${rows}</table>
<h2>Collector names awaiting moderation (${String(sum.pendingNames)})</h2>
<p>Approve or reject with <code>POST /v1/collector-names/:userId {"status": …}</code>.</p>
<table><tr><th>Name</th><th>Account</th></tr>${pending}</table></html>`);
    },
  }),
  defineRoute({
    method: 'post',
    path: '/v1/collector-names/:userId',
    rateLimit: { windowMs: 60_000, limit: 60 },
    handler: async (req, res) => {
      const s = source(req);
      const body = Moderation.safeParse(req.body);
      const id = z.uuid().safeParse(req.params['userId']);
      if (!s || !body.success || !id.success) {
        res.status(s ? 400 : 503).json({ error: s ? 'bad_request' : 'unavailable' });
        return;
      }
      res.status((await s.moderate(id.data, body.data.status)) ? 204 : 404).end();
    },
  }),
];
