import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import { createApp, REQUEST_TIMEOUT_MS } from './app.js';
import { MemoryCounters, RedisCounters, turnstile } from './auth/guards.js';
import { generateSigningJwk } from './auth/keys.js';
import { MemoryMailer } from './auth/mailer.js';
import { hibpCheck } from './auth/passwords.js';
import { PrismaAuthRepository } from './auth/prisma-repository.js';
import { MemoryAuthRepository } from './auth/repository.js';
import { buildAuth } from './auth/setup.js';
import { loadEnv } from './env.js';
import { PrismaClient } from './generated/prisma/client.js';
import { createLogger } from './logger.js';
import { loadCatalog } from './progress/catalog.js';
import { PrismaProgressStore } from './progress/prisma-store.js';
import { MemoryProgressStore } from './progress/store.js';

/** Cloudflare's documented always-pass test secret: development only. */
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const production = env.NODE_ENV === 'production';
if (
  production &&
  (!env.AUTH_JWT_KEYS ||
    !env.AUTH_SECRET ||
    !env.TURNSTILE_SECRET ||
    !env.REDIS_URL ||
    !env.DATABASE_URL)
)
  throw new Error(
    'production needs AUTH_JWT_KEYS, AUTH_SECRET, TURNSTILE_SECRET, REDIS_URL and DATABASE_URL',
  );

const prisma = env.DATABASE_URL
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) })
  : null;
const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { commandTimeout: 1000 }) : null;
const progress = prisma ? new PrismaProgressStore(prisma) : new MemoryProgressStore();
const csv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const auth = await buildAuth({
  repo: prisma ? new PrismaAuthRepository(prisma) : new MemoryAuthRepository(),
  counters: redis ? new RedisCounters(redis) : new MemoryCounters(),
  // TODO(email provider): a real mailer; until then mails are kept in memory, never logged.
  mailer: new MemoryMailer(),
  jwtKeys: env.AUTH_JWT_KEYS ?? JSON.stringify([await generateSigningJwk('dev')]),
  issuer: env.AUTH_ISSUER,
  audience: env.AUTH_AUDIENCE,
  appUrl: env.APP_URL,
  secret: env.AUTH_SECRET ?? 'development-only-secret-not-for-production!!',
  http: { allowedOrigins: csv(env.CORS_ORIGINS), cookieDomain: env.COOKIE_DOMAIN },
  human: turnstile(env.TURNSTILE_SECRET ?? TURNSTILE_TEST_SECRET, csv(env.TURNSTILE_HOSTNAMES)),
  ...(env.HIBP_ENABLED === 'true' ? { pwned: hibpCheck() } : {}),
  hooks: [
    {
      name: 'progress',
      export: (userId) => progress.list(userId),
      erase: (userId) => progress.remove(userId),
    },
  ],
});

const app = createApp({
  logger,
  catalog: loadCatalog(env.CONTENT_DATA_DIR),
  progress,
  auth,
  corsOrigins: csv(env.CORS_ORIGINS),
  ...(redis
    ? {
        rateLimitStore: (prefix: string) =>
          new RedisStore({
            prefix,
            sendCommand: (command: string, ...args: string[]) =>
              redis.call(command, ...args) as Promise<number>,
          }),
      }
    : {}),
});

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ port: env.PORT }, 'online-api listening');
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
