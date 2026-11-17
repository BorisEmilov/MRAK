import { describe, expect, it, vi } from 'vitest';
import { EventBus, type CoreEventMap } from './events';
import { Game } from './game';
import type { StoreListener } from './state/store';
import { fixtureDb } from './test/fixture';
import { jdnToJulian } from './time/calendar';

const newGame = (seed = 1): Game => Game.newGame({ content: fixtureDb, seed });

describe('Game composition', () => {
  it('starts on Christmas 1834 inside the Unclean Days chapter', () => {
    const s = newGame().snapshot();
    expect(jdnToJulian(s.clock.day)).toEqual({ year: 1834, month: 12, day: 25 });
    expect(s.calendar).toMatchObject({ chapterId: 'unclean-days', nightIndex: 0 });
    expect(Object.keys(s.villagers).sort()).toEqual(['todor', 'velika']);
  });

  it('counts the twelve nights and ends the chapter at Theophany dawn', () => {
    const game = newGame();
    const nights: number[] = [];
    game.events.on('time/nightStarted', ({ nightIndex }) => nights.push(nightIndex));
    const ended = vi.fn();
    game.events.on('time/chapterEnded', ended);
    for (let i = 0; i < 12; i++) game.dispatch({ type: 'advanceTime', minutes: 24 * 60 });
    expect(nights).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(ended).toHaveBeenCalledTimes(1);
    const s = game.snapshot();
    expect(jdnToJulian(s.clock.day)).toEqual({ year: 1835, month: 1, day: 6 });
    expect(s.calendar.chapterId).toBeNull();
    expect(s.stats['nights-survived']).toBe(12);
    expect(s.stats['year']).toBe(1835);
  });

  it('accepts an injected event bus (no global singletons)', () => {
    const bus = new EventBus<CoreEventMap>();
    const onFlag = vi.fn();
    bus.on('state/flagSet', onFlag);
    const game = Game.newGame({ content: fixtureDb, seed: 1, bus });
    game.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'a' }] });
    expect(onFlag).toHaveBeenCalledWith({ flag: 'a' });
  });
});

describe('snapshots', () => {
  it('are deeply frozen and replaced, never mutated', () => {
    const game = newGame();
    const before = game.snapshot();
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.guardian.pack)).toBe(true);
    game.dispatch({ type: 'applyEffects', effects: [{ giveItem: 'garlic', qty: 1 }] });
    expect(before.guardian.pack).toEqual([{ item: 'lamp-oil', qty: 4 }]);
    expect(game.snapshot()).not.toBe(before);
  });

  it('notifies subscribers once per commit with its events', () => {
    const game = newGame();
    const listener = vi.fn<StoreListener>();
    game.subscribe(listener);
    game.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'a' }, { setFlag: 'b' }] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[1].map((e) => e.type)).toEqual([
      'state/flagSet',
      'state/flagSet',
    ]);
  });

  it('shares unchanged slices on the tick fast path', () => {
    const game = newGame();
    const before = game.snapshot();
    game.tick(400); // less than an in-world minute
    const after = game.snapshot();
    expect(after.clock.subMinute).toBeCloseTo(0.4);
    expect(after.villagers).toBe(before.villagers);
    expect(after.playtimeMs).toBe(400);
  });
});

