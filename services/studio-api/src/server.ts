import { createApp, REQUEST_TIMEOUT_MS } from './app.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { sqlSales } from './sales.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const salesDb = env.SALES_DATABASE_URL
  ? new PrismaClient({
      adapter: new PrismaPg({
        connectionString: env.SALES_DATABASE_URL,
        max: 2,
        statement_timeout: 5000,
      }),
    })
  : null;
const app = createApp({
  logger,
  ...(salesDb
    ? {
        sales: sqlSales(async (text, values) => ({
          rows: await salesDb.$queryRawUnsafe<Record<string, unknown>[]>(text, ...values),
        })),
      }
    : {}),
});

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ port: env.PORT }, 'studio-api listening');
});
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = REQUEST_TIMEOUT_MS + 1_000;

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
