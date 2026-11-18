import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import cors from 'cors';
import express, { Router, type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Auth } from './auth/setup.js';
import { problem } from './middleware/problem.js';
import { requestTimeout } from './middleware/timeout.js';
import { createHmac } from 'node:crypto';
import { MemoryLimiter, type Limiter } from './limits/limiter.js';
import { loadPolicies, type Policies } from './limits/policies.js';
import { StaticSwitches, type Switches } from './limits/switches.js';
import { MAX_BODY_LIMIT, mountRoutes, type LimitDeps } from './routes/defineRoute.js';
import { routes } from './routes/index.js';
import type { Catalog } from './progress/catalog.js';
import type { ProgressStore } from './progress/store.js';
import type { SavesStore } from './saves/store.js';
import type { Newsletter } from './newsletter/newsletter.js';
import type { Authenticate } from './routes/progress.js';

import type { LocalSigner, Store } from './store/store.js';
export const REQUEST_TIMEOUT_MS = 10_000;

export interface AppOptions {
  logger?: Logger;
  /** Server clock (tests move it to check seasonal windows). */
  now?: () => Date;
  /**
   * Resolves the signed-in account of a request. Accounts do not exist yet: without it every
   * account endpoint answers 401. Never a header or query switch — only code can provide it.
   */
  authenticate?: Authenticate;
  /** Store: checkout, payment webhooks, entitlements, signed full-pack URLs. */
  store?: Store;
  /** Development/E2E only: serves LocalSigner URLs (GET /v1/content/files/:name). */
  localContent?: { signer: LocalSigner; read: (name: string) => Buffer | null; now: () => Date };
  /** Newsletter (double opt-in). */
  newsletter?: Newsletter;
  /** Cloud saves storage. */
  saves?: SavesStore;
  /** Account progress storage (achievements, Bloodline, stats). */
  progress?: ProgressStore;
  /** Content ids the server accepts (achievements, Bloodline nodes) and their tier. */
  catalog?: Catalog;
  /** Account service; its bearer authenticator also guards account progress. */
  auth?: Auth;
  /** Exact browser origins allowed by CORS (credentials only on /v1/auth). */
  corsOrigins?: readonly string[];
  /** Cloud project id: request logs carry the Cloud Trace id for log/trace correlation. */
  traceProject?: string;
  /** Rate limiter (Redis with memory fallback in production; memory by default — never none). */
  limiter?: Limiter;
  policies?: Policies;
  /** Emergency switches (Redis-backed in production). */
  switches?: Switches;
  /** Secret for hashing IPs/emails into limiter keys. */
  keySecret?: string;
  /**
   * Edge secret (ADR 0011): only requests carrying it in `x-mrak-edge` (set by Cloudflare) are
   * served, and only then is `CF-Connecting-IP` trusted as the client IP. `/health` stays open for
   * the platform's probes. Unset in development.
   */
  edgeSecret?: string;
}

export function createApp(options: AppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  if (options.edgeSecret) {
    const want = createHash('sha256').update(options.edgeSecret).digest();
    app.use((req, res, next) => {
      const got = createHash('sha256')
        .update(req.get('x-mrak-edge') ?? '')
        .digest();
      if (!timingSafeEqual(got, want)) {
        if (req.method === 'GET' && req.path === '/health') {
          next();
          return;
        }
        problem(res, 403, 'forbidden');
        return;
      }
      const ip = req.get('cf-connecting-ip');
      if (ip && isIP(ip)) Object.defineProperty(req, 'ip', { value: ip });
      next();
    });
  }
  app.locals['now'] = options.now ?? (() => new Date());
  app.locals['authenticate'] = options.authenticate ?? options.auth?.authenticate;
  app.locals['auth'] = options.auth?.deps;
  app.locals['jwks'] = options.auth?.jwks;
  const keySecret = options.keySecret ?? 'limiter-keys';
  const limits: LimitDeps = {
    limiter: options.limiter ?? new MemoryLimiter(() => (options.now?.() ?? new Date()).getTime()),
    policies: options.policies ?? loadPolicies(),
    switches: options.switches ?? new StaticSwitches(),
    hash: (v) => createHmac('sha256', keySecret).update(v).digest('hex').slice(0, 32),
    userOf: options.auth?.userOf ?? (() => Promise.resolve(null)),
  };
  app.locals['limits'] = limits;
  app.locals['progress'] = options.progress;
  app.locals['saves'] = options.saves;
  app.locals['newsletter'] = options.newsletter;
  app.locals['store'] = options.store;
  app.locals['localContent'] = options.localContent;
  app.locals['catalog'] = options.catalog;

  if (options.logger) {
    // No IPs, user agents, cookies or query strings in request logs (no PII).
    app.use(
      pinoHttp({
        logger: options.logger,
        serializers: {
          req: (req: { id: unknown; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            path: req.url.split('?')[0],
          }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        customProps: (req) => {
          const trace = /^([0-9a-f]{32})/.exec(String(req.headers['x-cloud-trace-context'] ?? ''));
          return options.traceProject && trace?.[1]
            ? {
                'logging.googleapis.com/trace': `projects/${options.traceProject}/traces/${trace[1]}`,
              }
            : {};
        },
      }),
    );
  }
  app.use(helmet());
  const origins = new Set(options.corsOrigins ?? []);
  const corsFor = (credentials: boolean) =>
    cors({
      origin: (origin, done) => {
        done(null, origin !== undefined && origins.has(origin));
      },
      credentials,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-MRAK-CSRF',
        'X-MRAK-Install',
        'If-Match',
        'If-None-Match',
      ],
      exposedHeaders: ['ETag', 'Retry-After', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
    });
  app.use('/v1/auth', corsFor(true));
  app.use(corsFor(false));
  app.use(requestTimeout(REQUEST_TIMEOUT_MS));
  // Compressed request bodies are refused (no decompression bombs, threat model C-21).
  app.use((req, res, next) => {
    const encoding = req.get('content-encoding');
    if (encoding !== undefined && encoding !== 'identity') {
      problem(res, 415, 'unsupported_media_type');
      return;
    }
    next();
  });
  // Bodies over the largest route limit are refused before any parsing (per-route limits follow).
  app.use((req, res, next) => {
    if (Number(req.get('content-length') ?? 0) > MAX_BODY_LIMIT) {
      res.set('Connection', 'close');
      problem(res, 413, 'payload_too_large');
      return;
    }
    next();
  });

  const router = Router();
  mountRoutes(router, routes);
  app.use(router);

  app.use((_req, res) => {
    problem(res, 404, 'not_found');
  });

  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    const status =
      typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
        ? err.status
        : 500;
    if (status >= 500) options.logger?.error({ err }, 'request failed');
    if (status === 413) problem(res, 413, 'payload_too_large');
    else if (status === 415) problem(res, 415, 'unsupported_media_type');
    else if (status >= 500) problem(res, 500, 'internal_error');
    else problem(res, status, 'bad_request');
  };
  app.use(onError);

  return app;
}
