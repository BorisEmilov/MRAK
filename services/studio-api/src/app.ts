import express, { Router, type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { accessGuard, type AccessVerifier } from './access.js';
import { requestTimeout } from './middleware/timeout.js';
import { mountRoutes } from './routes/defineRoute.js';
import { routes } from './routes/index.js';
import type { SalesSource } from './sales.js';
import type { TelemetrySource } from './telemetry.js';
import type { Studio } from './studio/content.js';

/** Content entries (whole registry ~40 KB, big trees) — internal tool. */
export const BODY_LIMIT = '1mb';
export const REQUEST_TIMEOUT_MS = 10_000;

export interface AppOptions {
  logger?: Logger;
  /** Sales panel data from the online database (restricted role). */
  sales?: SalesSource;
  /** Telemetry rows (online database `telemetry.events`). */
  telemetry?: TelemetrySource;
  /** Content editor (docs/systems/studio.md). */
  studio?: Studio;
  /** Cloudflare Access verifier (required in production); without it only local peers. */
  access?: AccessVerifier;
  /** Override of the local-peer rule (tests). */
  allowPeer?: (address: string | undefined) => boolean;
  /** Built apps/studio-web, served at / (same origin as the API). */
  webDir?: string;
}

export function createApp(options: AppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals['sales'] = options.sales;
  app.locals['telemetry'] = options.telemetry;
  app.locals['studio'] = options.studio;

  if (options.logger) {
    app.use(pinoHttp({ logger: options.logger }));
  }
  app.use(helmet());
  app.use(
    accessGuard({
      ...(options.access ? { verify: options.access } : {}),
      ...(options.allowPeer ? { allowPeer: options.allowPeer } : {}),
    }),
  );
  app.use(requestTimeout(REQUEST_TIMEOUT_MS));
  app.use(express.json({ limit: BODY_LIMIT }));

  const router = Router();
  mountRoutes(router, routes);
  app.use(router);
  if (options.webDir) app.use(express.static(options.webDir, { index: 'index.html' }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    const status =
      typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
        ? err.status
        : 500;
    options.logger?.error({ err }, 'request failed');
    res.status(status).json({ error: status >= 500 ? 'internal_error' : 'bad_request' });
  };
  app.use(onError);

  return app;
}
