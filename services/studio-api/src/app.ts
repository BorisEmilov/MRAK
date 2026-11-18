import express, { Router, type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { requestTimeout } from './middleware/timeout.js';
import { mountRoutes } from './routes/defineRoute.js';
import { routes } from './routes/index.js';
import type { SalesSource } from './sales.js';

export const BODY_LIMIT = '16kb';
export const REQUEST_TIMEOUT_MS = 10_000;

export interface AppOptions {
  logger?: Logger;
  /** Sales panel data from the online database (restricted role). */
  sales?: SalesSource;
}

export function createApp(options: AppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals['sales'] = options.sales;

  if (options.logger) {
    app.use(pinoHttp({ logger: options.logger }));
  }
  app.use(helmet());
  app.use(requestTimeout(REQUEST_TIMEOUT_MS));
  app.use(express.json({ limit: BODY_LIMIT }));

  const router = Router();
  mountRoutes(router, routes);
  app.use(router);

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
