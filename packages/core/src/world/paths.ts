/**
 * Shifting paths (docs/systems/night-exploration.md → Implementation). Which edges of a zone's
 * path graph are open is a pure function of the content, the state (through `evaluate`), the
 * chronicle seed and the in-world time. It never draws from the game's RNG streams.
 */
import type { Condition, PathGraph } from '@mrak/content-schema';
import { hash32 } from '../random';
import type { DayPhase } from '../time/calendar';

/** Chance per in-world hour that a shifting group moves at night. */
export const SHIFT_CHANCE = 0.3;

export interface PathContext {
  /** Chronicle seed. */
  seed: number;
  zone: string;
  day: number;
  minute: number;
  phase: DayPhase;
  /** Evaluates an edge's `when` against the current state. */
  evaluate: (condition: Condition) => boolean;
}

/** A night runs noon → noon: the night it belongs to (JDN of its evening) and hours since noon. */
export function nightClock(day: number, minute: number): { night: number; hour: number } {
  return minute >= 720
    ? { night: day, hour: Math.floor((minute - 720) / 60) }
    : { night: day - 1, hour: Math.floor((minute + 720) / 60) };
}

function unit(...parts: readonly (string | number)[]): number {
  return hash32(parts.join(':')) / 0x100000000;
}

/** Shift groups in content order: group → its edge ids. */
function groupsOf(graph: PathGraph): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!e.shift) continue;
    const list = groups.get(e.shift) ?? [];
    list.push(e.id);
    groups.set(e.shift, list);
  }
  return groups;
}

/** The chosen edge of every shift group: the first by day; seeded and re-chosen hourly at night. */
export function shiftChoices(graph: PathGraph, ctx: PathContext): Map<string, string> {
  const choices = new Map<string, string>();
  const { night, hour } = nightClock(ctx.day, ctx.minute);
  for (const [group, edges] of groupsOf(graph)) {
    if (ctx.phase !== 'night') {
      choices.set(group, edges[0] ?? '');
      continue;
    }
    const n = edges.length;
    const key = [ctx.seed >>> 0, ctx.zone, group, night] as const;
    let index = Math.floor(unit(...key, 'start') * n);
    for (let h = 1; h <= hour; h++) {
      if (unit(...key, h, 'move') < SHIFT_CHANCE)
        index = (index + 1 + Math.floor(unit(...key, h, 'to') * (n - 1))) % n;
    }
    choices.set(group, edges[index] ?? edges[0] ?? '');
  }
  return choices;
}

/** Nodes that can reach an exit through `open` edges (undirected). */
export function reachableFromExits(graph: PathGraph, open: ReadonlySet<string>): Set<string> {
  const adjacent = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!open.has(e.id)) continue;
    adjacent.set(e.from, [...(adjacent.get(e.from) ?? []), e.to]);
    adjacent.set(e.to, [...(adjacent.get(e.to) ?? []), e.from]);
  }
  const seen = new Set(graph.nodes.filter((n) => n.exit).map((n) => n.id));
  const queue = [...seen];
  while (queue.length > 0) {
    const node = queue.pop() ?? '';
    for (const next of adjacent.get(node) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return seen;
}

/** The open edges of a zone right now, guaranteeing every node can still reach an exit. */
export function openPaths(graph: PathGraph, ctx: PathContext): Set<string> {
  const choices = shiftChoices(graph, ctx);
  const when = new Map(
    graph.edges.map((e) => [e.id, e.when === undefined ? true : ctx.evaluate(e.when)]),
  );
  const compute = (): Set<string> =>
    new Set(
      graph.edges
        .filter((e) => (e.shift ? choices.get(e.shift) === e.id : true) && when.get(e.id) === true)
        .map((e) => e.id),
    );

  let open = compute();
  const total = graph.nodes.length;
  if (reachableFromExits(graph, open).size === total) return open;

  // Repair: re-choose shift groups (in order) until every node reaches an exit.
  for (const [group, edges] of groupsOf(graph)) {
    let best = choices.get(group) ?? '';
    let bestReach = reachableFromExits(graph, open).size;
    for (const candidate of edges) {
      choices.set(group, candidate);
      const reach = reachableFromExits(graph, compute()).size;
      if (reach > bestReach) {
        best = candidate;
        bestReach = reach;
      }
    }
    choices.set(group, best);
    open = compute();
    if (bestReach === total) break;
  }
  return open;
}
