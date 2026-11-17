import cors from 'cors';
import express, { Router, type ErrorRequestHandler } from 'express';
import type { Store } from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Auth } from './auth/setup.js';
import { problem } from './middleware/problem.js';
import { requestTimeout } from './middleware/timeout.js';
import { mountRoutes } from './routes/defineRoute.js';
import { routes } from './routes/index.js';
import type { Catalog } from './progress/catalog.js';
import type { ProgressStore } from './progress/store.js';
import type { Authenticate } from './routes/progress.js';

export const BODY_LIMIT = '16kb';
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
  /** Account progress storage (achievements, Bloodline, stats). */
  progress?: ProgressStore;
  /** Content ids the server accepts (achievements, Bloodline nodes) and their tier. */
  catalog?: Catalog;
  /** Account service; its bearer authenticator also guards account progress. */
  auth?: Auth;
  /** Exact browser origins allowed by CORS (credentials only on /v1/auth). */
  corsOrigins?: readonly string[];
  /** Shared rate-limit store (Redis) per route prefix. */
  rateLimitStore?: (prefix: string) => Store;
}

export function createApp(options: AppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals['now'] = options.now ?? (() => new Date());
  app.locals['authenticate'] = options.authenticate ?? options.auth?.authenticate;
  app.locals['auth'] = options.auth?.deps;
  app.locals['jwks'] = options.auth?.jwks;
  app.locals['progress'] = options.progress;
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
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-MRAK-CSRF'],
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
  app.use(express.json({ limit: BODY_LIMIT, inflate: false }));

  const router = Router();
  mountRoutes(router, routes, options.rateLimitStore);
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
