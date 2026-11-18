import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRawPack } from './node/fs';
import { FullContentPack, mergeFullPack, splitByTier } from './tiers';
import { IssueList, validatePack } from './validate';

const raw = loadRawPack(resolve(__dirname, '../../content'), new IssueList());
const { demo, full } = splitByTier(raw);
const pack = FullContentPack.parse({ ...full, version: '1.0.0' });

const ids = (r: typeof raw) =>
  Object.values(r.collections)
    .flatMap((list) =>
      list.flatMap((e): unknown[] => (Array.isArray(e.data) ? (e.data as unknown[]) : [e.data])),
    )
    .map((e) => JSON.stringify(e))
    .sort();

describe('demo / full split', () => {
  it('leaves no full-tier content in the demo half, which validates on its own', () => {
    expect(JSON.stringify(demo.collections)).not.toMatch(/"tier":"full"/);
    expect(Object.keys(pack.entries).length + Object.keys(pack.files).length).toBeGreaterThan(0);
    const result = validatePack(demo);
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('moves locale keys used only by full content', () => {
    const en = demo.locales.en.data as Record<string, string>;
    expect(Object.keys(pack.locales.en).length).toBeGreaterThan(0);
    for (const key of Object.keys(pack.locales.en)) expect(en[key]).toBeUndefined();
  });

  it('demo + full pack restores the whole game', () => {
    const merged = mergeFullPack(demo, pack);
    expect(merged.locales.en.data).toEqual(raw.locales.en.data);
    const trees = (r: typeof raw) =>
      (r.collections.trees ?? []).map((t) => ({
        ...(t.data as object),
        nodes: [...(t.data as { nodes: { cell: string }[] }).nodes].sort((a, b) =>
          a.cell.localeCompare(b.cell),
        ),
      }));
    expect(trees(merged)).toEqual(trees(raw));
    const flat = (r: typeof raw) => ids({ ...r, collections: { ...r.collections, trees: [] } });
    expect(flat(merged)).toEqual(flat(raw));
    expect(validatePack(merged).ok).toBe(true);
  });
});
