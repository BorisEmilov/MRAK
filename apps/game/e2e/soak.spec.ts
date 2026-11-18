/**
 * Memory soak (docs/systems/performance.md → Memory): plays in a loop for SOAK_MINUTES (nightly
 * CI: 120) — zone changes, day/night cycles, conversations — and checks that textures, scene
 * objects and the JS heap (after a forced GC) stay flat. Chromium only (CDP heap metrics).
 *   SOAK_MINUTES=5 pnpm --filter @mrak/game e2e soak --project=chromium
 */
import { expect, test, type Page } from '@playwright/test';

const MINUTES = Number(process.env['SOAK_MINUTES'] ?? 0);

interface Sample {
  at: number;
  textures: number;
  objects: number;
  heap: number;
}

type W = {
  __mrak: {
    host: { dispatch: (c: Record<string, unknown>) => unknown; snapshot: () => unknown };
    store: {
      getState: () => { screen: string; options: Record<string, unknown> };
      setState: (s: Record<string, unknown>) => void;
    };
  };
  __mrakGame: {
    textures: { list: Record<string, unknown> };
    scene: { getScene: (k: string) => unknown };
  };
};

async function sample(page: Page, at: number): Promise<Sample> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
  await cdp.detach();
  const counts = await page.evaluate(() => {
    const w = window as unknown as W;
    const scene = w.__mrakGame.scene.getScene('World') as { children?: { length: number } };
    return {
      textures: Object.keys(w.__mrakGame.textures.list).length,
      objects: scene.children?.length ?? 0,
    };
  });
  return { at, heap: usedSize, ...counts };
}

const screen = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__mrak.store.getState().screen);

test('no leaks over a long session', async ({ page, browserName }) => {
  test.skip(MINUTES <= 0 || browserName !== 'chromium', 'set SOAK_MINUTES (Chromium)');
  test.setTimeout((MINUTES + 5) * 60_000);
  await page.addInitScript(() => {
    localStorage.setItem('mrak.options.v1', JSON.stringify({ pauseOnBlur: false, hints: false }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await page.getByRole('button', { name: 'Take the watch' }).click();
  await expect.poll(() => screen(page)).toBe('playing');

  const samples: Sample[] = [];
  const start = Date.now();
  let cycle = 0;
  while (Date.now() - start < MINUTES * 60_000) {
    cycle++;
    // Leave through the first exit (fade, restart, zone assets load and unload).
    await page.evaluate(() => {
      const scene = (window as unknown as W).__mrakGame.scene.getScene('World') as {
        exits?: unknown[];
        leave?: (e: unknown) => void;
      };
      const exit = scene.exits?.[0];
      if (exit && scene.leave) scene.leave(exit);
    });
    await expect.poll(() => screen(page), { timeout: 60_000 }).toBe('playing');
    await page.waitForTimeout(1500);
    // Six hours pass: dusk, night, dawn come round (lights, creatures, villagers).
    await page.evaluate(() => {
      (window as unknown as W).__mrak.host.dispatch({ type: 'advanceTime', minutes: 360 });
    });
    await page.waitForTimeout(1500);
    if (cycle % 2 === 0) {
      await page.evaluate(() => {
        const { store } = (window as unknown as W).__mrak;
        store.setState({ dialogue: { story: 'petko', villager: 'petko' } });
        store.setState({ dialogue: null });
      });
    }
    if (cycle === 3 || cycle % 10 === 0) samples.push(await sample(page, Date.now() - start));
  }
  samples.push(await sample(page, Date.now() - start));
  console.log(JSON.stringify({ cycles: cycle, samples }));

  const base = samples[0];
  const last = samples.at(-1);
  if (!base || !last || samples.length < 2) throw new Error('soak too short to compare');
  // Textures and scene objects come back to the same level after each zone; the heap may move
  // with caches, but not grow with time.
  expect(last.textures - base.textures).toBeLessThanOrEqual(8);
  expect(last.objects - base.objects).toBeLessThanOrEqual(50);
  expect(last.heap / base.heap).toBeLessThan(1.25);
});
