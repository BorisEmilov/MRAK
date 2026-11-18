import { describe, expect, it } from 'vitest';
import { buildOpenApi } from '../openapi.js';
import { DEFAULT_POLICIES } from '../limits/policies.js';
import { defineRoute } from './defineRoute.js';
import { routes } from './index.js';

interface Op {
  'x-rate-limit'?: { policy: string; limit: number; windowMs: number; key: string }[];
}

describe('route registry', () => {
  it('every endpoint of the OpenAPI spec declares at least one rate limit', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, Op>> };
    const ops = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, op]) => ({ name: `${method} ${path}`, op })),
    );
    expect(ops.length).toBe(routes.length);
    for (const { name, op } of ops) {
      const limits = op['x-rate-limit'] ?? [];
      expect(limits.length, name).toBeGreaterThan(0);
      for (const l of limits) {
        expect(l.policy in DEFAULT_POLICIES, `${name}: ${l.policy}`).toBe(true);
        expect(l.limit, name).toBeGreaterThan(0);
        expect(l.windowMs, name).toBeGreaterThan(0);
      }
    }
  });

  it('refuses a route without limits or with a body limit over 2 MB', () => {
    const base = {
      method: 'get' as const,
      path: '/x',
      handler: () => undefined,
      doc: { summary: '', tag: '', responses: {} },
    };
    expect(() => defineRoute({ ...base, rateLimit: [] })).toThrow();
    expect(() =>
      defineRoute({ ...base, rateLimit: ['public-ip'], bodyLimit: 3 * 1024 * 1024 }),
    ).toThrow();
  });

  it('signed-in routes are limited per user; auth routes fail closed', () => {
    for (const r of routes) {
      if (r.doc.bearer) expect(r.rateLimit, r.path).toContain('authed-user');
      if (r.path.startsWith('/v1/auth/') && !r.doc.bearer)
        expect(
          r.rateLimit.every((p) => DEFAULT_POLICIES[p].failClosed),
          r.path,
        ).toBe(true);
    }
  });

  it('has no duplicate method+path pairs', () => {
    const keys = routes.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
