import { describe, expect, it, vi } from 'vitest';
import { TypedEventBus } from '../events/EventBus';
import { createUiStore } from '../state/ui-store';
import { absorbEmergency, EMERGENCY_KEY } from '../storage/emergency';
import { MemoryBackend, SaveStore } from '../storage/save-store';
import { loadContentDatabase } from './content';
import { FIXED_STEP_MS, GameHost, MAX_STEPS_PER_FRAME, SNAPSHOT_INTERVAL_MS } from './GameHost';

const content = loadContentDatabase();

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

async function setup(backend = new MemoryBackend()) {
  const store = createUiStore();
  const bus = new TypedEventBus();
  const saves = await SaveStore.open(backend);
  const emergency = memoryStorage();
  // Every save gets a distinct, increasing timestamp.
  let tick = Date.parse('2026-11-15T00:00:00Z');
  const host = new GameHost({
    content,
    saves,
    store,
    bus,
    emergency,
    seed: () => 1834,
    now: () => new Date((tick += 1000)),
  });
  return { host, store, bus, saves, backend, emergency };
}

describe('GameHost loop', () => {
  it('advances core in fixed steps with an accumulator', async () => {
    const { host } = await setup();
    host.newGame({ startMinute: 8 * 60 });
    const start = host.snapshot()?.playtimeMs ?? 0;
    host.update(FIXED_STEP_MS * 0.5); // not a full step yet
    expect(host.snapshot()?.playtimeMs).toBe(start);
    host.update(FIXED_STEP_MS * 0.6); // now one step (the remainder carries over)
    expect(host.snapshot()?.playtimeMs).toBeCloseTo(start + FIXED_STEP_MS);
  });

  it('caps the steps per frame after a long hitch', async () => {
    const { host } = await setup();
    host.newGame({ startMinute: 8 * 60 });
    host.update(10_000);
    expect(host.snapshot()?.playtimeMs).toBeCloseTo(FIXED_STEP_MS * MAX_STEPS_PER_FRAME);
  });

  it('updates the React store at a limited rate, not every frame', async () => {
    const { host, store } = await setup();
    host.newGame({ startMinute: 8 * 60 });
    const listener = vi.fn();
    store.subscribe(listener);
    // One second of 60 fps frames.
    for (let i = 0; i < 60; i++) host.update(1000 / 60);
    expect(listener.mock.calls.length).toBeLessThanOrEqual(
      Math.ceil(1000 / SNAPSHOT_INTERVAL_MS) + 1,
    );
    expect(listener.mock.calls.length).toBeGreaterThan(0);
  });

  it('shows player actions immediately', async () => {
    const { host, store } = await setup();
    host.newGame({ startMinute: 8 * 60 });
    host.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'koledari-escorted' }] });
    expect(store.getState().snapshot?.flags['koledari-escorted']).toBe(true);
  });
});

