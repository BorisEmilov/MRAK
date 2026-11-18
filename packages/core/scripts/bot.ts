/**
 * Headless play bot over the real content (docs/systems/testing.md → Bot).
 *   pnpm --filter @mrak/core bot [nights=12] [seeds=50]
 * Exits 1 on any exception, soft-lock or impossible state.
 */
import { IssueList, validatePack } from '@mrak/content-schema';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRawPack } from '../../content-schema/src/node/fs';
import { playBot } from '../src/bot/bot';
import { ContentDatabase } from '../src/content/database';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../content');
const nights = Number(process.argv[2] ?? 12);
const seeds = Number(process.argv[3] ?? 50);
const result = validatePack(loadRawPack(root, new IssueList()));
if (!result.ok) {
  console.error('content is invalid: run pnpm content:validate');
  process.exit(1);
}
const db = new ContentDatabase(result.pack);
const started = Date.now();
let failed = 0;
const totals = { commands: 0, rejected: 0, deaths: 0, heirs: 0, endings: 0, events: 0 };
for (let seed = 1; seed <= seeds; seed++) {
  const r = playBot(db, { seed, nights });
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
  if (r.problems.length > 0) {
    failed++;
    for (const p of r.problems) console.error(`✘ ${p}`);
  }
}
console.log(
  `${failed === 0 ? '✔' : '✘'} bot: ${String(seeds)} seeds × ${String(nights)} nights, ${String(failed)} failed · ${JSON.stringify(totals)} · ${String(Date.now() - started)} ms`,
);
process.exit(failed === 0 ? 0 : 1);
