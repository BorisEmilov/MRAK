import type { RequestHandler, Router } from 'express';
import { rateLimit } from 'express-rate-limit';

export interface RateLimitPolicy {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests per client per window. */
  limit: number;
}

export interface RouteDefinition {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  /** Mandatory: every endpoint declares its rate limit (enforced by tests). */
  rateLimit: RateLimitPolicy;
  handler: RequestHandler;
}

export function defineRoute(route: RouteDefinition): RouteDefinition {
  return route;
}

export function mountRoutes(router: Router, routes: readonly RouteDefinition[]): void {
  for (const route of routes) {
    const limiter = rateLimit({
      windowMs: route.rateLimit.windowMs,
      limit: route.rateLimit.limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    });
    router[route.method](route.path, limiter, route.handler);
  }
}
