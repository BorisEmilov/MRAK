/**
 * Client review gate (docs/security/test-report.md, item 9). The browser builds are public: they
 * must contain no secrets, no private keys and no paid content, and the clients must never keep
 * tokens in Web Storage. Paid content is checked by `pnpm --filter @mrak/game check:demo`.
 * Usage: node tests/security/client-build.mjs  (after building apps/game and apps/landing)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const dists = ['apps/game/dist', 'apps/landing/dist'].map((d) => join(root, d));
const sources = [
  'apps/game/src',
  'apps/landing/src',
  'packages/api-client/src',
  'packages/ui-kit/src',
];

const SECRETS = [
  ['PEM private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['private JWK', /"kty"\s*:\s*"(?:OKP|EC|RSA)"[^}]{0,400}"d"\s*:\s*"/],
  ['Paddle API key / webhook secret', /pdl_(?:live|sdbx)_apikey_|pdl_ntfset_/],
  ['Stripe secret key', /\b[rs]k_(?:live|test)_[0-9a-zA-Z]{16,}/],
  ['AWS/R2 access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['database URL with credentials', /postgres(?:ql)?:\/\/[^:\s"']+:[^@\s"']+@/],
  ['Redis URL with credentials', /rediss?:\/\/[^:\s"']*:[^@\s"']+@/],
  [
    'server secret variable',
    /\b(?:AUTH_SECRET|AUTH_JWT_KEYS|PADDLE_API_KEY|PADDLE_WEBHOOK_SECRET|R2_SECRET_ACCESS_KEY|TURNSTILE_SECRET)\b/,
  ],
];
/** Writes of token-like keys to Web Storage. */
const STORAGE =
  /(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\(\s*[^,)]{0,80}(?:token|jwt|access|refresh|session|auth)/i;

function* files(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

const problems = [];
let scanned = 0;
for (const dist of dists) {
  if (!existsSync(dist)) problems.push(`${dist}: missing (build first)`);
  for (const file of files(dist)) {
    if (!/\.(js|mjs|html|css|json|txt|map|svg|webmanifest)$/.test(file)) continue;
    scanned++;
    const text = readFileSync(file, 'utf8');
    if (file.endsWith('.map')) problems.push(`${file}: source map published`);
    for (const [what, re] of SECRETS) if (re.test(text)) problems.push(`${file}: ${what}`);
    if (STORAGE.test(text)) problems.push(`${file}: token written to Web Storage`);
  }
}
for (const src of sources)
  for (const file of files(join(root, src))) {
    if (!/\.(ts|tsx|astro|js)$/.test(file) || /\.test\./.test(file)) continue;
    if (STORAGE.test(readFileSync(file, 'utf8')))
      problems.push(`${file}: token written to Web Storage`);
  }

if (problems.length > 0) {
  console.error(`✘ client review failed:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`✔ client builds: ${String(scanned)} files, no secrets, keys or tokens in Web Storage`);
