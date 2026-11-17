/**
 * Creature AI (docs/systems/night-exploration.md → Implementation): a pure state machine —
 * patrol, suspicious, hunt, flee light — driven by what the creature hears (noise) and sees
 * (distance, the lantern). Distances in tiles, time in seconds. The scene calls it every frame.
 */
import type { Creature } from '@mrak/content-schema';

export type CreatureMode = 'patrol' | 'suspicious' | 'hunt' | 'flee';

export interface Vec {
  x: number;
  y: number;
}

export interface CreatureAgent {
  mode: CreatureMode;
  pos: Vec;
  /** Where it goes: a patrol point, the last noise heard, the guardian. */
  target: Vec | null;
  /** Seconds left in the current mode (flee, suspicious wait, hunt memory). */
  timer: number;
  patrolIndex: number;
}

export interface Senses {
  guardian: Vec;
  /** Noise the guardian makes now (0–10). */
  noise: number;
  /** Lantern light radius in tiles (0 when unlit). */
  light: number;
  /** A lantern flash this frame. */
  flash: boolean;
}

export type CreatureAi = Creature['ai'];

const FLEE_SECONDS = 4;
const SUSPICIOUS_SECONDS = 3;
const ARRIVED = 0.3;

const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

function moveToward(pos: Vec, to: Vec, step: number): Vec {
  const d = dist(pos, to);
  if (d <= step || d === 0) return { ...to };
  return { x: pos.x + ((to.x - pos.x) / d) * step, y: pos.y + ((to.y - pos.y) / d) * step };
}

function moveAway(pos: Vec, from: Vec, step: number): Vec {
  const d = dist(pos, from) || 1;
  return { x: pos.x + ((pos.x - from.x) / d) * step, y: pos.y + ((pos.y - from.y) / d) * step };
}

export function newAgent(pos: Vec): CreatureAgent {
  return { mode: 'patrol', pos: { ...pos }, target: null, timer: 0, patrolIndex: 0 };
}

/** What the creature perceives this frame. */
export function perceive(agent: CreatureAgent, ai: CreatureAi, s: Senses) {
  const d = dist(agent.pos, s.guardian);
  // A lit lantern lets it see the guardian from farther; darkness hides all but the closest.
  const sight = s.light > 0 ? ai.sight + s.light : ai.sight / 2;
  return {
    distance: d,
    hears: s.noise > 0 && d <= s.noise * ai.hearing,
    sees: d <= sight,
    inLight: ai.fleeLight && (s.flash || (s.light > 0 && d <= s.light + 0.5)),
  };
}

/** One step of the state machine. Returns the new agent (the input is not changed). */
export function stepCreature(
  agent: CreatureAgent,
  ai: CreatureAi,
  senses: Senses,
  dt: number,
  patrol: readonly Vec[],
): CreatureAgent {
  const p = perceive(agent, ai, senses);
  const next: CreatureAgent = { ...agent, pos: { ...agent.pos } };
  const step = ai.speed * dt;

  if (p.inLight) {
    next.mode = 'flee';
    next.timer = FLEE_SECONDS;
  }
  switch (next.mode) {
    case 'flee':
      next.pos = moveAway(next.pos, senses.guardian, step * 1.5);
      next.timer -= dt;
      if (next.timer <= 0) {
        next.mode = 'suspicious';
        next.target = { ...senses.guardian };
        next.timer = SUSPICIOUS_SECONDS;
      }
      return next;
    case 'hunt':
      if (p.sees || p.hears) {
        next.target = { ...senses.guardian };
        next.timer = ai.memory;
      } else next.timer -= dt;
      if (next.timer <= 0) {
        next.mode = 'suspicious';
        next.timer = SUSPICIOUS_SECONDS;
      }
      if (next.target) next.pos = moveToward(next.pos, next.target, step);
      return next;
    case 'suspicious':
      if (p.sees) {
        next.mode = 'hunt';
        next.target = { ...senses.guardian };
        next.timer = ai.memory;
        return next;
      }
      // It follows the noise.
      if (p.hears) next.target = { ...senses.guardian };
      if (next.target && dist(next.pos, next.target) > ARRIVED)
        next.pos = moveToward(next.pos, next.target, step * 0.7);
      else {
        next.timer -= dt;
        if (next.timer <= 0) {
          next.mode = 'patrol';
          next.target = null;
        }
      }
      return next;
    case 'patrol': {
      if (p.sees) {
        next.mode = 'hunt';
        next.target = { ...senses.guardian };
        next.timer = ai.memory;
        return next;
      }
      if (p.hears) {
        next.mode = 'suspicious';
        next.target = { ...senses.guardian };
        next.timer = SUSPICIOUS_SECONDS;
        return next;
      }
      const point = patrol[next.patrolIndex % Math.max(1, patrol.length)];
      if (!point) return next;
      next.pos = moveToward(next.pos, point, step * 0.5);
      if (dist(next.pos, point) <= ARRIVED)
        next.patrolIndex = (next.patrolIndex + 1) % patrol.length;
      return next;
    }
  }
}
