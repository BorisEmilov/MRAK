import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ipHasher } from './auth/guards.js';
import { presignGet } from './content/presign.js';
import { PaddleProvider } from './store/paddle.js';
import { PrismaStoreRepo } from './store/prisma-store.js';
import { LocalSigner, MemoryStoreRepo, Store } from './store/store.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { createApp, REQUEST_TIMEOUT_MS } from './app.js';
import { MemoryCounters, RedisCounters, turnstile, type HumanCheck } from './auth/guards.js';
import { generateSigningJwk } from './auth/keys.js';
import { BudgetedMailer, FileMailer, MemoryMailer } from './auth/mailer.js';
import { MemoryNewsletterStore, Newsletter } from './newsletter/newsletter.js';
import { PrismaNewsletterStore } from './newsletter/prisma-store.js';
import { hibpCheck } from './auth/passwords.js';
import { PrismaAuthRepository } from './auth/prisma-repository.js';
import { MemoryAuthRepository } from './auth/repository.js';
import { buildAuth } from './auth/setup.js';
import { loadEnv } from './env.js';
import { PrismaClient } from './generated/prisma/client.js';
import { MemoryLimiter, RedisLimiter, ResilientLimiter } from './limits/limiter.js';
import { loadPolicies } from './limits/policies.js';
import { parseDisabled, RedisSwitches, StaticSwitches } from './limits/switches.js';
import { createLogger } from './logger.js';
import { loadCatalog } from './progress/catalog.js';
import { PrismaProgressStore } from './progress/prisma-store.js';
import { MemoryProgressStore } from './progress/store.js';
import { PrismaSavesStore } from './saves/prisma-store.js';
import { MemorySavesStore } from './saves/store.js';

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
    !env.DATABASE_URL ||
    !env.EDGE_SECRET)
)
  throw new Error(
    'production needs AUTH_JWT_KEYS, AUTH_SECRET, TURNSTILE_SECRET, REDIS_URL, DATABASE_URL and EDGE_SECRET',
  );

// Bounded pool and per-statement timeout: abuse cannot pile up queries (threat model C-24).
const prisma = env.DATABASE_URL
  ? new PrismaClient({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: env.DB_POOL_MAX,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 30_000,
        statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
        query_timeout: env.DB_STATEMENT_TIMEOUT_MS + 1000,
      }),
    })
  : null;
const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      commandTimeout: 500,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      ...(env.REDIS_CA_CERT ? { tls: { ca: env.REDIS_CA_CERT } } : {}),
    })
  : null;
redis?.on('error', (err: Error) => {
  logger.warn({ alert: 'redis-error', err: err.message }, 'redis unavailable');
});

const progress = prisma ? new PrismaProgressStore(prisma) : new MemoryProgressStore();
const saves = prisma ? new PrismaSavesStore(prisma) : new MemorySavesStore();
const csv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const policies = loadPolicies(env.RATE_LIMITS);
const limiter = new ResilientLimiter(
  redis ? new RedisLimiter(redis) : null,
  new MemoryLimiter(),
  () => {
    logger.warn({ alert: 'rate-limit-degraded' }, 'redis down: auth fails closed, rest in memory');
  },
);
const disabled = parseDisabled(env.KILL_SWITCHES);
const switches = redis ? new RedisSwitches(redis, disabled) : new StaticSwitches(disabled);
const counters = redis ? new RedisCounters(redis) : new MemoryCounters();
if (production && (env.MAIL_OUTBOX_DIR || env.TURNSTILE_TEST_BYPASS === 'true'))
  throw new Error('MAIL_OUTBOX_DIR and TURNSTILE_TEST_BYPASS are for development only');
// TODO(email provider): replace the inner mailer; budget and switch already apply.
const deliveryMailer = env.MAIL_OUTBOX_DIR
  ? new FileMailer(env.MAIL_OUTBOX_DIR)
  : new MemoryMailer();
const mailer = new BudgetedMailer(
  {
    async send(mail) {
      await deliveryMailer.send(mail);
      logger.info({ evt: 'email', kind: mail.kind });
    },
  },
  counters,
  env.EMAIL_DAILY_CAP,
  () => switches.enabled('emails'),
  (e) => {
    logger.warn({ alert: 'email-budget', ...e }, `email budget at ${String(e.level)} %`);
  },
);
const human: HumanCheck =
  env.TURNSTILE_TEST_BYPASS === 'true'
    ? () => Promise.resolve(true)
    : turnstile(env.TURNSTILE_SECRET ?? TURNSTILE_TEST_SECRET, csv(env.TURNSTILE_HOSTNAMES));
const newsletter = new Newsletter({
  store: prisma ? new PrismaNewsletterStore(prisma) : new MemoryNewsletterStore(),
  mailer,
  human,
  counters,
  secret: env.AUTH_SECRET ?? 'development-only-secret-not-for-production!!',
  siteUrl: env.SITE_URL,
  now: () => new Date(),
});

const authRepo = prisma ? new PrismaAuthRepository(prisma) : new MemoryAuthRepository();
// Every audit row is also a metric event (login failures, refresh reuse, purchases, webhooks…):
// action and result only — no account id, no IP hash (docs/runbooks/deploy.md → Observability).
const repoAudit = authRepo.audit.bind(authRepo);
authRepo.audit = async (row) => {
  await repoAudit(row);
  logger.info({ evt: 'audit', action: row.action, result: row.result });
};
const secret = env.AUTH_SECRET ?? 'development-only-secret-not-for-production!!';
if (production && env.FULL_PACK_LOCAL_DIR)
  throw new Error('FULL_PACK_LOCAL_DIR is for development only');
