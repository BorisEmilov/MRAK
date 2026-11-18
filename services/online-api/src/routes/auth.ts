/** Account routes (/v1/auth, /v1/me, JWKS). Handlers: src/auth/controller.ts. */
import { z } from 'zod';
import { controller, schemas } from '../auth/controller.js';
import type { PolicyName } from '../limits/policies.js';
import { defineRoute, type RouteDoc } from './defineRoute.js';

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
  limits: readonly PolicyName[],
  handler: (typeof controller)[keyof typeof controller],
  doc: Omit<RouteDoc, 'tag'>,
) =>
  defineRoute({
    method: 'post',
    path,
    rateLimit: limits,
    ...(path === '/v1/auth/register' ? { feature: 'registration' as const } : {}),
    handler,
    doc: { tag: 'auth', csrf: true, ...doc },
  });

export const authRoutes = [
  post('/v1/auth/register', ['register-ip', 'register-ip-day'], controller.register, {
    summary: 'Create an account (Turnstile required); same answer whether or not the email exists',
    body: schemas.register,
    responses: {
      202: { description: 'Check your email.', schema: Accepted },
      ...problems(400, 403, 422, 429, 503),
    },
  }),
  post('/v1/auth/verify-email', ['auth-token-ip'], controller.verifyEmail, {
    summary: 'Confirm the email address with the emailed token',
    body: schemas.verifyEmail,
    responses: { 204: { description: 'Verified.' }, ...problems(400, 403, 429) },
  }),
  post(
    '/v1/auth/resend-verification',
    ['email-send-email', 'email-send-ip'],
    controller.resendVerification,
    {
      summary: 'Send the verification email again (Turnstile required)',
      body: schemas.emailCaptcha,
      responses: {
        202: { description: 'Check your email.', schema: Accepted },
        ...problems(400, 403, 429),
      },
    },
  ),
  post('/v1/auth/login', ['login-ip-email', 'login-ip'], controller.login, {
    summary: 'Sign in; web gets the refresh cookie, native platforms the token in the body',
    body: schemas.login,
    responses: {
      200: { description: 'Signed in.', schema: Issued },
      ...problems(400, 401, 403, 429, 503),
    },
  }),
  post('/v1/auth/refresh', ['refresh-ip'], controller.refresh, {
    summary: 'Rotate the refresh token (cookie, or body on native) and get a new access token',
    cookie: true,
    body: schemas.refresh,
    responses: {
      200: { description: 'Rotated.', schema: Issued },
      ...problems(400, 401, 403, 429),
    },
  }),
  post('/v1/auth/logout', ['logout-ip'], controller.logout, {
    summary: 'Revoke the current session',
    cookie: true,
    body: schemas.refresh,
    responses: { 204: { description: 'Signed out.' }, ...problems(400, 403, 429) },
  }),
  defineRoute({
    method: 'post',
    path: '/v1/auth/logout-all',
    rateLimit: ['authed-user'],
    handler: controller.logoutAll,
    doc: {
      tag: 'auth',
      bearer: true,
      summary: 'Revoke every session of the account',
      responses: { 204: { description: 'Signed out everywhere.' }, ...problems(401, 429) },
    },
  }),
  post(
    '/v1/auth/forgot-password',
    ['email-send-email', 'email-send-ip'],
    controller.forgotPassword,
    {
      summary: 'Email a password reset link (Turnstile required); same answer for unknown emails',
      body: schemas.emailCaptcha,
      responses: {
        202: { description: 'Check your email.', schema: Accepted },
        ...problems(400, 403, 429),
      },
    },
  ),
  post('/v1/auth/reset-password', ['auth-token-ip'], controller.resetPassword, {
    summary: 'Set a new password with the emailed token; revokes every session',
    body: schemas.resetPassword,
    responses: { 204: { description: 'Password changed.' }, ...problems(400, 403, 422, 429, 503) },
  }),
  defineRoute({
    method: 'get',
    path: '/v1/me',
    rateLimit: ['authed-user'],
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
    rateLimit: ['authed-user'],
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
    rateLimit: ['authed-user'],
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
    rateLimit: ['authed-user'],
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
    rateLimit: ['sensitive-user', 'authed-user'],
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
    rateLimit: ['export-user', 'authed-user'],
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
    rateLimit: ['sensitive-user', 'authed-user'],
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
    rateLimit: ['public-ip'],
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
