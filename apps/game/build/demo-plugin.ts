/**
 * Vite plugin: the public build ships only the demo half of the content (docs/systems/store.md →
 * Paid content). Full-tier entries, files, tree nodes and their locale keys are removed from the
 * bundled JSON; they reach players only as the signed full pack. `MRAK_FULL_BUILD=1` keeps them
 * (storefront builds such as Steam, where the store itself is the entitlement).
 */
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
// Relative imports: the Vite config bundles these sources (the package entry is TS-only).
import { loadRawPack } from '../../../packages/content-schema/src/node/fs';
import { splitByTier } from '../../../packages/content-schema/src/tiers';
import { IssueList } from '../../../packages/content-schema/src/validate';

export const CONTENT_ROOT = resolve(import.meta.dirname, '../../../packages/content');

/** Demo JSON by absolute file path (null: the whole file is full-tier). */
export function demoFiles(root = CONTENT_ROOT): Map<string, unknown> {
  const raw = loadRawPack(root, new IssueList());
  const { demo } = splitByTier(raw);
  const out = new Map<string, unknown>();
  for (const list of Object.values(raw.collections))
    for (const e of list) out.set(resolve(root, e.file), null);
  for (const list of Object.values(demo.collections))
    for (const e of list) out.set(resolve(root, e.file), e.data);
  out.set(resolve(root, 'locales/en.json'), demo.locales.en.data);
  return out;
}

export function demoPlugin(): Plugin {
  let files = new Map<string, unknown>();
  return {
    name: 'mrak-demo-content',
    apply: (_config, env) => env.command === 'build' && process.env['MRAK_FULL_BUILD'] !== '1',
    enforce: 'pre',
    buildStart() {
      files = demoFiles();
    },
    transform(_code, id) {
      const path = id.split('?')[0] ?? id;
      if (!files.has(path)) return null;
      return { code: JSON.stringify(files.get(path)), map: null };
    },
  };
}