describe('GameHost lifecycle', () => {
  it('starts a new game in the village and tells Phaser', async () => {
    const { host, store, bus } = await setup();
    const started = vi.fn();
    bus.on('host:gameStarted', started);
    host.newGame({ startMinute: 8 * 60 });
    expect(started).toHaveBeenCalledWith({ zone: 'village' });
    expect(store.getState().screen).toBe('playing');
    expect(host.snapshot()?.calendar.chapterId).toBe('unclean-days');
  });

  it('pauses per reason and only resumes when every reason is cleared', async () => {
    const { host, store } = await setup();
    host.newGame({ startMinute: 8 * 60 });
    host.setPaused('focus', true);
    host.setPaused('menu', true);
    host.setPaused('focus', false);
    expect(store.getState().paused).toBe(true);
    const minute = host.snapshot()?.clock.minute;
    host.update(5_000);
    expect(host.snapshot()?.clock.minute).toBe(minute);
    host.setPaused('menu', false);
    expect(store.getState().paused).toBe(false);
    expect(host.snapshot()?.clock.paused).toBe(false);
  });

  it('saves, lists and loads slots', async () => {
    const { host, store } = await setup();
    host.newGame({ startMinute: 8 * 60 });
    host.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'lead-poured' }] });
    const result = await host.saveManual('slot-1');
    expect(result.ok).toBe(true);
    await host.idle();
    // The new game's first autosave (entering the village) and the manual save.
    expect(
      store
        .getState()
        .saves.map((s) => s.slot)
        .sort(),
    ).toEqual(['auto', 'slot-1']);
    host.quitToMenu();
    await host.idle();
    expect(host.running).toBe(false);
    expect(store.getState().screen).toBe('menu');
    expect(await host.continueGame()).toEqual({ ok: true });
    expect(host.snapshot()?.flags['lead-poured']).toBe(true);
  });

  it('refuses manual and quick saves at night', async () => {
    const { host, store } = await setup();
    host.newGame({ startMinute: 8 * 60 });
    host.dispatch({ type: 'advanceTime', minutes: 15 * 60 }); // 08:00 → 23:00
    await host.idle();
    expect(host.canManualSave()).toBe(false);
    expect(await host.saveManual('quick')).toEqual({ ok: false, problem: 'night' });
    expect(store.getState().saveActivity?.state).toBe('refused');
  });

  it('autosaves at dusk and dawn, on zone change, after decisions and before rituals', async () => {
    const { host, saves } = await setup();
    host.newGame({ startMinute: 8 * 60 });
    await host.idle();
    const reasons = async () => (await saves.list()).map((e) => e.reason);
    expect(await reasons()).toEqual(['zone']);
    host.dispatch({ type: 'advanceTime', minutes: 12 * 60 }); // crosses dusk
    await host.idle();
    expect((await reasons())[0]).toBe('dusk');
    host.dispatch({ type: 'recordDecision', id: 'spare-the-miller', choice: 'spared' });
    await host.idle();
    expect((await reasons())[0]).toBe('decision');
    await host.checkpoint('ritual');
    await host.idle();
    expect(await reasons()).toEqual(['ritual', 'decision', 'dusk']); // rotation of 3
  });

  it('writes one autosave per tick even when several triggers fire', async () => {
    const { host, saves } = await setup();
    host.newGame({ startMinute: 8 * 60 });
    await host.idle();
    const before = (await saves.list()).length;
    host.dispatch({ type: 'recordDecision', id: 'a', choice: 'x' });
    host.dispatch({ type: 'recordDecision', id: 'b', choice: 'y' });
    await host.checkpoint('ritual');
    await host.idle();
    const list = await saves.list();
    expect(list.length).toBe(before + 1);
    expect(list[0]?.reason).toBe('ritual');
  });

  it('closing the tab at night: the game continues from the backup', async () => {
    const backend = new MemoryBackend();
    const first = await setup(backend);
    first.host.newGame({ startMinute: 8 * 60 });
    first.host.dispatch({ type: 'advanceTime', minutes: 16 * 60 }); // 08:00 → 00:00, night
    await first.host.idle();
    first.host.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'lead-poured' }] });
    const night = first.host.snapshot();
    // pagehide: the synchronous backup is written; the async autosave never gets to run.
    first.host.suspend();
    expect(first.emergency.map.has(EMERGENCY_KEY)).toBe(true);

    // Next visit: same IndexedDB contents, the backup is absorbed at boot.
    const second = await setup(backend);
    expect(await absorbEmergency(first.emergency, second.saves)).toBe(true);
    await second.host.refreshSaves();
    expect(await second.host.continueGame()).toEqual({ ok: true });
    expect(second.host.snapshot()?.clock).toEqual(night?.clock);
    expect(second.host.snapshot()?.flags['lead-poured']).toBe(true);
  });

  it('a corrupt save never breaks the game: the previous autosave is offered', async () => {
    const { host, saves, backend } = await setup();
    host.newGame({ startMinute: 8 * 60 });
    await host.idle();
    host.dispatch({ type: 'advanceTime', minutes: 12 * 60 });
    await host.idle();
    const [newest, previous] = await saves.list();
    if (!newest || !previous) throw new Error('expected two autosaves');
    await backend.stage(newest, '{"version":3,"truncated');
    host.quitToMenu();
    await host.idle();
    // quitToMenu wrote a fresh autosave; corrupt it too so Continue hits a damaged save.
    const [latest] = await saves.list();
    if (!latest) throw new Error('expected a save');
    await backend.stage(latest, 'garbage');

    const result = await host.continueGame();
    expect(result).toMatchObject({ ok: false, problem: 'corrupt', fallback: { id: previous.id } });
    expect(host.running).toBe(false);
    if (result.ok || !result.fallback) throw new Error('expected a fallback');
    expect(await host.load(result.fallback.id)).toEqual({ ok: true });
    expect(host.running).toBe(true);
  });

  it('exports and imports a save file', async () => {
    const { host, saves } = await setup();
    host.newGame({ startMinute: 8 * 60 });
    host.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'lead-poured' }] });
    const saved = await host.saveManual('slot-1');
    if (!saved.ok) throw new Error('save failed');
    const file = await host.exportSave(saved.entry.id);
    expect(file?.filename).toMatch(/^mrak-slot-1-\d{4}-\d{2}-\d{2}\.mrak$/);
    const imported = await host.importSave(file?.text ?? '', 'slot-3');
    expect(imported).toMatchObject({ ok: true, entry: { slot: 'slot-3', generation: 1 } });
    if (!imported.ok) throw new Error('import failed');
    expect(await host.load(imported.entry.id)).toEqual({ ok: true });
    expect(host.snapshot()?.flags['lead-poured']).toBe(true);
    expect(await host.importSave('{"nope":1}', 'slot-2')).toEqual({
      ok: false,
      problem: 'corrupt',
    });
    expect((await saves.list()).some((e) => e.slot === 'slot-2')).toBe(false);
  });

  it('rejects commands when no game is running', async () => {
    const { host } = await setup();
    expect(host.dispatch({ type: 'advanceTime', minutes: 1 })).toMatchObject({ ok: false });
  });
});
