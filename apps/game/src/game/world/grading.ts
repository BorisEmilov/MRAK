/**
 * Screen filter parameters (docs/systems/light.md → Rendering): seasonal colour grading, sanity
 * desaturation and vignette, hallucination distortion, pulled-down moon. Pure, unit-tested; the
 * Phaser side only copies these numbers into its filters.
 */
import type { Season } from '@mrak/core';

export interface GradeInput {
  season: Season;
  /** Sanity / max sanity, 0–1. */
  sanity: number;
  /** 1 - ambient light level. */
  darkness: number;
  pulledDown: boolean;
  reduceMotion: boolean;
  /** Accessibility: no screen distortion at low Sanity (colour and vignette remain). */
  reduceDistortion?: boolean;
}

export interface GradeOutput {
  /** 4 × 5 colour matrix (Phaser ColorMatrix order, no offsets). */
  matrix: number[];
  vignette: { radius: number; strength: number };
  /** Displacement amount (0 = off). */
  distortion: number;
  /** Fog opacity multiplier (0–1) before the zone's density. */
  fog: number;
}

const SEASON: Record<Season, { tint: [number, number, number]; saturation: number }> = {
  winter: { tint: [0.92, 0.97, 1.08], saturation: 0.82 },
  spring: { tint: [1, 1.03, 0.97], saturation: 1 },
  summer: { tint: [1.05, 1, 0.92], saturation: 1.04 },
  autumn: { tint: [1.06, 0.97, 0.86], saturation: 0.94 },
};
const PULLED: { tint: [number, number, number]; saturation: number } = {
  tint: [0.82, 0.86, 1],
  saturation: 0.55,
};

const LR = 0.3086;
const LG = 0.6094;
const LB = 0.082;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Saturation matrix (s = 1 identity, 0 greyscale) with a per-channel tint. */
export function colorMatrix(saturation: number, tint: readonly [number, number, number]): number[] {
  const s = saturation;
  const rows = [
    [(1 - s) * LR + s, (1 - s) * LG, (1 - s) * LB],
    [(1 - s) * LR, (1 - s) * LG + s, (1 - s) * LB],
    [(1 - s) * LR, (1 - s) * LG, (1 - s) * LB + s],
  ];
  return [
    ...rows.flatMap((row, i) => [...row.map((v) => v * (tint[i] ?? 1)), 0, 0]),
    0,
    0,
    0,
    1,
    0,
  ];
}

/** Below this sanity ratio the colours start to drain. */
export const DESATURATE_BELOW = 0.6;
/** Below this ratio hallucinations distort the picture. */
export const HALLUCINATE_BELOW = 0.3;
export const MAX_DISTORTION = 0.006;

export function grade(input: GradeInput): GradeOutput {
  const sanity = clamp01(input.sanity);
  const base = input.pulledDown ? PULLED : SEASON[input.season];
  const drain = clamp01((DESATURATE_BELOW - sanity) / DESATURATE_BELOW) * 0.85;
  const fear = clamp01((0.7 - sanity) / 0.7);
  const darkness = clamp01(input.darkness);
  const hallucination = clamp01((HALLUCINATE_BELOW - sanity) / HALLUCINATE_BELOW);
  return {
    matrix: colorMatrix(base.saturation * (1 - drain), base.tint),
    vignette: {
      radius: 0.78 - 0.22 * fear - 0.08 * darkness,
      strength: 0.12 + 0.5 * fear + 0.18 * darkness,
    },
    distortion:
      input.reduceMotion || input.reduceDistortion === true ? 0 : MAX_DISTORTION * hallucination,
    fog: input.pulledDown ? 0.3 : darkness,
  };
}
