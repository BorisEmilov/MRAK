import { createApp, REQUEST_TIMEOUT_MS } from './app.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { resolve } from 'node:path';
import { accessVerifier } from './access.js';
import { sqlSales } from './sales.js';
import { sqlTelemetry } from './telemetry.js';
import { Studio } from './studio/content.js';
import { MemoryContentStore, PrismaContentStore } from './studio/store.js';

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
// Never public (docs/systems/studio.md → Access): production requires Cloudflare Access.
if (env.NODE_ENV === 'production' && !(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD))
  throw new Error('production needs ACCESS_TEAM_DOMAIN and ACCESS_AUD (Cloudflare Access)');
const db = env.DATABASE_URL
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 5 }) })
  : null;
// Repository formatting for exported files (development checkout); identity when absent.
const format = async (path: string, text: string): Promise<string> => {
  try {
    const prettier = await import('prettier');
    return await prettier.format(text, { ...(await prettier.resolveConfig(path)), filepath: path });
  } catch {
    return text;
  }
};
const studio = new Studio({
  store: db ? new PrismaContentStore(db) : new MemoryContentStore(),
  contentRoot: resolve(env.CONTENT_ROOT),
  exportDir: resolve(env.EXPORT_DIR),
  now: () => new Date(),
  format,
});
const app = createApp({
  logger,
  studio,
  ...(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD
    ? { access: accessVerifier(env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD) }
    : {}),
  ...(env.STUDIO_WEB_DIR ? { webDir: resolve(env.STUDIO_WEB_DIR) } : {}),
  ...(salesDb
    ? {
        sales: sqlSales(async (text, values) => ({
          rows: await salesDb.$queryRawUnsafe<Record<string, unknown>[]>(text, ...values),
        })),
        telemetry: sqlTelemetry(async (text, values) => ({
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
