/**
 * Full account journey on the public site: sign up → verify → log in → play (the game's
 * achievement sync) → achievement visible in Account → change password → sign out everywhere →
 * delete the account.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { OUTBOX } from '../../playwright.config';

const API = process.env['E2E_API_URL'] ?? 'http://localhost:3901';
const PASSWORD = 'lantern oil and red thread 1834';
const NEW_PASSWORD = 'the bell rings by itself at dusk';

/** Turnstile stub: the real widget needs Cloudflare; the API runs with its test bypass. */
async function stubTurnstile(page: Page): Promise<void> {
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.turnstile = { render(el, o) { setTimeout(() => o.callback('e2e-token'), 50); return 'w'; }, remove() {} };`,
    }),
  );
}

/** The newest link of that kind mailed to `to` (the API's development mail outbox). */
async function mailLink(to: string, kind: string): Promise<string> {
  const file = join(OUTBOX, 'outbox.jsonl');
  for (let i = 0; i < 50; i++) {
    if (existsSync(file)) {
      const mails = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { to: string; kind: string; link?: string })
        .filter((m) => m.to === to && m.kind === kind);
      const link = mails.at(-1)?.link;
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no ${kind} mail for ${to}`);
}

test('sign up → verify → log in → play → achievement → password → sessions → delete', async ({
  page,
  request,
}) => {
  const email = `guardian-${String(Date.now())}@example.com`;
  await stubTurnstile(page);

  // Sign up (generic answer, password meter as advice).
  await page.goto('/signup/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('New password').fill(PASSWORD);
  await expect(page.locator('.strength')).toBeVisible();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');

  // Verify through the emailed link (token in the URL fragment, removed after use).
  await page.goto(await mailLink(email, 'verify-email'));
  await expect(page.getByRole('status')).toContainText('Email verified');
  expect(page.url()).not.toContain('token');

  // Log in → Account.
  await page.goto('/login/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/account/');
  // The player hub, not the marketing page (docs/ui/player-hub.md).
  await expect(page.getByRole('heading', { name: /^Welcome back/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your chronicle' })).toBeVisible();
  await expect(page.locator('.site-header').getByText('Play free')).toBeHidden();
  await page.getByRole('tab', { name: 'Security' }).click();
  await expect(page.getByText(`Email: ${email}`)).toBeVisible();
  // The refresh token is an HttpOnly cookie; nothing in Web Storage.
  const cookies = await page.context().cookies(`${API}/v1/auth/refresh`);
  expect(cookies.find((c) => c.name === '__Secure-mrak_rt')).toMatchObject({
    httpOnly: true,
    sameSite: 'Strict',
  });
  // Web Storage holds only the header hint: a display name and the edition, never a token.
  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage).map(([k, v]) => [k, String(v)])),
    session: Object.keys(sessionStorage).length,
  }));
  expect(storage.session).toBe(0);
  expect(Object.keys(storage.local)).toEqual(['mrak.player']);
  expect(Object.keys(JSON.parse(storage.local['mrak.player'] ?? '{}') as object).sort()).toEqual([
    'edition',
    'name',
  ]);

  // Play: the game (desktop session) finishes the prologue and syncs the achievement.
  const game = await request.post(`${API}/v1/auth/login`, {
    headers: { 'X-MRAK-CSRF': '1' },
    data: { email, password: PASSWORD, platform: 'desktop' },
  });
  expect(game.ok()).toBe(true);
  const gameToken = ((await game.json()) as { accessToken: string }).accessToken;
  const unlock = await request.post(`${API}/v1/achievements/unlock`, {
    headers: { Authorization: `Bearer ${gameToken}` },
    data: { achievements: [{ id: 'prologue', at: Date.now() }] },
  });
  expect(unlock.ok()).toBe(true);

  await page.reload();
  await page.getByRole('tab', { name: 'Achievements' }).click();
  const achievements = page.getByTestId('achievements');
  await expect(achievements.locator('.achievement:not(.locked)')).toContainText(
    'The Smoke at Enyovden',
  );
  await expect(page.getByText(/^1 of \d+ unlocked$/)).toBeVisible();
  await page.getByRole('tab', { name: 'Security' }).click();
  await expect(page.getByTestId('sessions').locator('li')).toHaveCount(2);

  // Change password: every session ends, including this one.
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.locator('#password').locator('..').getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).last().click();
  await page.waitForURL('**/login/?changed=1');
  expect(
    (
      await request.get(`${API}/v1/me`, { headers: { Authorization: `Bearer ${gameToken}` } })
    ).status(),
  ).toBe(401);

  // Log in with the new password, open a second session, then sign out everywhere.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/account/');
  const second = await request.post(`${API}/v1/auth/login`, {
    headers: { 'X-MRAK-CSRF': '1' },
    data: { email, password: NEW_PASSWORD, platform: 'android' },
  });
  const secondToken = ((await second.json()) as { accessToken: string }).accessToken;
  await page.reload();
  await page.getByRole('tab', { name: 'Security' }).click();
  await expect(page.getByTestId('sessions').locator('li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await page.waitForURL('**/login/');
  expect(
    (
      await request.get(`${API}/v1/me`, { headers: { Authorization: `Bearer ${secondToken}` } })
    ).status(),
  ).toBe(401);

  // Delete the account.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/account/');
  await page.getByRole('tab', { name: 'Privacy' }).click();
  const danger = page.locator('section', {
    has: page.getByRole('heading', { name: 'Delete account' }),
  });
  await danger.getByLabel('Password').fill(NEW_PASSWORD);
  await danger.getByLabel('Type DELETE to confirm').fill('DELETE');
  await danger.getByRole('button', { name: 'Delete account' }).click();
  await page.waitForURL('**/?deleted=1');

  // Gone: logging in fails with the generic message.
  await page.goto('/login/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
});
