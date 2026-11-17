import { describe, expect, it } from 'vitest';
import { directionTo, patrolAround } from './alerts';

describe('night alerts', () => {
  it('points toward the village exit', () => {
    expect(directionTo(10, 500)).toBe('left');
    expect(directionTo(900, 500)).toBe('right');
    expect(directionTo(510, 500)).toBe('center');
    expect(directionTo(null, 500)).toBe('center');
  });
  it('patrols a loop around the spawn', () => {
    expect(patrolAround(5, 5)).toHaveLength(4);
  });
});
