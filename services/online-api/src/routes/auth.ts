/** Account routes (/v1/auth, /v1/me, JWKS). Handlers: src/auth/controller.ts. */
import { z } from 'zod';
import { controller, schemas } from '../auth/controller.js';
import { defineRoute, type RouteDoc } from './defineRoute.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

const Accepted = z.object({ status: z.literal('check-your-email') });
const User = z.object({
  id: z.uuid(),
  email: z.string(),
  emailVerified: z.boolean(),
  displayName: z.string().nullable(),
  createdAt: z.string(),
});
const Issued = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
  user: User,
  refreshToken: z.string().optional().describe('Native platforms only; web gets the cookie.'),
  refreshExpiresAt: z.string().optional(),
});
const Session = z.object({
  id: z.uuid(),
  platform: z.enum(['web', 'desktop', 'android', 'ios']),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  current: z.boolean(),
});

const problems = (...codes: number[]): RouteDoc['responses'] =>
  Object.fromEntries(
    codes.map((c) => [
      c,
      {
        description:
          {
            400: 'Invalid body, token or human check (RFC 9457 problem).',
            401: 'Not authenticated.',
            403: 'Missing CSRF header or origin not allowed.',
            404: 'Not found.',
            422: 'Weak password or email not allowed.',
            429: 'Rate limited or temporarily blocked (Retry-After).',
            503: 'Busy; retry later.',
          }[c] ?? 'Error.',
      },
    ]),
  );

const post = (
  path: string,
  limit: [number, number],
  handler: (typeof controller)[keyof typeof controller],
  doc: Omit<RouteDoc, 'tag'>,
) =>
  defineRoute({
    method: 'post',
    path,
    rateLimit: { windowMs: limit[0], limit: limit[1] },
    handler,
    doc: { tag: 'auth', csrf: true, ...doc },
  });

