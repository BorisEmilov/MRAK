/**
 * Runs the event director on the real content for N nights (docs/systems/event-director.md →
 * Implementation 9) and writes the tension curve to packages/core/sim-out/fear.csv.
 *   pnpm --filter @mrak/core simulate:fear [nights=12] [seed=1] [sanityLossPerNight=0]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IssueList, validatePack } from '@mrak/content-schema';
import { loadRawPack } from '../../content-schema/src/node/fs';
import { ContentDatabase } from '../src/content/database';
import { simulateNights } from '../src/fear/simulate';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../content');
const out = resolve(here, '../sim-out');
const nights = Number(process.argv[2] ?? 12);
const seed = Number(process.argv[3] ?? 1);
const sanityLossPerNight = Number(process.argv[4] ?? 0);

const result = validatePack(loadRawPack(root, new IssueList()));
if (!result.ok) {
  console.error('content is invalid: run pnpm content:validate');
  process.exit(1);
}
const db = new ContentDatabase(result.pack);
const sim = simulateNights(db, { seed, nights, sanityLossPerNight });
mkdirSync(out, { recursive: true });
const hhmm = (a: number): string => {
  const m = ((a % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const rows = ['night,time,phase,target,tension,outcome,event,category'];
for (const s of sim.samples)
  rows.push(
    [
      s.night,
      hhmm(s.at),
      s.phase,
      s.target,
      s.tension,
      s.outcome,
      s.event ?? '',
      s.category ?? '',
    ].join(','),
  );
writeFileSync(join(out, 'fear.csv'), `${rows.join('\n')}\n`);
for (const n of sim.nights) {
  const mix = Object.entries(n.categories)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(', ');
  console.log(
    `night ${String(n.night).padStart(2)}: ${String(n.fired)} events · peak ${String(n.peak)} (${n.peakPhase ?? '-'}) · valley after ${String(n.valleyAfterPeak)} · ${mix}`,
  );
}
const ok = sim.nights.every((n) => n.peak >= 30 && n.valleyAfterPeak <= n.peak - 15);
console.log(ok ? '✔ every night has a peak and a valley' : '✘ some night is flat');
process.exit(ok ? 0 : 1);
