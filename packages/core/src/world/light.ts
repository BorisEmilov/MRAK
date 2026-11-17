/**
 * Light rules (docs/systems/light.md → Implementation). Pure functions shared by core and the
 * Phaser layer, so what the player sees and what the rules decide always agree.
 */
import { dayPhaseAt, lightBoundaries, TWILIGHT_MINUTES, type DayPhase } from '../time/calendar';

/** In-world minutes one unit of lamp oil lasts at consumption rate 1. */
export const OIL_MINUTES_PER_UNIT = 15;
/** The inventory item the lantern burns. */
export const OIL_ITEM = 'lamp-oil';
/** Ambient light below which the guardian is "in darkness" when outside every light. */
export const DARKNESS_THRESHOLD = 0.35;
/** In-world minutes of darkness per Sanity point lost. */
export const DARKNESS_MINUTES_PER_SANITY = 10;
/** Flag set when the moon is "pulled down": ambient 0 at night, lantern radius halved. */
export const MOON_PULLED_DOWN_FLAG = 'moon-pulled-down';

export interface LanternState {
  /** Equipped lantern gear id (null = none). */
  lantern: string | null;
  lit: boolean;
  /** What is left of the oil unit poured into the lantern (0–1). */
  fuel: number;
}

export interface BurnResult {
  fuel: number;
  lit: boolean;
  /** Units of oil poured from the inventory. */
  unitsUsed: number;
  wentOut: boolean;
}

/**
 * Burns `minutes` of oil. When the reservoir empties the next unit is poured automatically
 * (while `available` units remain); without oil the lantern goes out.
 */
export function burnOil(
  lantern: Pick<LanternState, 'lit' | 'fuel'>,
  minutes: number,
  available: number,
  rate = 1,
): BurnResult {
  if (!lantern.lit || minutes <= 0) return { ...lantern, unitsUsed: 0, wentOut: false };
  let need = (minutes * Math.max(0, rate)) / OIL_MINUTES_PER_UNIT;
  let fuel = lantern.fuel;
  let unitsUsed = 0;
  // Float tolerance: 15 one-minute steps must burn exactly one unit.
  const EPS = 1e-9;
  while (need > EPS) {
    if (fuel <= EPS) {
      if (unitsUsed >= available) return { fuel: 0, lit: false, unitsUsed, wentOut: true };
      unitsUsed += 1;
      fuel = 1;
    }
    const burn = Math.min(fuel, need);
    fuel -= burn;
    need -= burn;
  }
  if (fuel <= EPS) {
    fuel = 0;
    // Empty reservoir with nothing to pour: out now, not at the next tick.
    if (unitsUsed >= available) return { fuel: 0, lit: false, unitsUsed, wentOut: true };
  }
  return { fuel, lit: true, unitsUsed, wentOut: false };
}

export interface RadiusInput {
  /** Gear `lightRadius` (tiles). */
  base: number;
  /** Extra tiles from blessings/talents. */
  bonus?: number;
  phase: DayPhase;
  /** Moon illumination 0–1. */
  moonIllumination: number;
  pulledDown: boolean;
}

/** Lantern radius in tiles: base + bonus + moon (dusk/night), halved last under a pulled moon. */
export function lanternRadius(input: RadiusInput): number {
  const moon =
    (input.phase === 'night' || input.phase === 'dusk') && !input.pulledDown
      ? Math.round(2 * clamp01(input.moonIllumination))
      : 0;
  const radius = Math.max(0, input.base + (input.bonus ?? 0) + moon);
  return input.pulledDown ? radius * 0.5 : radius;
}

export type Rgb = readonly [number, number, number];

export interface Ambient {
  /** Brightness 0–1. */
  level: number;
  /** Light colour (0–1 per channel) before scaling by `level`. */
  tint: Rgb;
  phase: DayPhase;
}

const DAY_TINT: Rgb = [1, 0.97, 0.9];
const DUSK_TINT: Rgb = [1, 0.62, 0.42];
const NIGHT_TINT: Rgb = [0.42, 0.5, 0.78];
const NIGHT_BASE = 0.08;
const MOON_GAIN = 0.1;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Cosine ease 0→1. */
function ease(t: number): number {
  return (1 - Math.cos(Math.PI * clamp01(t))) / 2;
}

/** Ambient light at a minute of the day (Julian month for the season's day length). */
export function ambientLight(
  minute: number,
  month: number,
  moonIllumination: number,
  pulledDown: boolean,
): Ambient {
  const phase = dayPhaseAt(minute, month);
  const night = pulledDown ? 0 : NIGHT_BASE + MOON_GAIN * clamp01(moonIllumination);
  if (phase === 'day') return { level: 1, tint: DAY_TINT, phase };
  if (phase === 'night') return { level: night, tint: NIGHT_TINT, phase };
  const { dawnStart, nightStart } = lightBoundaries(month);
  const start = phase === 'dawn' ? dawnStart : nightStart - TWILIGHT_MINUTES;
  const t = (minute - start) / TWILIGHT_MINUTES;
  if (phase === 'dusk') {
    // Day → night; a pulled-down moon swallows dusk too.
    const level = pulledDown ? 0 : 1 + (night - 1) * ease(t);
    const tint = t < 0.5 ? mix(DAY_TINT, DUSK_TINT, t * 2) : mix(DUSK_TINT, NIGHT_TINT, t * 2 - 1);
    return { level, tint, phase };
  }
  // Dawn: night → day.
  return { level: night + (1 - night) * ease(t), tint: mix(NIGHT_TINT, DAY_TINT, ease(t)), phase };
}

export interface LightCircle {
  x: number;
  y: number;
  /** Same unit as x/y. */
  radius: number;
}

/** Whether a point is inside any light. */
export function isLit(point: { x: number; y: number }, lights: readonly LightCircle[]): boolean {
  return lights.some((l) => (point.x - l.x) ** 2 + (point.y - l.y) ** 2 <= l.radius ** 2);
}

/** Darkness counts only when the ambient light is low. */
export function inDarkness(
  point: { x: number; y: number },
  lights: readonly LightCircle[],
  ambientLevel: number,
): boolean {
  return ambientLevel < DARKNESS_THRESHOLD && !isLit(point, lights);
}

/** Sanity lost after accumulating `darkMinutes`; returns the loss and the remainder. */
export function darknessDrain(darkMinutes: number): { loss: number; remainder: number } {
  const loss = Math.floor(darkMinutes / DARKNESS_MINUTES_PER_SANITY + 1e-9);
  return { loss, remainder: Math.max(0, darkMinutes - loss * DARKNESS_MINUTES_PER_SANITY) };
}
