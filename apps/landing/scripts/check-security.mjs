/* global URL, console, process */
/**
 * Build gate for the strict CSP and Mozilla-Observatory-grade headers:
 * - no inline <script>, <style>, style="" or on*="" handlers in any built page;
 * - public/_headers sets CSP (no unsafe-*, frame-ancestors 'none', base-uri, object-src), HSTS
 *   (≥ 1 year), nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP;
 * - security.txt has Contact and a future Expires.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const problems = [];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

for (const file of files(dist)) {
  if (!file.endsWith('.html')) continue;
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
    if (!/\bsrc=/.test(m[1] ?? '') || (m[2] ?? '').trim() !== '')
      problems.push(`${file}: inline <script>`);
  if (/<style\b/i.test(html)) problems.push(`${file}: inline <style>`);
  if (/\sstyle=["']/i.test(html)) problems.push(`${file}: style attribute`);
  if (/\son[a-z]+=["']/i.test(html)) problems.push(`${file}: inline event handler`);
}

const headers = readFileSync(join(dist, '_headers'), 'utf8');
const global = headers.split(/\n(?=\/)/).find((b) => b.startsWith('/*')) ?? '';
const header = (name) =>
  new RegExp(`^\\s+${name}:\\s*(.+)$`, 'im').exec(global)?.[1]?.trim() ?? null;
const csp = header('Content-Security-Policy') ?? '';
const directives = Object.fromEntries(
  csp
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .map(([k, ...v]) => [k, v]),
);
const need = (ok, what) => {
  if (!ok) problems.push(`_headers: ${what}`);
};
need(csp !== '', 'Content-Security-Policy missing');
need(!/unsafe-(inline|eval|hashes)/.test(csp), "CSP must not allow 'unsafe-*'");
// Path-specific policies (e.g. the checkout page) must stay as strict.
for (const m of headers.matchAll(/^\s+Content-Security-Policy:\s*(.+)$/gim))
  need(
    !/unsafe-(inline|eval|hashes)/.test(m[1] ?? '') && /frame-ancestors 'none'/.test(m[1] ?? ''),
    'every CSP: no unsafe-*, frame-ancestors none',
  );
need(directives['default-src']?.join(' ') === "'none'", "default-src 'none'");
need(directives['frame-ancestors']?.join(' ') === "'none'", "frame-ancestors 'none'");
need(directives['object-src']?.join(' ') === "'none'", "object-src 'none'");
need(
  ['base-uri'].every((d) => directives[d]),
  'base-uri',
);
need(directives['form-action'] !== undefined, 'form-action');
need(
  (directives['script-src'] ?? []).every((s) => s === "'self'" || s.startsWith('https://')),
  'script-src only self and https origins',
);
const hsts = /max-age=(\d+)/.exec(header('Strict-Transport-Security') ?? '');
need(hsts !== null && Number(hsts[1]) >= 31536000, 'HSTS max-age ≥ 1 year');
need(header('X-Content-Type-Options') === 'nosniff', 'X-Content-Type-Options: nosniff');
need(header('X-Frame-Options') === 'DENY', 'X-Frame-Options: DENY');
need(
  ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'].includes(
    header('Referrer-Policy') ?? '',
  ),
  'Referrer-Policy',
);
need(header('Permissions-Policy') !== null, 'Permissions-Policy');
need(header('Cross-Origin-Opener-Policy') === 'same-origin', 'COOP same-origin');

const txt = readFileSync(join(dist, '.well-known/security.txt'), 'utf8');
const expires = /^Expires:\s*(.+)$/m.exec(txt)?.[1];
need(/^Contact:\s*\S+/m.test(txt), 'security.txt Contact');
need(
  expires !== undefined && Date.parse(expires) > Date.now(),
  'security.txt Expires in the future',
);

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('security check: no inline code, headers grade A requirements met');