const fullPack =
  env.FULL_PACK_PATH && env.FULL_PACK_VERSION && env.FULL_PACK_SHA256 && env.FULL_PACK_BYTES
    ? {
        path: env.FULL_PACK_PATH,
        version: env.FULL_PACK_VERSION,
        sha256: env.FULL_PACK_SHA256,
        bytes: env.FULL_PACK_BYTES,
      }
    : null;
const localSigner = env.FULL_PACK_LOCAL_DIR ? new LocalSigner(secret, env.API_URL) : null;
const r2 =
  env.R2_HOST && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
    ? {
        host: env.R2_HOST,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      }
    : null;
const hashIpNow = ipHasher(secret);
const store = new Store({
  repo: prisma ? new PrismaStoreRepo(prisma) : new MemoryStoreRepo(),
  provider:
    env.PADDLE_API_KEY && env.PADDLE_WEBHOOK_SECRET
      ? new PaddleProvider({
          apiKey: env.PADDLE_API_KEY,
          webhookSecret: env.PADDLE_WEBHOOK_SECRET,
          apiUrl: env.PADDLE_API_URL,
          checkoutUrl: `${env.SITE_URL}/buy/checkout/`,
        })
      : null,
  prices: {
    ...(env.PADDLE_PRICE_FULL_GAME ? { 'full-game': env.PADDLE_PRICE_FULL_GAME } : {}),
    ...(env.PADDLE_PRICE_COLLECTOR ? { collector: env.PADDLE_PRICE_COLLECTOR } : {}),
  },
  signer:
    localSigner ??
    (r2
      ? {
          sign: (path, seconds, now) =>
            presignGet({ ...r2, path, region: 'auto', now, expiresSeconds: seconds }),
        }
      : null),
  fullPack,
  audit: (row) => authRepo.audit(row),
  hashIp: (ip) => hashIpNow(ip, new Date()),
  userExists: async (id) => (await authRepo.userById(id)) !== null,
  now: () => new Date(),
});

const auth = await buildAuth({
  repo: authRepo,
  entitlements: (userId) => store.activeSkus(userId),
  counters,
  mailer,
  jwtKeys: env.AUTH_JWT_KEYS ?? JSON.stringify([await generateSigningJwk('dev')]),
  issuer: env.AUTH_ISSUER,
  audience: env.AUTH_AUDIENCE,
  appUrl: env.APP_URL,
  secret: env.AUTH_SECRET ?? 'development-only-secret-not-for-production!!',
  http: { allowedOrigins: csv(env.CORS_ORIGINS), cookieDomain: env.COOKIE_DOMAIN },
  human,
  ...(env.HIBP_ENABLED === 'true' ? { pwned: hibpCheck() } : {}),
  hooks: [
    {
      name: 'progress',
      export: (userId) => progress.list(userId),
      erase: (userId) => progress.remove(userId),
    },
    {
      name: 'saves',
      // GDPR export: every cloud save with its data.
      export: async (userId) =>
        Promise.all(
          (await saves.list(userId)).map(async (s) => ({
            ...s,
            data: (await saves.get(userId, s.slot, s.version))?.data ?? null,
          })),
        ),
      erase: (userId) => saves.removeAll(userId),
    },
    {
      name: 'purchases',
      // Entitlement rows stay (order reconciliation with the merchant of record); names go.
      export: (userId) => store.entitlements(userId),
      erase: (userId) => store.eraseUser(userId),
    },
  ],
  limits: { limiter, policies },
});

const app = createApp({
  logger,
  catalog: loadCatalog(env.CONTENT_DATA_DIR),
  progress,
  saves,
  newsletter,
  store,
  ...(localSigner && env.FULL_PACK_LOCAL_DIR
    ? {
        localContent: {
          signer: localSigner,
          read: (name: string) => {
            try {
              // eslint-disable-next-line security/detect-non-literal-fs-filename -- dev-only dir; name regex-checked and basename()d
              return readFileSync(join(env.FULL_PACK_LOCAL_DIR ?? '', basename(name)));
            } catch {
              return null;
            }
          },
          now: () => new Date(),
        },
      }
    : {}),
  auth,
  corsOrigins: csv(env.CORS_ORIGINS),
  limiter,
  policies,
  switches,
  keySecret: env.AUTH_SECRET ?? 'development-only-secret-not-for-production!!',
  ...(env.GOOGLE_CLOUD_PROJECT ? { traceProject: env.GOOGLE_CLOUD_PROJECT } : {}),
  ...(env.EDGE_SECRET ? { edgeSecret: env.EDGE_SECRET } : {}),
});

// Unverified accounts older than 7 days are deleted hourly (idempotent on every instance).
const purge = setInterval(() => {
  auth.deps.service
    .purgeUnverified()
    .then((n) => {
      if (n > 0) logger.info({ purged: n }, 'unverified accounts deleted');
    })
    .catch((err: unknown) => {
      logger.error({ err }, 'unverified purge failed');
    });
  // Retention (docs/security/data-inventory.md): security audit log 1 year.
  void prisma?.auditLog
    .deleteMany({ where: { timestamp: { lt: new Date(Date.now() - 365 * 86_400_000) } } })
    .catch((err: unknown) => {
      logger.error({ err }, 'audit retention purge failed');
    });
}, 60 * 60_000);
purge.unref();

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
