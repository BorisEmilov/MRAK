/**
 * CI gate (docs/systems/store.md → Paid content): the public build must not contain any
 * full-tier content. Scans every text file of dist/ for the full-tier marker and for the locale
 * keys that only full content uses (texts can be shared with demo keys; keys are unique). Run after `vite build` (not for MRAK_FULL_BUILD storefront builds).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IssueList, splitByTier } from '@mrak/content-schema';
import { loadRawPack } from '../../../packages/content-schema/src/node/fs';

const dist = resolve(import.meta.dirname, '../dist');
const root = resolve(import.meta.dirname, '../../../packages/content');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const { full } = splitByTier(loadRawPack(root, new IssueList()));
const keys = Object.keys(full.locales.en);
const marker = /tier\\?["']?\s*:\s*\\?["']full/;
const leaks: string[] = [];
for (const file of files(dist).filter((f) => /\.(js|mjs|json|html|css|txt)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  if (marker.test(text)) leaks.push(`${file}: full-tier marker`);
  for (const k of keys)
    if (text.includes(`"${k}"`) || text.includes(`'${k}'`)) leaks.push(`${file}: full key ${k}`);
}
if (leaks.length > 0) {
  console.error(`✘ the public build contains full-game content:\n${leaks.slice(0, 20).join('\n')}`);
  process.exit(1);
}
console.log(`✔ public build is demo-only (${String(keys.length)} full keys checked)`);
