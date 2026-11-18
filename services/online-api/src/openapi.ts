/**
 * OpenAPI 3.1 generated from the route registry (`doc` of every defineRoute). Run `pnpm openapi`
 * after changing a route; `openapi.test.ts` fails when openapi.json is stale.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { routes } from './routes/index.js';
import { CSRF_HEADER, REFRESH_COOKIE } from './auth/controller.js';
import type { RouteDefinition } from './routes/defineRoute.js';
import { DEFAULT_POLICIES } from './limits/policies.js';

const schema = (s: z.ZodType) =>
  z.toJSONSchema(s, { io: 'input', unrepresentable: 'any', target: 'draft-2020-12' });

export function buildOpenApi(defs: readonly RouteDefinition[] = routes): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of defs) {
    const path = r.path.replace(/:(\w+)/g, '{$1}');
    const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const d = r.doc;
    paths[path] ??= {};
    paths[path][r.method] = {
      tags: [d.tag],
      summary: d.summary,
      'x-rate-limit': r.rateLimit.map((name) => ({ policy: name, ...DEFAULT_POLICIES[name] })),
      ...(r.feature ? { 'x-kill-switch': r.feature } : {}),
      ...(d.bearer ? { security: [{ bearer: [] }] } : {}),
      parameters: [
        ...params,
        ...(d.csrf
          ? [{ name: CSRF_HEADER, in: 'header', required: true, schema: { const: '1' } }]
          : []),
        ...(d.cookie
          ? [{ name: REFRESH_COOKIE, in: 'cookie', required: false, schema: { type: 'string' } }]
          : []),
      ],
      ...(d.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: schema(d.body) } },
            },
          }
        : {}),
      responses: Object.fromEntries(
        Object.entries(d.responses).map(([status, res]) => [
          status,
          {
            description: res.description,
            ...(Number(status) === 429 || Number(status) === 503
              ? { headers: { 'Retry-After': { schema: { type: 'integer' } } } }
              : {}),
            ...(res.schema
              ? { content: { 'application/json': { schema: schema(res.schema) } } }
              : Number(status) >= 400
                ? {
                    content: {
                      'application/problem+json': {
                        schema: { $ref: '#/components/schemas/Problem' },
                      },
                    },
                  }
                : {}),
          },
        ]),
      ),
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'MRAK online API',
      version: '0.2.0',
      description:
        'Generated from services/online-api/src/routes (do not edit). Errors are RFC 9457 problems.',
    },
    paths,
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT (EdDSA, 10 min)' },
      },
      schemas: {
        Problem: {
          type: 'object',
          required: ['type', 'title', 'status', 'error'],
          properties: {
            type: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'integer' },
            error: { type: 'string' },
            captcha: { type: 'boolean' },
          },
        },
      },
    },
  };
}

export const OPENAPI_FILE = fileURLToPath(new URL('../openapi.json', import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repo path (generator)
  writeFileSync(OPENAPI_FILE, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
  console.info(`wrote ${OPENAPI_FILE}`);
}
