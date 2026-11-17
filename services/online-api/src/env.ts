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
  APP_URL: z.url().default('https://play.mrak.game'),
  /** Comma-separated exact origins (game, landing, native shells). */
  CORS_ORIGINS: z.string().default('https://play.mrak.game,https://mrak.game'),
  COOKIE_DOMAIN: z.string().default('mrak.game'),
  TURNSTILE_SECRET: z.string().optional(),
  TURNSTILE_HOSTNAMES: z.string().default('play.mrak.game,mrak.game'),
  HIBP_ENABLED: z.enum(['true', 'false']).default('true'),
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