describe('dispatch', () => {
  it('rejects invalid commands without touching state', () => {
    const game = newGame();
    const before = game.snapshot();
    const rejected = vi.fn();
    game.events.on('game/commandRejected', rejected);
    expect(game.dispatch({ type: 'fly' }).ok).toBe(false);
    expect(game.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'Not Kebab' }] }).ok).toBe(
      false,
    );
    expect(game.dispatch({ type: 'enterZone', zone: 'atlantis' })).toMatchObject({ ok: false });
    expect(game.snapshot()).toBe(before);
    expect(rejected).toHaveBeenCalledTimes(3);
  });

  it('is atomic: a failing effect undoes earlier effects and RNG draws', () => {
    const game = newGame();
    const rng = game.random.serialize();
    const result = game.dispatch({
      type: 'applyEffects',
      effects: [
        { setFlag: 'a' },
        { if: { chance: 0.5 }, then: [{ setFlag: 'b' }] },
        { setFlag: 'undeclared' },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/undeclared flag/) as unknown,
    });
    expect(game.snapshot().flags).toEqual({});
    expect(game.random.serialize()).toEqual(rng);
  });

  it('logs decisions with their in-game date', () => {
    const game = newGame();
    game.dispatch({ type: 'advanceTime', minutes: 30 });
    game.dispatch({ type: 'recordDecision', id: 'accuse-neda', choice: 'refused' });
    expect(game.snapshot().decisions).toEqual([
      {
        id: 'accuse-neda',
        choice: 'refused',
        at: { day: game.snapshot().clock.day, minute: 8 * 60 + 30 },
      },
    ]);
  });

  it('tracks zones: discovery, visits and variants', () => {
    const game = newGame();
    const first = game.dispatch({ type: 'enterZone', zone: 'forest' });
    expect(first.events[0]?.payload).toEqual({ zone: 'forest', firstVisit: true });
    game.dispatch({ type: 'enterZone', zone: 'forest' });
    expect(game.snapshot().zones['forest']).toMatchObject({
      variant: null,
      discovered: true,
      visits: 2,
    });
    expect(game.zoneVariant('forest')).toBe('wild');
    game.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'witch-allied' }] });
    expect(game.zoneVariant('forest')).toBe('hostile');
    game.dispatch({
      type: 'applyEffects',
      effects: [{ setZoneVariant: 'forest', variant: 'burned' }],
    });
    expect(game.zoneVariant('forest')).toBe('burned');
  });

  it('uses abilities and resets their uses at nightfall', () => {
    const game = newGame();
    game.dispatch({
      type: 'applyEffects',
      source: 'kyrie',
      effects: [
        { ability: { uses: 1, per: 'night', effects: [{ addStat: 'hysteria', value: -5 }] } },
      ],
    });
    expect(game.dispatch({ type: 'useAbility', ability: 'kyrie#0' }).ok).toBe(true);
    expect(game.dispatch({ type: 'useAbility', ability: 'kyrie#0' })).toMatchObject({ ok: false });
    expect(game.snapshot().stats['hysteria']).toBe(5);
    game.dispatch({ type: 'advanceTime', minutes: 14 * 60 }); // into the night
    expect(game.snapshot().abilities['kyrie#0']?.usesLeft).toBe(1);
  });

  it('pauses and changes speed', () => {
    const game = newGame();
    game.dispatch({ type: 'setPaused', paused: true });
    game.tick(60_000);
    expect(game.snapshot().clock.minute).toBe(8 * 60);
    game.dispatch({ type: 'setPaused', paused: false });
    game.dispatch({ type: 'setSpeed', speed: 2 });
    game.tick(30_000); // 30 real seconds × speed 2 = 60 in-world minutes
    expect(game.snapshot().clock.minute).toBe(9 * 60);
  });
});

describe('reproducibility', () => {
  it('produces identical states for the same seed and the same inputs', () => {
    const play = (): unknown => {
      const game = newGame(1834);
      for (let i = 0; i < 20; i++) {
        game.dispatch({
          type: 'applyEffects',
          effects: [
            {
              if: { chance: 0.5 },
              then: [{ addStat: 'hysteria', value: 3 }],
              else: [{ addStat: 'corruption', value: 1 }],
            },
          ],
        });
        game.tick(37_000);
      }
      return game.snapshot();
    };
    expect(play()).toEqual(play());
  });
});

describe('Game.check (read-only queries for presentation)', () => {
  it('evaluates conditions without advancing any RNG stream', () => {
    const game = Game.newGame(
      { content: fixtureDb, seed: 7, now: () => new Date(0) },
      { startZone: 'forest' },
    );
    const before = game.random.serialize();
    expect(game.check({ flag: 'a' })).toBe(false);
    game.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'a' }] });
    expect(game.check({ flag: 'a' })).toBe(true);
    expect(game.check({ not: { flag: 'a' } })).toBe(false);
    game.check({ chance: 0.5 });
    expect(game.random.serialize()).toEqual(before);
  });
});
