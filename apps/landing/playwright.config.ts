/**
 * E2E of the account flow (web ↔ online-api). By default it starts both:
 * - the API from source with in-memory stores, a file mail outbox and the Turnstile test bypass
 *   (development-only switches the API refuses in production);
 * - the site built against that API and served by `astro preview`.
 * Against the API in Docker instead: `docker compose up -d` with MAIL_OUTBOX_DIR and
 * TURNSTILE_TEST_BYPASS=true, then `E2E_API_URL=http://localhost:3000 pnpm e2e`.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const SITE = 'http://localhost:4399';
const API = process.env['E2E_API_URL'] ?? 'http://localhost:3901';
export const OUTBOX = process.env['E2E_OUTBOX'] ?? join(process.cwd(), 'test-results', 'outbox');

/** A locally cached Chromium (offline machines); CI runs `playwright install chromium`. */
function chromium(): string | undefined {
  const fromEnv = process.env['PW_CHROMIUM'];
  if (fromEnv) return fromEnv;
  const cached = join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome');
  return existsSync(cached) ? cached : undefined;
}
const executablePath = chromium();

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: SITE,
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    ...(process.env['E2E_API_URL']
      ? []
      : [
          {
            command: 'pnpm --filter @mrak/online-api exec tsx src/server.ts',
            url: `${API}/health`,
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
              NODE_ENV: 'development',
              PORT: '3901',
              HOST: '127.0.0.1',
              LOG_LEVEL: 'warn',
              APP_URL: SITE,
              SITE_URL: SITE,
              CORS_ORIGINS: SITE,
              COOKIE_DOMAIN: '',
              MAIL_OUTBOX_DIR: OUTBOX,
              TURNSTILE_TEST_BYPASS: 'true',
              HIBP_ENABLED: 'false',
              // The journey logs in 5 times within a minute; limits have their own tests.
              RATE_LIMITS: '{"login-ip-email":{"limit":50},"login-ip":{"limit":100}}',
              AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e!!',
            },
          },
        ]),
    {
      command:
        'pnpm exec astro build && pnpm exec astro preview --port 4399 --host localhost --ignore-lock',
      url: SITE,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { PUBLIC_API_URL: API, PUBLIC_PLAY_URL: 'http://localhost:5173' },
    },
  ],
});