export const authRoutes = [
  post('/v1/auth/register', [HOUR, 10], controller.register, {
    summary: 'Create an account (Turnstile required); same answer whether or not the email exists',
    body: schemas.register,
    responses: {
      202: { description: 'Check your email.', schema: Accepted },
      ...problems(400, 403, 422, 429, 503),
    },
  }),
  post('/v1/auth/verify-email', [15 * MIN, 20], controller.verifyEmail, {
    summary: 'Confirm the email address with the emailed token',
    body: schemas.verifyEmail,
    responses: { 204: { description: 'Verified.' }, ...problems(400, 403, 429) },
  }),
  post('/v1/auth/resend-verification', [HOUR, 5], controller.resendVerification, {
    summary: 'Send the verification email again (Turnstile required)',
    body: schemas.emailCaptcha,
    responses: {
      202: { description: 'Check your email.', schema: Accepted },
      ...problems(400, 403, 429),
    },
  }),
  post('/v1/auth/login', [MIN, 10], controller.login, {
    summary: 'Sign in; web gets the refresh cookie, native platforms the token in the body',
    body: schemas.login,
    responses: {
      200: { description: 'Signed in.', schema: Issued },
      ...problems(400, 401, 403, 429, 503),
    },
  }),
  post('/v1/auth/refresh', [MIN, 30], controller.refresh, {
    summary: 'Rotate the refresh token (cookie, or body on native) and get a new access token',
    cookie: true,
    body: schemas.refresh,
    responses: {
      200: { description: 'Rotated.', schema: Issued },
      ...problems(400, 401, 403, 429),
    },
  }),
  post('/v1/auth/logout', [MIN, 30], controller.logout, {
    summary: 'Revoke the current session',
    cookie: true,
    body: schemas.refresh,
    responses: { 204: { description: 'Signed out.' }, ...problems(400, 403, 429) },
  }),
  defineRoute({
    method: 'post',
    path: '/v1/auth/logout-all',
    rateLimit: { windowMs: MIN, limit: 10 },
    handler: controller.logoutAll,
    doc: {
      tag: 'auth',
      bearer: true,
      summary: 'Revoke every session of the account',
      responses: { 204: { description: 'Signed out everywhere.' }, ...problems(401, 429) },
    },
  }),
  post('/v1/auth/forgot-password', [HOUR, 5], controller.forgotPassword, {
    summary: 'Email a password reset link (Turnstile required); same answer for unknown emails',
    body: schemas.emailCaptcha,
    responses: {
      202: { description: 'Check your email.', schema: Accepted },
      ...problems(400, 403, 429),
    },
  }),
  post('/v1/auth/reset-password', [15 * MIN, 10], controller.resetPassword, {
    summary: 'Set a new password with the emailed token; revokes every session',
    body: schemas.resetPassword,
    responses: { 204: { description: 'Password changed.' }, ...problems(400, 403, 422, 429, 503) },
  }),
  defineRoute({
    method: 'get',
    path: '/v1/me',
    rateLimit: { windowMs: MIN, limit: 60 },
    handler: controller.getMe,
    doc: {
      tag: 'me',
      bearer: true,
      summary: 'The signed-in account',
      responses: { 200: { description: 'Account.', schema: User }, ...problems(401, 429) },
    },
  }),
  defineRoute({
    method: 'patch',
    path: '/v1/me',
    rateLimit: { windowMs: MIN, limit: 20 },
    handler: controller.patchMe,
    doc: {
      tag: 'me',
      bearer: true,
      summary: 'Change the display name',
      body: schemas.patchMe,
      responses: { 200: { description: 'Account.', schema: User }, ...problems(400, 401, 429) },
    },
  }),
  defineRoute({
    method: 'get',
    path: '/v1/me/sessions',
    rateLimit: { windowMs: MIN, limit: 30 },
    handler: controller.sessions,
    doc: {
      tag: 'me',
      bearer: true,
      summary: 'Active sessions (max 100)',
      responses: {
        200: {
          description: 'Sessions.',
          schema: z.object({ sessions: z.array(Session).max(100) }),
        },
        ...problems(401, 429),
      },
    },
  }),
  defineRoute({
    method: 'delete',
    path: '/v1/me/sessions/:id',
    rateLimit: { windowMs: MIN, limit: 20 },
    handler: controller.revokeSession,
    doc: {
      tag: 'me',
      bearer: true,
      summary: 'Revoke one of your sessions',
      responses: { 204: { description: 'Revoked.' }, ...problems(401, 404, 429) },
    },
  }),
  defineRoute({
    method: 'post',
    path: '/v1/me/change-password',
    rateLimit: { windowMs: 15 * MIN, limit: 5 },
    handler: controller.changePassword,
    doc: {
      tag: 'me',
      bearer: true,
      summary: 'Change the password (current one required); revokes every session',
      body: schemas.changePassword,
      responses: { 204: { description: 'Changed.' }, ...problems(400, 401, 422, 429, 503) },
    },
  }),
  defineRoute({
    method: 'get',
    path: '/v1/me/export',
    rateLimit: { windowMs: 24 * HOUR, limit: 3 },
    handler: controller.exportMe,
    doc: {
      tag: 'me',
      bearer: true,
      summary: 'GDPR export of everything stored about the account (JSON)',
      responses: {
        200: { description: 'Export.', schema: z.record(z.string(), z.unknown()) },
        ...problems(401, 429),
      },
    },
  }),
  defineRoute({
    method: 'delete',
    path: '/v1/me',
    rateLimit: { windowMs: HOUR, limit: 5 },
    handler: controller.deleteMe,
    doc: {
      tag: 'me',
      bearer: true,
      summary: 'Delete the account and its data (password + "DELETE" required)',
      body: schemas.deleteMe,
      responses: { 204: { description: 'Deleted.' }, ...problems(400, 401, 429) },
    },
  }),
  defineRoute({
    method: 'get',
    path: '/.well-known/jwks.json',
    rateLimit: { windowMs: MIN, limit: 120 },
    handler: (req, res) => {
      const jwks = req.app.locals['jwks'] as { keys: unknown[] } | undefined;
      res.set('Cache-Control', 'public, max-age=300');
      res.status(200).json(jwks ?? { keys: [] });
    },
    doc: {
      tag: 'auth',
      summary: 'Public keys that verify access tokens (EdDSA)',
      responses: {
        200: {
          description: 'JSON Web Key Set.',
          schema: z.object({ keys: z.array(z.record(z.string(), z.unknown())) }),
        },
      },
    },
  }),
];
