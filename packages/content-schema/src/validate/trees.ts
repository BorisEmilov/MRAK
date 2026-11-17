import type { ContentTier } from '../primitives';
import type { EntityOf, SourceMap } from '../pack';
import type { IssueList } from './issues';

type Tree = EntityOf<'trees'>;

export function parseCell(cell: string): { col: number; row: number } {
  return { col: cell.charCodeAt(0) - 'A'.charCodeAt(0), row: Number(cell.slice(1)) };
}

/** Effective Revelation cost of a node: its override or its row cost. */
export function nodeCost(tree: Tree, cell: string): number | undefined {
  const node = tree.nodes.find((n) => n.cell === cell);
  if (!node) return undefined;
  return node.cost ?? tree.rowCosts[parseCell(cell).row - 1];
}

/**
 * Specialization tree rules (docs/systems/talents.md):
 * - cells inside the grid, no duplicates, prerequisites exist in the same or a lower row;
 * - no cycles; every node reachable from an entry node (no prerequisites);
 * - row 1 nodes are entry nodes; other rows must have prerequisites;
 * - costs strictly increase row by row (max of row r < min of row r+1);
 * - dark trees declare corruption per row and an unlock condition; calling trees name their calling.
 */
export function validateTree(
  tree: Tree,
  sources: SourceMap,
  issues: IssueList,
  talentTiers: ReadonlyMap<string, ContentTier>,
): void {
  const where = { file: sources.trees?.[tree.id], entity: `trees/${tree.id}` };
  const rows = tree.rowCosts.length;
  const byCell = new Map<string, Tree['nodes'][number]>();

  tree.nodes.forEach((node, i) => {
    const path = `nodes[${i}]`;
    const { col, row } = parseCell(node.cell);
    if (col >= tree.columns || row > rows) {
      issues.error(
        'tree-cell-out-of-grid',
        `cell ${node.cell} is outside the ${String(tree.columns)}×${String(rows)} grid`,
        {
          ...where,
          path,
        },
      );
    }
    if (byCell.has(node.cell))
      issues.error('tree-duplicate-cell', `cell ${node.cell} used twice`, { ...where, path });
    byCell.set(node.cell, node);
  });

  for (const [i, node] of tree.nodes.entries()) {
    const path = `nodes[${i}].requires`;
    const { row } = parseCell(node.cell);
    if (row === 1 && node.requires.length > 0) {
      issues.error('tree-row1-has-prereq', `row-1 node ${node.cell} must not have prerequisites`, {
        ...where,
        path,
      });
    }
    if (row > 1 && node.requires.length === 0) {
      issues.error(
        'tree-missing-prereq',
        `node ${node.cell} (row ${String(row)}) needs at least one prerequisite`,
        {
          ...where,
          path,
        },
      );
    }
    for (const req of node.requires) {
      if (!byCell.has(req)) {
        issues.error('tree-unknown-prereq', `node ${node.cell} requires missing cell ${req}`, {
          ...where,
          path,
        });
      } else if (parseCell(req).row > row) {
        issues.error(
          'tree-prereq-below',
          `node ${node.cell} requires ${req}, which is in a lower tier`,
          {
            ...where,
            path,
          },
        );
      }
    }
  }

  // Cycles (horizontal links within a row could form one).
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (cell: string, trail: string[]): void => {
    if (state.get(cell) === 'done') return;
    if (state.get(cell) === 'visiting') {
      issues.error('tree-cycle', `prerequisite cycle: ${[...trail, cell].join(' → ')}`, where);
      return;
    }
    state.set(cell, 'visiting');
    for (const req of byCell.get(cell)?.requires ?? [])
      if (byCell.has(req)) visit(req, [...trail, cell]);
    state.set(cell, 'done');
  };
  for (const cell of byCell.keys()) visit(cell, []);

  // Reachability: fixed point from entry nodes (a node is reachable if ANY prerequisite is).
  const reachable = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of tree.nodes) {
      if (reachable.has(node.cell)) continue;
      const entry = node.requires.length === 0 && parseCell(node.cell).row === 1;
      if (entry || node.requires.some((r) => reachable.has(r))) {
        reachable.add(node.cell);
        changed = true;
      }
    }
  }
  for (const node of tree.nodes) {
    if (!reachable.has(node.cell)) {
      issues.error('tree-unreachable', `node ${node.cell} can never be bought`, where);
    }
  }

  // Costs increase row by row.
  for (let r = 1; r < rows; r++) {
    const costsOf = (row: number): number[] =>
      tree.nodes
        .filter((n) => parseCell(n.cell).row === row)
        .map((n) => nodeCost(tree, n.cell) ?? 0);
    const current = costsOf(r);
    const next = costsOf(r + 1);
    const prevRow = tree.rowCosts[r - 1] ?? 0;
    const nextRow = tree.rowCosts[r] ?? 0;
    if (
      nextRow <= prevRow ||
      (current.length > 0 && next.length > 0 && Math.min(...next) <= Math.max(...current))
    ) {
      issues.error(
        'tree-costs-not-increasing',
        `costs must increase from row ${String(r)} to row ${String(r + 1)}`,
        {
          ...where,
          path: 'rowCosts',
        },
      );
    }
  }

  // Tiers: demo nodes need demo talents and a demo path to reach them.
  const tierOf = (cell: string): ContentTier => byCell.get(cell)?.tier ?? tree.tier;
  tree.nodes.forEach((node, i) => {
    const path = `nodes[${String(i)}]`;
    const tier = tierOf(node.cell);
    if (tree.tier === 'full' && tier === 'demo') {
      issues.error('demo-depends-on-full', `demo node ${node.cell} inside a full-game tree`, {
        ...where,
        path,
      });
    }
    if (tier === 'demo' && talentTiers.get(node.talent) === 'full') {
      issues.error(
        'demo-depends-on-full',
        `demo node ${node.cell} uses full-game talent "${node.talent}"`,
        {
          ...where,
          path,
        },
      );
    }
    if (
      tier === 'demo' &&
      node.requires.length > 0 &&
      !node.requires.some((r) => tierOf(r) === 'demo')
    ) {
      issues.error(
        'demo-depends-on-full',
        `demo node ${node.cell} is only reachable through full-game nodes`,
        {
          ...where,
          path,
        },
      );
    }
  });

  if (tree.kind === 'dark') {
    if (!tree.unlock)
      issues.error('tree-dark-unlock', 'dark trees need an "unlock" condition', where);
    if (tree.rowDebt && tree.rowDebt.length !== rows)
      issues.error('tree-dark-debt', '"rowDebt" needs one value per row', where);
    if (tree.rowDebt?.some((d) => d > 0) && !tree.debtSource)
      issues.error('tree-dark-debt', 'a tree adding debt needs a "debtSource"', where);
    if (tree.rowCorruption?.length !== rows) {
      issues.error('tree-dark-corruption', 'dark trees need "rowCorruption" for every row', where);
    }
  } else if (!tree.calling) {
    issues.error('tree-calling-missing', 'calling trees must name their "calling"', where);
  }
}
