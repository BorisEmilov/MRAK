/** Newsletter routes (double opt-in). Answers never reveal whether an address is subscribed. */
import { z } from 'zod';
import { problem } from '../middleware/problem.js';
import type { Newsletter } from '../newsletter/newsletter.js';
import { defineRoute } from './defineRoute.js';

const svc = (locals: Record<string, unknown>) => locals['newsletter'] as Newsletter | undefined;
const Subscribe = z.strictObject({
  email: z.string().trim().max(254).pipe(z.email()),
  captcha: z.string().max(2048).optional(),
});
const Confirm = z.strictObject({ token: z.string().min(20).max(128) });
const Unsubscribe = z.strictObject({ id: z.uuid(), sig: z.string().max(64) });

export const newsletterRoutes = [
  defineRoute({
    method: 'post',
    path: '/v1/newsletter/subscribe',
    rateLimit: ['newsletter-ip', 'email-send-email'],
    feature: 'emails',
    handler: async (req, res) => {
      const n = svc(req.app.locals);
      const body = Subscribe.safeParse(req.body);
      if (!n) {
        problem(res, 503, 'unavailable');
        return;
      }
      if (!body.success) {
        problem(res, 400, 'bad_request');
        return;
      }
      try {
        await n.subscribe(body.data.email, body.data.captcha, req.ip ?? '0.0.0.0');
      } catch {
        {
          problem(res, 400, 'captcha_required', { captcha: true });
          return;
        }
      }
      res.status(202).json({ status: 'check-your-email' });
    },
    doc: {
      tag: 'newsletter',
      csrf: false,
      summary: 'Ask to join the newsletter (Turnstile); a confirmation link is emailed',
      body: Subscribe,
      responses: {
        202: { description: 'Check your email.', schema: z.object({ status: z.string() }) },
        400: { description: 'Invalid body or human check.' },
        429: { description: 'Rate limited.' },
      },
    },
  }),
  defineRoute({
    method: 'post',
    path: '/v1/newsletter/confirm',
    rateLimit: ['auth-token-ip'],
    handler: async (req, res) => {
      const n = svc(req.app.locals);
      const body = Confirm.safeParse(req.body);
      if (!n) {
        problem(res, 503, 'unavailable');
        return;
      }
      if (!body.success || !(await n.confirm(body.data.token))) {
        problem(res, 400, 'invalid_token');
        return;
      }
      res.status(204).end();
    },
    doc: {
      tag: 'newsletter',
      summary: 'Confirm the subscription with the emailed token',
      body: Confirm,
      responses: {
        204: { description: 'Subscribed.' },
        400: { description: 'Invalid or expired.' },
      },
    },
  }),
  defineRoute({
    method: 'post',
    path: '/v1/newsletter/unsubscribe',
    rateLimit: ['auth-token-ip'],
    handler: async (req, res) => {
      const n = svc(req.app.locals);
      const body = Unsubscribe.safeParse(req.body);
      if (!n) {
        problem(res, 503, 'unavailable');
        return;
      }
      if (body.success) await n.unsubscribe(body.data.id, body.data.sig);
      res.status(204).end();
    },
    doc: {
      tag: 'newsletter',
      summary: 'Leave the newsletter (signed link from any newsletter mail)',
      body: Unsubscribe,
      responses: { 204: { description: 'Done (also for unknown links).' } },
    },
  }),
];
