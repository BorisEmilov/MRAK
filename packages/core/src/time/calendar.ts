/**
 * In-world calendar (docs/systems/time-calendar.md). Dates are Julian (Old Style), as used by the
 * Bulgarian Church in the 19th century. Days are identified by their Julian Day Number (JDN).
 */
import type { Festival } from '@mrak/content-schema';

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export type MoonPhase =
  | 'new'
  | 'waxing-crescent'
  | 'first-quarter'
  | 'waxing-gibbous'
  | 'full'
  | 'waning-gibbous'
  | 'last-quarter'
  | 'waning-crescent';

export const MINUTES_PER_DAY = 1440;

/** JDN of a Julian-calendar date (valid for all dates after 4713 BC). */
export function julianToJdn({ year, month, day }: CalendarDate): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
}

/** Julian-calendar date of a JDN. */
export function jdnToJulian(jdn: number): CalendarDate {
  const c = jdn + 32082;
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: d - 4800 + Math.floor(m / 10),
  };
}

/** Gregorian (New Style) date of a JDN — for real-world references only. */
export function jdnToGregorian(jdn: number): CalendarDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

export function gregorianToJdn({ year, month, day }: CalendarDate): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** Orthodox Easter Sunday as a Julian-calendar date (Meeus' Julian algorithm). */
export function orthodoxEaster(year: number): CalendarDate {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return { year, month, day };
}

export function seasonOf(month: number): Season {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

const SYNODIC_MONTH = 29.530588853;
/** A reference new moon: 6 Jan 2000, 18:14 UTC (JD 2451550.26). */
const REFERENCE_NEW_MOON_JD = 2451550.26;
const MOON_PHASES: readonly MoonPhase[] = [
  'new',
  'waxing-crescent',
  'first-quarter',
  'waxing-gibbous',
  'full',
  'waning-gibbous',
  'last-quarter',
  'waning-crescent',
];

/** Moon phase at (approximately) midnight of the given day. Accurate to about a day. */
export function moonPhase(jdn: number): { phase: MoonPhase; age: number; illumination: number } {
  // A JDN is noon of its day; +0.5 is the midnight that ends it — the night the guardian walks.
  const jd = jdn + 0.5;
  const age = (((jd - REFERENCE_NEW_MOON_JD) % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const index = Math.floor((age / SYNODIC_MONTH) * 8 + 0.5) % 8;
  const illumination = (1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH)) / 2;
  return { phase: MOON_PHASES[index] ?? 'new', age, illumination };
}

/**
 * Light boundaries by month (minutes). Winter: night 20:00 → dawn 06:30; summer: 22:00 → 04:30
 * (time-calendar.md). Dawn and dusk last one hour each.
 */
const DAWN_START = [390, 375, 345, 315, 285, 270, 270, 285, 315, 345, 375, 390];
const NIGHT_START = [1200, 1215, 1245, 1275, 1305, 1320, 1320, 1305, 1275, 1245, 1215, 1200];
export const TWILIGHT_MINUTES = 60;

export function lightBoundaries(month: number): { dawnStart: number; nightStart: number } {
  return { dawnStart: DAWN_START[month - 1] ?? 390, nightStart: NIGHT_START[month - 1] ?? 1200 };
}

export function dayPhaseAt(minute: number, month: number): DayPhase {
  const { dawnStart, nightStart } = lightBoundaries(month);
  if (minute >= dawnStart && minute < dawnStart + TWILIGHT_MINUTES) return 'dawn';
  if (minute >= dawnStart + TWILIGHT_MINUTES && minute < nightStart - TWILIGHT_MINUTES)
    return 'day';
  if (minute >= nightStart - TWILIGHT_MINUTES && minute < nightStart) return 'dusk';
  return 'night';
}

/** First day (JDN) of a festival in a given year. */
export function festivalStart(festival: Festival, year: number): number {
  if ('fixed' in festival.start) {
    return julianToJdn({ year, month: festival.start.fixed.month, day: festival.start.fixed.day });
  }
  return julianToJdn(orthodoxEaster(year)) + festival.start.easterOffsetDays;
}

/**
 * The festival chapter active on a day, if any, and which night of it that day's evening is.
 * A festival starting on Dec 25 of year Y is found from days in year Y+1 too.
 */
export function festivalsOn(
  festivals: readonly Festival[],
  jdn: number,
): { festival: Festival; start: number; night: number }[] {
  const { year } = jdnToJulian(jdn);
  const out: { festival: Festival; start: number; night: number }[] = [];
  for (const festival of festivals) {
    for (const y of [year - 1, year]) {
      const start = festivalStart(festival, y);
      if (jdn >= start && jdn < start + festival.nights) {
        out.push({ festival, start, night: jdn - start + 1 });
      }
    }
  }
  return out;
}

export function formatDate(date: CalendarDate): string {
  return `${String(date.year)}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')} (O.S.)`;
}
