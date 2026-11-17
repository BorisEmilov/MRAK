import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../events';
import { julianToJdn } from './calendar';
import { GameClock, type ClockState } from './clock';

const base: ClockState = {
  day: julianToJdn({ year: 1834, month: 12, day: 25 }),
  minute: 12 * 60,
  subMinute: 0,
  speed: 1,
  paused: false,
};
const types = (events: CoreEvent[]): string[] => events.map((e) => e.type);

describe('GameClock', () => {
  const clock = new GameClock();

  it('advances one in-world minute per real second at speed 1', () => {
    expect(clock.tick(base, 60_000).state.minute).toBe(13 * 60);
  });

  it('accumulates fractions of a minute across ticks', () => {
    const half = clock.tick(base, 500).state;
    expect(half.minute).toBe(base.minute);
    expect(clock.tick(half, 500).state.minute).toBe(base.minute + 1);
  });

  it('does not move while paused', () => {
    const paused = clock.setPaused(base, true);
    expect(clock.tick(paused, 60_000)).toEqual({ state: paused, events: [] });
  });

  it('honours speed and rejects invalid speeds', () => {
    expect(clock.tick(clock.setSpeed(base, 4), 1_000).state.minute).toBe(base.minute + 4);
    expect(() => clock.setSpeed(base, 0)).toThrow(RangeError);
  });

  it('caps a single tick (hidden-tab catch-up)', () => {
    const capped = new GameClock({ maxTickMs: 60_000 });
    expect(capped.tick(base, 3_600_000).state.minute).toBe(base.minute + 60);
  });

  it('emits phase boundaries, midnight, the witching minute and cock-crow in order', () => {
    const { events, state } = clock.advance(base, 24 * 60);
    expect(types(events)).toEqual([
      'time/phaseChanged',
      'time/duskReached',
      'time/phaseChanged',
      'time/nightStarted',
      'time/dayChanged',
      'time/midnight',
      'time/witchingMinute',
      'time/cockCrow',
      'time/phaseChanged',
      'time/dawn',
      'time/phaseChanged',
      'time/dayStarted',
    ]);
    expect(state).toMatchObject({ day: base.day + 1, minute: base.minute });
  });

  it('fires the witching minute exactly once per night', () => {
    const { events } = clock.advance(base, 3 * 24 * 60);
    expect(types(events).filter((t) => t === 'time/witchingMinute')).toHaveLength(3);
    const witching = events.find((e) => e.type === 'time/witchingMinute');
    expect(witching?.payload).toMatchObject({ minute: 3 * 60 + 33 });
  });
});
