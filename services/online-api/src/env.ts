import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url().optional(),
  /** Game content ids the API accepts (achievements, Bloodline nodes). */
  CONTENT_DATA_DIR: z.string().default('../../packages/content/data'),
  /** JSON array of private Ed25519 JWKs (first signs). Required in production. */
  AUTH_JWT_KEYS: z.string().optional(),
  /** ≥ 32 chars of randomness for IP salts and keyed hashes. Required in production. */
  AUTH_SECRET: z.string().min(32).optional(),
  AUTH_ISSUER: z.string().default('https://api.mrak.game'),
  AUTH_AUDIENCE: z.string().default('mrak-game'),
  /** Where account email links land (/account/verify, /account/reset): the public site. */
  APP_URL: z.url().default('https://mrak.game'),
  /** Public site for newsletter links. */
  SITE_URL: z.url().default('https://mrak.game'),
  /** Development/E2E only: write mails to <dir>/outbox.jsonl (refused in production). */
  MAIL_OUTBOX_DIR: z.string().optional(),
  /** E2E only: accept any Turnstile token (refused in production). */
  TURNSTILE_TEST_BYPASS: z.enum(['true', 'false']).default('false'),
  /** Paddle Billing (ADR 0010). Sandbox in test mode: https://sandbox-api.paddle.com */
  PADDLE_API_URL: z.url().default('https://sandbox-api.paddle.com'),
  PADDLE_API_KEY: z.string().optional(),
  PADDLE_WEBHOOK_SECRET: z.string().optional(),
  PADDLE_PRICE_FULL_GAME: z.string().optional(),
  PADDLE_PRICE_COLLECTOR: z.string().optional(),
  /** Paid full pack in R2 (output of `pnpm --filter @mrak/content-schema full-pack`). */
  R2_HOST: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  FULL_PACK_PATH: z.string().optional(),
  FULL_PACK_VERSION: z.string().optional(),
  FULL_PACK_SHA256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  FULL_PACK_BYTES: z.coerce.number().int().min(1).optional(),
  /** Development/E2E only: serve the full pack from this directory with HMAC URLs (refused in production). */
  FULL_PACK_LOCAL_DIR: z.string().optional(),
  /** Public base URL of this API (local signed URLs). */
  API_URL: z.url().default('https://api.mrak.game'),
  /** Shared secret Cloudflare adds as `x-mrak-edge` (ADR 0011); required in production. */
  EDGE_SECRET: z.string().min(32).optional(),
  /** PEM CA of the managed Redis (TLS, `rediss://`). */
  REDIS_CA_CERT: z.string().optional(),
  /** Google Cloud project (set by the platform): Cloud Trace correlation in logs. */
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  /** Comma-separated exact origins (game, landing, native shells). */
  CORS_ORIGINS: z.string().default('https://play.mrak.game,https://mrak.game'),
  COOKIE_DOMAIN: z.string().default('mrak.game'),
  TURNSTILE_SECRET: z.string().optional(),
  TURNSTILE_HOSTNAMES: z.string().default('play.mrak.game,mrak.game'),
  HIBP_ENABLED: z.enum(['true', 'false']).default('true'),
  /** JSON overrides of rate-limit policies, e.g. {"login-ip":{"limit":40}} (src/limits/policies.ts). */
  RATE_LIMITS: z.string().optional(),
  /** Switches that start OFF (registration,cloud-saves,telemetry,emails,purchases); runtime: Redis. */
  KILL_SWITCHES: z.string().default(''),
  /** Global emails per UTC day; alerts at 50 % and 80 %. */
  EMAIL_DAILY_CAP: z.coerce.number().int().min(1).default(2000),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parse and validate environment. Never log the raw values (they may hold secrets). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment variables: ${fields}`);
  }
  return result.data;
}
