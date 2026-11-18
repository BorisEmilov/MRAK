import express, { type Request, type RequestHandler, type Response, type Router } from 'express';
import type { z } from 'zod';
import type { Limiter } from '../limits/limiter.js';
import type { Policies, PolicyName } from '../limits/policies.js';
import type { SwitchName, Switches } from '../limits/switches.js';
import { problem } from '../middleware/problem.js';

/** Default JSON body limit (threat model C-20); cloud saves declare a larger one. */
export const DEFAULT_BODY_LIMIT = 16 * 1024;
/** Largest body any route accepts; anything bigger is refused before parsing. */
export const MAX_BODY_LIMIT = 2 * 1024 * 1024;

/** OpenAPI facts of a route (the spec is generated from these: `pnpm openapi`). */
export interface RouteDoc {
  summary: string;
  tag: string;
  /** Needs `Authorization: Bearer <access token>`. */
  bearer?: boolean;
  /** Reads the refresh cookie (and needs the CSRF header). */
  cookie?: boolean;
  /** Needs the `X-MRAK-CSRF: 1` header. */
  csrf?: boolean;
  body?: z.ZodType;
  responses: Record<number, { description: string; schema?: z.ZodType }>;
}

export interface RouteDefinition {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  /** Mandatory: the rate-limit policies this route consumes (enforced by tests). */
  rateLimit: readonly PolicyName[];
  /** JSON body limit in bytes (default 16 KB, max 2 MB). */
  bodyLimit?: number;
  /** Keep the exact request bytes in `req.rawBody` (signed webhooks). */
  rawBody?: boolean;
  /** Emergency switch that turns this route off (503) without a deploy. */
  feature?: SwitchName;
  handler: RequestHandler;
  doc: RouteDoc;
}

export function defineRoute(route: RouteDefinition): RouteDefinition {
  if (route.rateLimit.length === 0) throw new Error(`${route.path}: no rate limit`);
  if ((route.bodyLimit ?? 0) > MAX_BODY_LIMIT)
    throw new Error(`${route.path}: body limit too large`);
  return route;
}

/** What the limit middleware needs (app.locals['limits']). */
export interface LimitDeps {
  limiter: Limiter;
  policies: Policies;
  switches: Switches;
  /** Hashes identifiers (IPs, emails) before they become keys. */
  hash: (value: string) => string;
  /** The verified `sub` of a bearer token (signature only), or null. */
  userOf: (req: Request) => Promise<string | null>;
}

function emailOf(req: Request): string | null {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null;
}

/** Key for a policy; null when the request has no such identity (then the IP is used). */
async function keyFor(req: Request, kind: string, deps: LimitDeps): Promise<string> {
  const ip = `ip:${deps.hash(req.ip ?? '0.0.0.0')}`;
  switch (kind) {
    case 'ip+email': {
      const email = emailOf(req);
      return email ? `${ip}:em:${deps.hash(email)}` : ip;
    }
    case 'email': {
      const email = emailOf(req);
      return email ? `em:${deps.hash(email)}` : ip;
    }
    case 'user': {
      const user = await deps.userOf(req);
      return user ? `u:${user}` : ip;
    }
    case 'install': {
      const install = req.get('x-mrak-install');
      return install && /^[\w-]{8,64}$/.test(install) ? `in:${install}` : ip;
    }
    default:
      return ip;
  }
}

function header(name: string, value: string | number): string {
  return `"${name}";${String(value)}`;
}

/** Switch, then every policy of the route; 503/429 as RFC 9457 problems with RateLimit headers. */
function guard(route: RouteDefinition): RequestHandler {
  return async (req: Request, res: Response, next) => {
    const deps = req.app.locals['limits'] as LimitDeps;
    try {
      if (route.feature && !(await deps.switches.enabled(route.feature))) {
        res.set('Retry-After', '300');
        problem(res, 503, 'feature_disabled', { feature: route.feature });
        return;
      }
      let tightest: { name: PolicyName; remaining: number; resetMs: number } | null = null;
      for (const name of route.rateLimit) {
        const policy = deps.policies[name];
        const key = `${name}:${await keyFor(req, policy.key, deps)}`;
        const d = await deps.limiter.consume(key, policy);
        res.append(
          'RateLimit-Policy',
          `${header(name, `q=${String(policy.limit)}`)};w=${String(policy.windowMs / 1000)}`,
        );
        if (d.unavailable) {
          res.set('Retry-After', String(Math.ceil(d.retryAfterMs / 1000)));
          problem(res, 503, 'unavailable');
          return;
        }
        if (!d.allowed) {
          res.set('Retry-After', String(Math.ceil(d.retryAfterMs / 1000)));
          res.set(
            'RateLimit',
            `${header(name, 'r=0')};t=${String(Math.ceil(d.retryAfterMs / 1000))}`,
          );
          problem(res, 429, 'too_many_requests', { policy: name });
          return;
        }
        if (!tightest || d.remaining < tightest.remaining)
          tightest = { name, remaining: d.remaining, resetMs: d.resetMs };
      }
      if (tightest)
        res.set(
          'RateLimit',
          `${header(tightest.name, `r=${String(tightest.remaining)}`)};t=${String(Math.ceil(tightest.resetMs / 1000))}`,
        );
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Mounts each route: body parser with its own limit (no inflation), switch + limits, handler. */
export function mountRoutes(router: Router, routes: readonly RouteDefinition[]): void {
  for (const route of routes) {
    const json = express.json({
      limit: route.bodyLimit ?? DEFAULT_BODY_LIMIT,
      inflate: false,
      ...(route.rawBody
        ? {
            verify: (req: Request, _res: Response, buf: Buffer) => {
              (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
            },
          }
        : {}),
    });
    router[route.method](route.path, json, guard(route), route.handler);
  }
}
