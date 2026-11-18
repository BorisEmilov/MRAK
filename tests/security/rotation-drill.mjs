/**
 * Key rotation drill (docs/runbooks/security-incident.md → Rotate JWT keys). Run against STAGING
 * while the operator deploys AUTH_JWT_KEYS=[new, old], then [new]. It keeps one session alive:
 * GET /v1/me every second with the current access token, a refresh every 60 s. The drill passes
 * when no request fails (no 401 for a live session, no 5xx) during the whole window.
 *   node tests/security/rotation-drill.mjs  (env: API_URL, ORIGIN, EMAIL, PASSWORD, MINUTES)
 */
const API = process.env.API_URL ?? 'https://api.staging.mrak.game';
const ORIGIN = process.env.ORIGIN ?? 'https://staging.mrak.game';
const MINUTES = Number(process.env.MINUTES ?? 20);
const { EMAIL, PASSWORD } = process.env;
if (!EMAIL || !PASSWORD)
  throw new Error('EMAIL and PASSWORD of a staging test account are required');

const headers = { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-MRAK-CSRF': '1' };
let cookie = '';
const keepCookie = (res) => {
  const set = res.headers.getSetCookie().find((c) => c.startsWith('__Secure-mrak_rt='));
  if (set) cookie = set.split(';')[0];
};

const login = await fetch(`${API}/v1/auth/login`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!login.ok) throw new Error(`login failed: ${String(login.status)}`);
keepCookie(login);
let access = (await login.json()).accessToken;

const failures = [];
let requests = 0;
const end = Date.now() + MINUTES * 60_000;
let nextRefresh = Date.now() + 60_000;
while (Date.now() < end) {
  if (Date.now() >= nextRefresh) {
    const r = await fetch(`${API}/v1/auth/refresh`, {
      method: 'POST',
      headers: { ...headers, Cookie: cookie },
    });
    requests++;
    if (r.ok) {
      keepCookie(r);
      access = (await r.json()).accessToken;
    } else failures.push(`${new Date().toISOString()} refresh ${String(r.status)}`);
    nextRefresh = Date.now() + 60_000;
  }
  const me = await fetch(`${API}/v1/me`, { headers: { Authorization: `Bearer ${access}` } });
  requests++;
  if (!me.ok) failures.push(`${new Date().toISOString()} /v1/me ${String(me.status)}`);
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`${String(requests)} requests, ${String(failures.length)} failures`);
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('✔ rotation drill: the session never broke');
