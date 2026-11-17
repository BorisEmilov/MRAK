import { describe, expect, it } from 'vitest';
import { routes } from './index.js';

describe('route registry', () => {
  it.each(routes.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const))(
    '%s declares a rate limit',
    (_name, route) => {
      expect(route.rateLimit.windowMs).toBeGreaterThan(0);
      expect(route.rateLimit.limit).toBeGreaterThan(0);
    },
  );

  it('has no duplicate method+path pairs', () => {
    const keys = routes.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
