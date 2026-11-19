/**
 * HTTP layer of the account service (controllers): validation, the refresh cookie, CSRF/Origin
 * checks, the bearer guard and error mapping to RFC 9457 problems. Business rules: service.ts.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { problem } from '../middleware/problem.js';
import { PASSWORD_MAX } from './passwords.js';
import {
  AuthError,
  type AuthService,
  type Issued,
  type Principal,
  type RequestContext,
} from './service.js';

export const REFRESH_COOKIE = '__Secure-mrak_rt';
export const CSRF_HEADER = 'x-mrak-csrf';

export interface AuthHttpConfig {
  /** Exact origins allowed to call /v1/auth with the cookie (game, landing, native shells). */
  allowedOrigins: readonly string[];
  /** Shared parent domain for the cookie (e.g. "mrak.game"); empty: host-only. */
  cookieDomain: string;
  /** Cookie path: `/v1/auth` direct, `/api/v1/auth` behind the same-origin proxy (ADR 0012). */
  cookiePath?: string;
}

export interface AuthDeps {
  service: AuthService;
  http: AuthHttpConfig;
}

export function authDeps(req: Request): AuthDeps | null {
  return (req.app.locals['auth'] as AuthDeps | undefined) ?? null;
}

// ------------------------------------------------------------------ schemas

const Email = z.string().trim().min(3).max(254).pipe(z.email());
const Password = z
  .string()
  .min(1)
  .max(PASSWORD_MAX * 4);
const Captcha = z.string().max(2048).optional();
const Token = z.string().min(20).max(128);
/** 3–24 letters, digits, spaces, "-", "_", "." (no markup). */
const DisplayName = z
  .string()
  .trim()
  .regex(/^[\p{L}\p{N} ._-]{3,24}$/u);
const Platform = z.enum(['web', 'desktop', 'android', 'ios']);

export const schemas = {
  register: z.strictObject({
    email: Email,
    password: Password,
    displayName: DisplayName.optional(),
    captcha: Captcha,
  }),
  verifyEmail: z.strictObject({ token: Token }),
  emailCaptcha: z.strictObject({ email: Email, captcha: Captcha }),
  login: z.strictObject({
    email: Email,
    password: Password,
    platform: Platform.default('web'),
    captcha: Captcha,
  }),
  refresh: z.strictObject({ refreshToken: Token.optional() }),
  resetPassword: z.strictObject({ token: Token, password: Password }),
  patchMe: z.strictObject({ displayName: DisplayName.nullable().optional() }),
  changePassword: z.strictObject({ currentPassword: Password, newPassword: Password }),
  deleteMe: z.strictObject({ password: Password, confirm: z.literal('DELETE') }),
  sessionId: z.uuid(),
};

// ------------------------------------------------------------------ helpers

