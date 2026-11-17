/**
 * Runs the progression simulator on the real content (docs/systems/progression.md §12) and writes
 * the curves to packages/core/sim-out/ (one CSV per profile + summary.json).
 *   pnpm --filter @mrak/core simulate [years=1] [seeds=20]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IssueList, validatePack } from '@mrak/content-schema';
import { loadRawPack } from '../../content-schema/src/node/fs';
import { ContentDatabase } from '../src/content/database';
import { compareToPlan, PROFILES, simulate, type HourSample } from '../src/guardian/simulate';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../content');
const out = resolve(here, '../sim-out');
const years = Number(process.argv[2] ?? 1);
const seeds = Number(process.argv[3] ?? 20);

const issues = new IssueList();
const result = validatePack(loadRawPack(root, issues));
if (!result.ok) {
  console.error('content is invalid: run pnpm content:validate');
  process.exit(1);
}
const db = new ContentDatabase(result.pack);
mkdirSync(out, { recursive: true });
const summary: Record<string, unknown> = {};
let failed = 0;
for (const profile of Object.values(PROFILES)) {
  const runs: HourSample[][] = [];
  for (let seed = 1; seed <= seeds; seed++) runs.push(simulate(db, { profile, seed, years }));
  const hours = runs[0]?.length ?? 0;
  const rows = ['hour,revelation,available,power,debt,corruption,talents,ranks'];
  for (let h = 0; h < hours; h++) {
    const at = runs.map((r) => r[h]).filter((s): s is HourSample => s !== undefined);
    const mean = (k: keyof HourSample) => at.reduce((s, x) => s + x[k], 0) / at.length;
    rows.push(
      [
        h,
        mean('revelation'),
        mean('available'),
        mean('power'),
        mean('debt'),
        mean('corruption'),
        mean('talents'),
        mean('ranks'),
      ]
        .map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(2)))
        .join(','),
    );
  }
  writeFileSync(join(out, `${profile.id}.csv`), `${rows.join('\n')}\n`);
  const checks = compareToPlan(profile.id, runs);
  failed += checks.filter((c) => !c.ok).length;
  summary[profile.id] = checks;
  for (const c of checks)
    console.log(
      `${c.ok ? '✔' : '✘'} ${profile.id.padEnd(12)} h${String(c.hour)} ${c.metric.padEnd(10)} ${c.value.toFixed(1).padStart(7)}  [${String(c.band[0])}–${String(c.band[1])}]`,
    );
}
writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\ncurves written to ${out}`);
process.exit(failed === 0 ? 0 : 1);
