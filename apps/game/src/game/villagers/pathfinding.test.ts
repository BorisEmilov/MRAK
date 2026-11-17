import { describe, expect, it } from 'vitest';
import { findPath, gridOf, nearestFree, simplify, type Tile } from './pathfinding';

/** Builds a grid from ASCII rows: '#' solid, anything else free. */
function grid(rows: string[]) {
  const cols = rows[0]?.length ?? 0;
  const mask = new Uint8Array(cols * rows.length);
  rows.forEach((r, y) => {
    Array.from(r).forEach((c, x) => {
      if (c === '#') mask[y * cols + x] = 1;
    });
  });
  return gridOf(cols, rows.length, mask);
}

const cost = (path: readonly Tile[]): number =>
  path.slice(1).reduce((sum, t, i) => {
    const p = path[i] as Tile;
    return sum + (t.x !== p.x && t.y !== p.y ? Math.SQRT2 : 1);
  }, 0);

describe('findPath', () => {
  it('walks straight on open ground and diagonally when shorter', () => {
    const g = grid(['.....', '.....', '.....']);
    expect(findPath(g, { x: 0, y: 1 }, { x: 4, y: 1 })).toHaveLength(5);
    const diag = findPath(g, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(diag).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it('goes around walls and never cuts a corner', () => {
    const g = grid(['.....', '.###.', '.....']);
    const path = findPath(g, { x: 0, y: 1 }, { x: 4, y: 1 });
    expect(path).not.toBeNull();
    for (const t of path ?? []) expect(g.blocked(t.x, t.y)).toBe(false);
    const corner = grid(['.#', '..']);
    // (0,0) → (1,1) must not squeeze diagonally past the solid (1,0).
    expect(findPath(corner, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('finds an optimal path through a doorway', () => {
    const g = grid(['.........', '####.####', '.........']);
    const path = findPath(g, { x: 0, y: 0 }, { x: 8, y: 2 }) ?? [];
    expect(path.some((t) => t.x === 4 && t.y === 1)).toBe(true);
    // No corner cutting: the doorway is entered and left straight (4 + 1 + 1 + 4).
    expect(cost(path)).toBeCloseTo(10);
  });

  it('returns null when walled off, and retargets a solid goal to the nearest free tile', () => {
    const g = grid(['..#..', '..#..', '..#..']);
    expect(findPath(g, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
    const open = grid(['.....', '..#..', '.....']);
    const path = findPath(open, { x: 0, y: 1 }, { x: 2, y: 1 }) ?? [];
    expect(path.at(-1)).not.toEqual({ x: 2, y: 1 });
    expect(nearestFree(open, { x: 2, y: 1 })).not.toBeNull();
  });

  it('respects extra blocked tiles (closed paths) and the node budget', () => {
    const mask = new Uint8Array(5 * 3);
    const g = gridOf(5, 3, mask, (x) => x === 2);
    expect(findPath(g, { x: 0, y: 1 }, { x: 4, y: 1 })).toBeNull();
    const big = grid(Array.from({ length: 60 }, () => '.'.repeat(80)));
    expect(findPath(big, { x: 0, y: 0 }, { x: 79, y: 59 }, 10)).toBeNull();
    expect(findPath(big, { x: 0, y: 0 }, { x: 79, y: 59 })).not.toBeNull();
  });
});

describe('simplify', () => {
  it('keeps only the turns', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 1 },
      { x: 4, y: 2 },
    ];
    expect(simplify(path)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 2 },
    ]);
  });
});
