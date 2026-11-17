/**
 * GameClock: advances in-world time from ticks given by the outside (the game loop). Core never
 * uses setInterval or requestAnimationFrame. Pausable, with configurable speed.
 */
import { event, type CoreEvent } from '../events';
import type { ClockState } from '../state/world-state';
import { dayPhaseAt, jdnToJulian, MINUTES_PER_DAY } from './calendar';

export type { ClockState };

export interface GameClockOptions {
  /** In-world minutes per real second at speed 1 (docs: 1 minute = 1 s at night). */
  minutesPerSecond?: number;
  /** Longest real time a single tick may cover (hidden tab catch-up limit). */
  maxTickMs?: number;
}

export const WITCHING_MINUTE = 3 * 60 + 33;
export const COCK_CROW_MINUTE = 4 * 60 + 30;

export class GameClock {
  readonly minutesPerSecond: number;
  readonly maxTickMs: number;

  constructor(options: GameClockOptions = {}) {
    this.minutesPerSecond = options.minutesPerSecond ?? 1;
    this.maxTickMs = options.maxTickMs ?? 60_000;
  }

  /** Real-time tick. Returns the new state and every boundary crossed, in order. */
  tick(state: ClockState, dtMs: number): { state: ClockState; events: CoreEvent[] } {
    if (state.paused || dtMs <= 0) return { state, events: [] };
    const realMs = Math.min(dtMs, this.maxTickMs);
    const minutes = (realMs / 1000) * this.minutesPerSecond * state.speed;
    return this.advance(state, minutes);
  }

  /** Advances by in-world minutes (also used by day actions: "talk = 15 minutes"). */
  advance(state: ClockState, minutes: number): { state: ClockState; events: CoreEvent[] } {
    if (minutes <= 0) return { state, events: [] };
    const total = state.subMinute + minutes;
    const whole = Math.floor(total);
    const events: CoreEvent[] = [];
    let { day, minute } = state;
    for (let i = 0; i < whole; i++) {
      const prevPhase = dayPhaseAt(minute, jdnToJulian(day).month);
      minute += 1;
      if (minute >= MINUTES_PER_DAY) {
        minute = 0;
        day += 1;
        events.push(event('time/dayChanged', { day }));
        events.push(event('time/midnight', { day, minute }));
      }
      const phase = dayPhaseAt(minute, jdnToJulian(day).month);
      if (phase !== prevPhase) {
        events.push(event('time/phaseChanged', { from: prevPhase, to: phase }));
        if (phase === 'dawn') events.push(event('time/dawn', { day, minute }));
        if (phase === 'day') events.push(event('time/dayStarted', { day, minute }));
        if (phase === 'dusk') events.push(event('time/duskReached', { day, minute }));
        // nightStarted carries the night index; the calendar system fills it in.
        if (phase === 'night')
          events.push(event('time/nightStarted', { day, minute, nightIndex: 0 }));
      }
      if (minute === WITCHING_MINUTE) events.push(event('time/witchingMinute', { day, minute }));
      if (minute === COCK_CROW_MINUTE) events.push(event('time/cockCrow', { day, minute }));
    }
    return { state: { ...state, day, minute, subMinute: total - whole }, events };
  }

  setPaused(state: ClockState, paused: boolean): ClockState {
    return { ...state, paused };
  }

  setSpeed(state: ClockState, speed: number): ClockState {
    if (!(speed > 0 && speed <= 100)) throw new RangeError('speed must be in (0, 100]');
    return { ...state, speed };
  }
}
