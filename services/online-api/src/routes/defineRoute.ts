import type { RequestHandler, Router } from 'express';
import { rateLimit, type Store } from 'express-rate-limit';
import type { z } from 'zod';
import { problem } from '../middleware/problem.js';

export interface RateLimitPolicy {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests per client per window. */
  limit: number;
}

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
  /** Mandatory: every endpoint declares its rate limit (enforced by tests). */
  rateLimit: RateLimitPolicy;
  handler: RequestHandler;
  doc: RouteDoc;
}

export function defineRoute(route: RouteDefinition): RouteDefinition {
  return route;
}

/**
 * Mounts every route behind its own limiter. `store` (Redis in production) shares counters across
 * instances; each route gets its own key prefix.
 */
export function mountRoutes(
  router: Router,
  routes: readonly RouteDefinition[],
  store?: (prefix: string) => Store,
): void {
  for (const route of routes) {
    const limiter = rateLimit({
      windowMs: route.rateLimit.windowMs,
      limit: route.rateLimit.limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      ...(store ? { store: store(`rl:${route.method}:${route.path}:`) } : {}),
      handler: (_req, res) => {
        problem(res, 429, 'too_many_requests');
      },
    });
    router[route.method](route.path, limiter, route.handler);
  }
}
