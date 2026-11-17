import { describe, expect, it } from 'vitest';
import { fixtureDb } from '../test/fixture';
import {
  dayPhaseAt,
  festivalStart,
  festivalsOn,
  gregorianToJdn,
  jdnToGregorian,
  jdnToJulian,
  julianToJdn,
  moonPhase,
  orthodoxEaster,
  seasonOf,
} from './calendar';

const festival = (id: string) => fixtureDb.get('festivals', id);

describe('Julian calendar', () => {
  it('round-trips dates across centuries and leap days', () => {
    for (const date of [
      { year: 1779, month: 6, day: 24 },
      { year: 1834, month: 12, day: 25 },
      { year: 1835, month: 1, day: 6 },
      { year: 1856, month: 2, day: 29 },
      { year: 1900, month: 2, day: 29 }, // a leap day in Julian, not in Gregorian
    ]) {
      expect(jdnToJulian(julianToJdn(date))).toEqual(date);
    }
  });

  it('is 12 days behind the Gregorian calendar in the 19th century', () => {
    const jdn = julianToJdn({ year: 1834, month: 12, day: 25 });
    expect(jdnToGregorian(jdn)).toEqual({ year: 1835, month: 1, day: 6 });
    expect(gregorianToJdn({ year: 1835, month: 1, day: 6 })).toBe(jdn);
  });

  it('computes Orthodox Easter (Julian dates)', () => {
    // 2024: 22 April O.S. = 5 May N.S.; 2025: 7 April O.S. = 20 April N.S.
    expect(orthodoxEaster(2024)).toEqual({ year: 2024, month: 4, day: 22 });
    expect(jdnToGregorian(julianToJdn(orthodoxEaster(2024)))).toEqual({
      year: 2024,
      month: 5,
      day: 5,
    });
    expect(orthodoxEaster(2025)).toEqual({ year: 2025, month: 4, day: 7 });
    expect(jdnToGregorian(julianToJdn(orthodoxEaster(2025)))).toEqual({
      year: 2025,
      month: 4,
      day: 20,
    });
  });

  it('assigns seasons by month', () => {
    expect([12, 1, 2, 3, 6, 9, 11].map(seasonOf)).toEqual([
      'winter',
      'winter',
      'winter',
      'spring',
      'summer',
      'autumn',
      'autumn',
    ]);
  });
});

describe('festivals', () => {
  it('starts the Unclean Days on 25 December and lasts twelve nights', () => {
    const start = festivalStart(festival('unclean-days'), 1834);
    expect(jdnToJulian(start)).toEqual({ year: 1834, month: 12, day: 25 });
    const lastNight = julianToJdn({ year: 1835, month: 1, day: 5 });
    expect(festivalsOn([festival('unclean-days')], lastNight)).toEqual([
      { festival: festival('unclean-days'), start, night: 12 },
    ]);
    expect(festivalsOn([festival('unclean-days')], lastNight + 1)).toEqual([]);
    expect(festivalsOn([festival('unclean-days')], start - 1)).toEqual([]);
  });

  it('places movable feasts relative to Orthodox Easter', () => {
    const start = festivalStart(festival('rusalia'), 1835);
    expect(start).toBe(julianToJdn(orthodoxEaster(1835)) + 50);
    expect(festivalsOn([festival('rusalia')], start + 3)[0]?.night).toBe(4);
  });
});

describe('moon', () => {
  it('finds a real full and new moon (January 2025)', () => {
    // Full moon 13 Jan 2025 22:27 UTC; new moon 29 Jan 2025 12:36 UTC.
    expect(moonPhase(gregorianToJdn({ year: 2025, month: 1, day: 13 })).phase).toBe('full');
    expect(moonPhase(gregorianToJdn({ year: 2025, month: 1, day: 29 })).phase).toBe('new');
  });

  it('cycles through all eight phases in a synodic month', () => {
    const start = gregorianToJdn({ year: 1834, month: 1, day: 1 });
    const phases = new Set(Array.from({ length: 30 }, (_, i) => moonPhase(start + i).phase));
    expect(phases.size).toBe(8);
  });

  it('reports illumination between 0 and 1', () => {
    const { illumination } = moonPhase(gregorianToJdn({ year: 2025, month: 1, day: 13 }));
    expect(illumination).toBeGreaterThan(0.95);
  });
});

describe('day phases', () => {
  it('follows winter light', () => {
    expect(dayPhaseAt(3 * 60, 12)).toBe('night');
    expect(dayPhaseAt(6 * 60 + 40, 12)).toBe('dawn');
    expect(dayPhaseAt(12 * 60, 12)).toBe('day');
    expect(dayPhaseAt(19 * 60 + 30, 12)).toBe('dusk');
    expect(dayPhaseAt(20 * 60 + 30, 12)).toBe('night');
  });

  it('keeps summer evenings light longer', () => {
    expect(dayPhaseAt(20 * 60 + 30, 6)).toBe('day');
    expect(dayPhaseAt(21 * 60 + 30, 6)).toBe('dusk');
    expect(dayPhaseAt(4 * 60 + 45, 6)).toBe('dawn');
  });
});
