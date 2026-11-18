/**
 * Game E2E (docs/systems/testing.md → E2E) against the Vite dev server (DEV hooks `__mrak`).
 * Browser matrix: Chromium, Firefox, WebKit (Safari engine) and Edge (`msedge` channel).
 *   pnpm --filter @mrak/game e2e                     all projects
 *   pnpm --filter @mrak/game e2e --project=chromium  one browser
 * Locally without downloaded browsers, a cached Chromium is used (PW_CHROMIUM or ~/.cache).
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 5192;
const cached = join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome');
const executablePath = process.env['PW_CHROMIUM'] ?? (existsSync(cached) ? cached : undefined);
// WebGL in headless CI: software rendering.
const gl = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: gl, ...(executablePath ? { executablePath } : {}) },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  ],
  webServer: {
    command: `pnpm exec vite --port ${String(PORT)} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
