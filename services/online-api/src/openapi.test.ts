import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOpenApi, OPENAPI_FILE } from './openapi.js';
import { routes } from './routes/index.js';

describe('OpenAPI', () => {
  it('openapi.json is generated from the routes and up to date (run `pnpm openapi`)', () => {
    const committed = JSON.parse(readFileSync(OPENAPI_FILE, 'utf8')) as unknown;
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApi())));
  });

  it('documents every route with its rate limit', () => {
    const spec = buildOpenApi() as {
      paths: Record<string, Record<string, { 'x-rate-limit': unknown }>>;
    };
    for (const r of routes) {
      const op = spec.paths[r.path.replace(/:(\w+)/g, '{$1}')]?.[r.method];
      expect(op?.['x-rate-limit'], `${r.method} ${r.path}`).toEqual(r.rateLimit);
    }
  });

  it('every path the typed client (packages/api-client) calls exists in the spec', () => {
    const client = readFileSync(
      new URL('../../../packages/api-client/src/index.ts', import.meta.url),
      'utf8',
    );
    const used = [...client.matchAll(/[`'](\/v1\/[\w/-]+)/g)].map((m) => m[1] ?? '');
    const spec = buildOpenApi() as { paths: Record<string, unknown> };
    const known = Object.keys(spec.paths).map((p) => p.replace(/\{\w+\}/g, ''));
    expect(used.length).toBeGreaterThan(10);
    for (const path of used)
      expect(
        known.some((k) => k.startsWith(path)),
        path,
      ).toBe(true);
  });
});
