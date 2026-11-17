/**
 * A* over the tile grid for villagers (docs/systems/villagers.md → Presentation): 8 directions,
 * octile distance, no cutting corners past solid tiles. Pure and unit-tested.
 */

export interface Tile {
  x: number;
  y: number;
}

export interface Grid {
  cols: number;
  rows: number;
  blocked(x: number, y: number): boolean;
}

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

function solid(grid: Grid, x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= grid.cols || y >= grid.rows || grid.blocked(x, y);
}

function octile(a: Tile, b: Tile): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

/** Min-heap of node indices by f score. */
class Heap {
  private readonly items: number[] = [];
  constructor(private readonly score: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(n: number): void {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.score[a[p] ?? 0] ?? 0) <= (this.score[n] ?? 0)) break;
      a[i] = a[p] ?? 0;
      i = p;
    }
    a[i] = n;
  }
  pop(): number {
    const a = this.items;
    const top = a[0] ?? -1;
    const last = a.pop() ?? -1;
    if (a.length > 0) {
      let i = 0;
      const s = this.score[last] ?? 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let ms = s;
        if (l < a.length && (this.score[a[l] ?? 0] ?? 0) < ms) {
          m = l;
          ms = this.score[a[l] ?? 0] ?? 0;
        }
        if (r < a.length && (this.score[a[r] ?? 0] ?? 0) < ms) m = r;
        if (m === i) break;
        a[i] = a[m] ?? 0;
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

/** The free tile nearest to `p` (itself if free), searching rings up to `radius`. */
export function nearestFree(grid: Grid, p: Tile, radius = 6): Tile | null {
  if (!solid(grid, p.x, p.y)) return p;
  for (let r = 1; r <= radius; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!solid(grid, p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy };
      }
  return null;
}

/**
 * Shortest path from `start` to `goal` (both included), or null. A blocked goal is replaced by
 * the nearest free tile; `maxNodes` bounds the work per search.
 */
export function findPath(grid: Grid, start: Tile, goal: Tile, maxNodes = 6000): Tile[] | null {
  const from = nearestFree(grid, start);
  const to = nearestFree(grid, goal);
  if (!from || !to) return null;
  const { cols } = grid;
  const total = cols * grid.rows;
  const g = new Float64Array(total).fill(Infinity);
  const f = new Float64Array(total).fill(Infinity);
  const came = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const index = (t: Tile): number => t.y * cols + t.x;
  const startIdx = index(from);
  const goalIdx = index(to);
  g[startIdx] = 0;
  f[startIdx] = octile(from, to);
  const open = new Heap(f);
  open.push(startIdx);
  let expanded = 0;
  while (open.size > 0 && expanded < maxNodes) {
    const cur = open.pop();
    if (cur === goalIdx) {
      const path: Tile[] = [];
      for (let n = cur; n !== -1; n = came[n] ?? -1)
        path.push({ x: n % cols, y: Math.floor(n / cols) });
      return path.reverse();
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded += 1;
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (solid(grid, nx, ny)) continue;
      // Diagonals only when both orthogonal neighbours are free (no squeezing past corners).
      if (dx !== 0 && dy !== 0 && (solid(grid, cx + dx, cy) || solid(grid, cx, cy + dy))) continue;
      const n = ny * cols + nx;
      if (closed[n]) continue;
      const tentative = (g[cur] ?? Infinity) + cost;
      if (tentative < (g[n] ?? Infinity)) {
        g[n] = tentative;
        f[n] = tentative + octile({ x: nx, y: ny }, to);
        came[n] = cur;
        open.push(n);
      }
    }
  }
  return null;
}

/** Drops intermediate tiles that keep the same direction (fewer waypoints to walk). */
export function simplify(path: readonly Tile[]): Tile[] {
  if (path.length <= 2) return [...path];
  const out: Tile[] = [path[0] as Tile];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1] as Tile;
    const b = path[i] as Tile;
    const c = path[i + 1] as Tile;
    if (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y) out.push(b);
  }
  out.push(path[path.length - 1] as Tile);
  return out;
}

/** A grid from a row-major solid mask plus extra blocked tiles (closed paths). */
export function gridOf(
  cols: number,
  rows: number,
  solidMask: Uint8Array,
  extra?: (x: number, y: number) => boolean,
): Grid {
  return {
    cols,
    rows,
    blocked: (x, y) => solidMask[y * cols + x] === 1 || (extra?.(x, y) ?? false),
  };
}
