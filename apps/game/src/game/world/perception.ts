/**
 * Low-Sanity perception in the world (docs/systems/sanity.md → Implementation): which effects
 * of the current tier the scene applies, and which prop may shift while nobody looks at it.
 */
import type { Perception } from '@mrak/core';

export interface PerceptionFrame {
  /** Villagers turn to face the guardian when idle. */
  staring: boolean;
  /** Props out of view shift a little. */
  movingObjects: boolean;
}

export const STEADY_FRAME: PerceptionFrame = { staring: false, movingObjects: false };

export function perceptionFrame(p: Perception | null): PerceptionFrame {
  if (!p) return STEADY_FRAME;
  return {
    staring: p.effects.includes('staring'),
    movingObjects: p.effects.includes('moving-objects'),
  };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Index of the `turn`-th point outside the view (cycling), or -1 if every point is in view. */
export function pickUnseen(
  points: readonly { x: number; y: number }[],
  view: Rect,
  turn: number,
): number {
  const unseen = points
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p }) =>
        p.x < view.x || p.y < view.y || p.x > view.x + view.width || p.y > view.y + view.height,
    );
  if (unseen.length === 0) return -1;
  return unseen[turn % unseen.length]?.i ?? -1;
}

/** Offset (px) of the n-th shift: small, never the same twice in a row. */
export function shiftOffset(turn: number): { dx: number; dy: number } {
  const angles = [0.3, 2.1, 4.0, 5.4, 1.2, 3.3];
  const a = angles[turn % angles.length] ?? 0;
  return { dx: Math.round(Math.cos(a) * 3), dy: Math.round(Math.sin(a) * 3) };
}

/**
 * Sprite tint of the guardian marked by Corruption (0–1): from no tint to a cold, ashen
 * violet — readable on every background, never hiding the sprite.
 */
export function corruptionTint(aspect: number): number {
  const a = Math.min(1, Math.max(0, aspect));
  const r = Math.round(255 - 110 * a);
  const g = Math.round(255 - 140 * a);
  const b = Math.round(255 - 60 * a);
  return (r << 16) | (g << 8) | b;
}
