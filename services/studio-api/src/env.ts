import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url().optional(),
  /** Online database, restricted studio role (sales panel, collector-name moderation). */
  SALES_DATABASE_URL: z.url().optional(),
  /** Cloudflare Access (required in production): team domain and application audience tag. */
  ACCESS_TEAM_DOMAIN: z.string().optional(),
  ACCESS_AUD: z.string().optional(),
  /** packages/content (import source, "Export to game" target). */
  CONTENT_ROOT: z.string().default('../../packages/content'),
  /** Where exported demo/full packs are written. */
  EXPORT_DIR: z.string().default('../../dist-content'),
  /** Built apps/studio-web to serve at / . */
  STUDIO_WEB_DIR: z.string().optional(),
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
