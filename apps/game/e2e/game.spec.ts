/**
 * Player journeys (docs/systems/testing.md → E2E): new game through the prologue to the first
 * save, load, zone change, dialogue and the simulated purchase. Time and scene helpers go through
 * the DEV hooks (`__mrak` host/store, `__mrakGame`), which only issue core commands.
 */
import { expect, test, type Page } from '@playwright/test';

interface Hooks {
  host: {
    dispatch: (c: Record<string, unknown>) => { ok: boolean; reason?: string };
    setPaused: (reason: string, paused: boolean) => void;
    snapshot: () => {
      currentZone: string | null;
      clock: { day: number; minute: number };
    } | null;
  };
  store: {
    getState: () => {
      screen: string;
      saveActivity: { state: string } | null;
      dialogue: unknown;
      options: Record<string, unknown>;
    };
    setState: (s: Record<string, unknown>) => void;
  };
}

const state = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __mrak: Hooks }).__mrak;
    const s = m.host.snapshot();
    const ui = m.store.getState();
    return {
      screen: ui.screen,
      saved: ui.saveActivity?.state ?? null,
      dialogue: ui.dialogue !== null,
      zone: s?.currentZone ?? null,
      day: s?.clock.day ?? null,
      minute: s?.clock.minute ?? null,
    };
  });

const dispatch = (page: Page, command: Record<string, unknown>) =>
  page.evaluate((c) => (window as unknown as { __mrak: Hooks }).__mrak.host.dispatch(c), command);

/** A headless window loses focus: resume as the "Paused" overlay's click does. */
async function resume(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __mrak: Hooks }).__mrak.host.setPaused('focus', false);
  });
}

async function dismissHints(page: Page) {
  for (let i = 0; i < 4; i++) {
    const got = page.getByRole('button', { name: 'Got it' });
    if (!(await got.count())) return;
    await got.first().click();
  }
}

/** Menu → New Game → guardian creation → in the world, first autosave written. */
async function newGame(page: Page) {
  // Headless windows never have focus: the player's saved options turn the focus pause off.
  await page.addInitScript(() => {
    localStorage.setItem('mrak.options.v1', JSON.stringify({ pauseOnBlur: false, hints: false }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await page.getByRole('button', { name: 'Take the watch' }).click();
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
  await dismissHints(page);
}

const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(String(e)));
});
test.afterEach(() => {
  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

test('new game: the prologue reaches its first save, and it loads back', async ({ page }) => {
  await newGame(page);
  // Entering the first zone autosaves (a new game is never unsaved).
  await expect.poll(async () => (await state(page)).saved).toBe('saved');
  const before = await state(page);
  expect(before.zone).not.toBeNull();

  await page.reload();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
  const after = await state(page);
  expect(after.zone).toBe(before.zone);
  expect(after.day).toBe(before.day);
});

test('zone change: leaving through an exit loads the next zone', async ({ page }) => {
  await newGame(page);
  const from = (await state(page)).zone;
  // The scene's own exit path (dispatch enterZone, fade, restart with the new zone's assets).
  await page.evaluate(() => {
    const game = (
      window as unknown as { __mrakGame: { scene: { getScene: (k: string) => unknown } } }
    ).__mrakGame;
    const scene = game.scene.getScene('World') as { exits: unknown[]; leave: (e: unknown) => void };
    const exit = scene.exits[0];
    if (!exit) throw new Error('this zone has no exit');
    scene.leave(exit);
  });
  await expect.poll(async () => (await state(page)).zone).not.toBe(from);
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
});

test('dialogue: talking to a villager opens the story and a choice continues it', async ({
  page,
}) => {
  await newGame(page);
  await page.evaluate(() => {
    const game = (
      window as unknown as { __mrakGame: { scene: { getScene: (k: string) => unknown } } }
    ).__mrakGame;
    const scene = game.scene.getScene('World') as { talkTo: (v: string, n: string) => void };
    scene.talkTo('petko', 'villager.petko.name');
  });
  const panel = page.locator('.dialogue');
  await expect(panel).toBeVisible();
  // Advance the lines until a choice or the end.
  for (let i = 0; i < 30 && (await panel.count()) > 0; i++) {
    await resume(page);
    const choice = panel
      .locator('.dialogue-choices button:not([disabled]):not([aria-disabled="true"])')
      .first();
    if (await choice.count()) {
      await choice.click();
      break;
    }
    const next = panel.locator('.dialogue-line');
    if (!(await next.count())) break;
    await next.click();
  }
  expect((await state(page)).screen).toBe('playing');
});

test('simulated purchase: the demo-end card opens the store', async ({ page, context }) => {
  // The store site is simulated: any /buy/ page answers with a stand-in checkout.
  await context.route('**/buy/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Checkout</title><h1>Checkout</h1>' }),
  );
  await newGame(page);
  const r = await dispatch(page, {
    type: 'applyEffects',
    effects: [{ addStat: 'nights-survived', value: 4 }],
  });
  expect(r.ok).toBe(true);
  await expect(page.getByText('The demo ends here')).toBeVisible();
  const [store] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: 'Buy the full game' }).click(),
  ]);
  await store.waitForLoadState();
  expect(store.url()).toMatch(/\/buy\/$/);
  await expect(store.getByRole('heading', { name: 'Checkout' })).toBeVisible();
});

test('report a bug: the save and seed are attached only with consent', async ({ page }) => {
  await newGame(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Report a bug' }).click();
  await page
    .getByLabel('What happened? What did you expect?')
    .fill('The well swallowed my lantern.');
  const read = async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download report' }).click(),
    ]);
    const path = await download.path();
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  };
  const without = await read();
  expect(without).toMatchObject({ platform: 'web', description: 'The well swallowed my lantern.' });
  expect(without['save']).toBeUndefined();
  expect(without['seed']).toBeUndefined();
  // A second report, now with consent.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Report a bug' }).click();
  await page.getByLabel('What happened? What did you expect?').fill('Again, with the save.');
  await page.getByLabel(/Attach my current save/).check();
  const withSave = await read();
  expect(typeof withSave['seed']).toBe('number');
  expect(String(withSave['save'])).toContain('"rng"');
  expect(String(withSave['version'])).toMatch(/^\d+\.\d+\.\d+/);
});