function context(req: Request): RequestContext {
  return { ip: req.ip ?? '0.0.0.0', userAgent: (req.get('user-agent') ?? '').slice(0, 512) };
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function cookie(deps: AuthDeps, value: string, maxAgeS: number): string {
  return [
    `${REFRESH_COOKIE}=${value}`,
    `Path=${deps.http.cookiePath ?? '/v1/auth'}`,
    ...(deps.http.cookieDomain ? [`Domain=${deps.http.cookieDomain}`] : []),
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${String(Math.max(0, Math.floor(maxAgeS)))}`,
  ].join('; ');
}

/** CSRF (C-16): custom header always; an Origin, when sent, must be allow-listed; required for cookies. */
function csrfOk(req: Request, deps: AuthDeps, cookieUsed: boolean): boolean {
  if (req.get(CSRF_HEADER) !== '1') return false;
  const origin = req.get('origin');
  if (origin === undefined) return !cookieUsed;
  return deps.http.allowedOrigins.includes(origin);
}

function fail(res: Response, err: unknown): void {
  if (!(err instanceof AuthError)) throw err;
  const status: Record<AuthError['code'], number> = {
    bad_request: 400,
    unauthorized: 401,
    not_found: 404,
    captcha_required: 400,
    weak_password: 422,
    email_not_allowed: 422,
    invalid_credentials: 401,
    invalid_token: 400,
    too_many_requests: 429,
    unavailable: 503,
  };
  if (err.code === 'too_many_requests')
    res.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
  problem(
    res,
    status[err.code],
    err.code,
    err.code === 'captcha_required' ? { captcha: true } : {},
  );
}

type Handler = (req: Request, res: Response, deps: AuthDeps) => Promise<void>;

/** Wraps an /auth handler: deps, no-store, CSRF header + Origin allow-list, error mapping. */
function auth(handler: Handler, opts: { cookie?: boolean } = {}): RequestHandler {
  return async (req, res, next: NextFunction) => {
    const deps = authDeps(req);
    if (!deps) {
      problem(res, 503, 'unavailable');
      return;
    }
    res.set('Cache-Control', 'no-store');
    const cookieUsed = opts.cookie === true && readCookie(req, REFRESH_COOKIE) !== undefined;
    if (!csrfOk(req, deps, cookieUsed)) {
      problem(res, 403, 'forbidden');
      return;
    }
    try {
      await handler(req, res, deps);
    } catch (err) {
      try {
        fail(res, err);
      } catch (other) {
        next(other);
      }
    }
  };
}

function body<T extends z.ZodType>(schema: T, req: Request, res: Response): z.infer<T> | null {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    problem(res, 400, 'bad_request');
    return null;
  }
  return parsed.data;
}

function sendIssued(res: Response, deps: AuthDeps, issued: Issued, web: boolean): void {
  const { refreshToken, refreshExpiresAt, refreshMaxAge, ...rest } = issued;
  if (web) {
    res.append('Set-Cookie', cookie(deps, refreshToken, refreshMaxAge));
    res.status(200).json(rest);
  } else {
    // Native shells keep it in the OS secure store (phase 34).
    res
      .status(200)
      .json({ ...rest, refreshToken, refreshExpiresAt: refreshExpiresAt.toISOString() });
  }
}

// ------------------------------------------------------------------ bearer guard

/** Resolves `Authorization: Bearer` to a live session, or answers 401. */
async function principal(req: Request, res: Response, deps: AuthDeps): Promise<Principal | null> {
  const header = req.get('authorization') ?? '';
  const m = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(header);
  const p = m?.[1] ? await deps.service.authenticate(m[1]) : null;
  if (!p) {
    res.set('WWW-Authenticate', 'Bearer');
    problem(res, 401, 'unauthorized');
  }
  return p;
}

type MeHandler = (req: Request, res: Response, deps: AuthDeps, p: Principal) => Promise<void>;

function me(handler: MeHandler): RequestHandler {
  return async (req, res, next) => {
    const deps = authDeps(req);
    if (!deps) {
      problem(res, 503, 'unavailable');
      return;
    }
    res.set('Cache-Control', 'no-store');
    try {
      const p = await principal(req, res, deps);
      if (p) await handler(req, res, deps, p);
    } catch (err) {
      try {
        fail(res, err);
      } catch (other) {
        next(other);
      }
    }
  };
}

// ------------------------------------------------------------------ handlers

export const controller = {
  register: auth(async (req, res, { service }) => {
    const b = body(schemas.register, req, res);
    if (!b) return;
    await service.register(
      {
        email: b.email,
        password: b.password,
        ...(b.displayName ? { displayName: b.displayName } : {}),
        ...(b.captcha ? { captcha: b.captcha } : {}),
      },
      context(req),
    );
    res.status(202).json({ status: 'check-your-email' });
  }),

  verifyEmail: auth(async (req, res, { service }) => {
    const b = body(schemas.verifyEmail, req, res);
    if (!b) return;
    await service.verifyEmail(b.token, context(req));
    res.status(204).end();
  }),

  resendVerification: auth(async (req, res, { service }) => {
    const b = body(schemas.emailCaptcha, req, res);
    if (!b) return;
    await service.resendVerification(
      { email: b.email, ...(b.captcha ? { captcha: b.captcha } : {}) },
      context(req),
    );
    res.status(202).json({ status: 'check-your-email' });
  }),

  login: auth(async (req, res, deps) => {
    const b = body(schemas.login, req, res);
    if (!b) return;
    const issued = await deps.service.login(
      {
        email: b.email,
        password: b.password,
        platform: b.platform,
        ...(b.captcha ? { captcha: b.captcha } : {}),
      },
      context(req),
    );
    sendIssued(res, deps, issued, b.platform === 'web');
  }),

  refresh: auth(
    async (req, res, deps) => {
      const b = body(schemas.refresh, req, res);
      if (!b) return;
      const fromCookie = readCookie(req, REFRESH_COOKIE);
      const token = fromCookie ?? b.refreshToken;
      if (!token) {
        problem(res, 401, 'unauthorized');
        return;
      }
      try {
        sendIssued(
          res,
          deps,
          await deps.service.refresh(token, context(req)),
          fromCookie !== undefined,
        );
      } catch (err) {
        if (fromCookie !== undefined) res.append('Set-Cookie', cookie(deps, '', 0));
        throw err;
      }
    },
    { cookie: true },
  ),

  logout: auth(
    async (req, res, deps) => {
      const b = body(schemas.refresh, req, res);
      if (!b) return;
      await deps.service.logout(readCookie(req, REFRESH_COOKIE) ?? b.refreshToken, context(req));
      res.append('Set-Cookie', cookie(deps, '', 0));
      res.status(204).end();
    },
    { cookie: true },
  ),

  logoutAll: me(async (req, res, { service }, p) => {
    await service.logoutAll(p, context(req));
    res.status(204).end();
  }),

  forgotPassword: auth(async (req, res, { service }) => {
    const b = body(schemas.emailCaptcha, req, res);
    if (!b) return;
    await service.forgotPassword(
      { email: b.email, ...(b.captcha ? { captcha: b.captcha } : {}) },
      context(req),
    );
    res.status(202).json({ status: 'check-your-email' });
  }),

  resetPassword: auth(async (req, res, { service }) => {
    const b = body(schemas.resetPassword, req, res);
    if (!b) return;
    await service.resetPassword(b, context(req));
    res.status(204).end();
  }),

  getMe: me(async (_req, res, { service }, p) => {
    res.status(200).json(await service.me(p));
  }),

  patchMe: me(async (req, res, { service }, p) => {
    const b = body(schemas.patchMe, req, res);
    if (!b) return;
    res
      .status(200)
      .json(
        await service.updateMe(
          p,
          b.displayName === undefined ? {} : { displayName: b.displayName },
        ),
      );
  }),

  sessions: me(async (_req, res, { service }, p) => {
    res.status(200).json({ sessions: await service.sessions(p) });
  }),

  revokeSession: me(async (req, res, { service }, p) => {
    const id = schemas.sessionId.safeParse(req.params['id']);
    if (!id.success) {
      problem(res, 404, 'not_found');
      return;
    }
    await service.revokeSession(p, id.data, context(req));
    res.status(204).end();
  }),

  changePassword: me(async (req, res, { service }, p) => {
    const b = body(schemas.changePassword, req, res);
    if (!b) return;
    await service.changePassword(p, b, context(req));
    res.status(204).end();
  }),

  exportMe: me(async (_req, res, { service }, p) => {
    res.set('Content-Disposition', 'attachment; filename="mrak-account.json"');
    res.status(200).json(await service.exportData(p));
  }),

  deleteMe: me(async (req, res, deps, p) => {
    const b = body(schemas.deleteMe, req, res);
    if (!b) return;
    await deps.service.deleteAccount(p, b.password, context(req));
    res.append('Set-Cookie', cookie(deps, '', 0));
    res.status(204).end();
  }),
};
