/**
 * Guardian movement maths (docs/systems/night-exploration.md → Guardian): 8 directions from
 * keyboard, stick or pointer; speeds; facing angle. Pure, unit-tested.
 */

/** Walking speed in pixels per second (4 tiles/s). */
export const WALK_SPEED = 64;
export const RUN_FACTOR = 1.6;
export const NOISE_WALK = 2;
export const NOISE_RUN = 6;
/** Stick dead zone. */
export const STICK_DEADZONE = 0.25;

export interface Vec {
  x: number;
  y: number;
}

const DIAGONAL = Math.SQRT1_2;

/** Unit vector (or zero) from four held directions; opposite keys cancel. */
export function keysVector(held: {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}): Vec {
  const x = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  const y = (held.down ? 1 : 0) - (held.up ? 1 : 0);
  return x !== 0 && y !== 0 ? { x: x * DIAGONAL, y: y * DIAGONAL } : { x, y };
}

/** Snaps any direction to the nearest of the 8 directions (unit length), zero stays zero. */
export function snap8(v: Vec, deadzone = 0): Vec {
  const len = Math.hypot(v.x, v.y);
  if (len <= deadzone || len === 0) return { x: 0, y: 0 };
  const octant = Math.round(Math.atan2(v.y, v.x) / (Math.PI / 4));
  const angle = octant * (Math.PI / 4);
  const x = Math.round(Math.cos(angle) * 1e6) / 1e6;
  const y = Math.round(Math.sin(angle) * 1e6) / 1e6;
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/** Direction towards a point, snapped to 8 directions; zero when already there. */
export function towards(from: Vec, to: Vec, arrive = 4): Vec {
  const d = { x: to.x - from.x, y: to.y - from.y };
  return Math.hypot(d.x, d.y) <= arrive ? { x: 0, y: 0 } : snap8(d);
}

/** First non-zero of keyboard, stick and pointer input (keyboard wins). */
export function combine(...inputs: Vec[]): Vec {
  return inputs.find((v) => v.x !== 0 || v.y !== 0) ?? { x: 0, y: 0 };
}

export function speedOf(running: boolean): number {
  return WALK_SPEED * (running ? RUN_FACTOR : 1);
}

/** Turns `current` towards `target` (radians) by at most `maxStep`, the short way round. */
export function turnTowards(current: number, target: number, maxStep: number): number {
  let delta = ((target - current + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}
