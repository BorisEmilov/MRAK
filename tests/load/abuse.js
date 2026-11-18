/* global __ENV */
// k6 abuse simulation against a staging online-api (never production).
//   k6 run -e BASE_URL=https://api.staging.mrak.game tests/load/abuse.js
// With a staging test account (verified, no purchases) also the signed-in abuse scenarios:
//   -e TOKEN=<access token> -e REFRESH=<refresh cookie value> -e ORIGIN=https://staging.mrak.game
// Scenarios hammer the abuse-prone routes from many fake IPs. Success = the API sheds the load
// with 429/503 quickly, legitimate reads stay fast, and the database never becomes the
// bottleneck (health latency and 5xx stay low). Watch Postgres CPU/connections while it runs:
// connections must stay ≤ instances × DB_POOL_MAX.
import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const TOKEN = __ENV.TOKEN || '';
const REFRESH = __ENV.REFRESH || '';
const ORIGIN = __ENV.ORIGIN || 'https://mrak.game';
const rate = (exec, perSecond, vus = perSecond) => ({
  executor: 'constant-arrival-rate',
  exec,
  rate: perSecond,
  timeUnit: '1s',
  duration: '2m',
  preAllocatedVUs: vus,
});
const shed = new Rate('abuse_shed'); // share of abusive requests answered 429/503
const serverErrors = new Rate('server_errors');
const healthLatency = new Trend('health_latency', true);

export const options = {
  scenarios: {
    credential_stuffing: {
      executor: 'constant-arrival-rate',
      exec: 'stuffing',
      rate: 200,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 100,
    },
    signup_bots: {
      executor: 'constant-arrival-rate',
      exec: 'signup',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 50,
    },
    email_bombing: {
      executor: 'constant-arrival-rate',
      exec: 'bomb',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 50,
    },
    forged_tokens: {
      executor: 'constant-arrival-rate',
      exec: 'forged',
      rate: 200,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 100,
    },
    giant_bodies: {
      executor: 'constant-arrival-rate',
      exec: 'giant',
      rate: 20,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 20,
    },
    login_spike: {
      // Burst of logins from many IPs in 30 s (C-04/C-05): throttled, never 5xx.
      executor: 'ramping-arrival-rate',
      exec: 'stuffing',
      startRate: 10,
      timeUnit: '1s',
      stages: [
        { target: 1000, duration: '15s' },
        { target: 10, duration: '15s' },
      ],
      preAllocatedVUs: 300,
      startTime: '2m',
    },
    refresh_loop: rate('refreshLoop', 100),
    ...(TOKEN
      ? {
          save_uploads: rate('saveUpload', 20),
          signed_urls: rate('signedUrl', 50),
        }
      : {}),
    legit_health: {
      executor: 'constant-arrival-rate',
      exec: 'health',
      rate: 5,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 5,
    },
  },
  thresholds: {
    // The database stays healthy: health answers fast throughout the attack.
    health_latency: ['p(95)<300'],
    // Abuse is shed, not served.
    abuse_shed: ['rate>0.8'],
    // No meltdown: (almost) no 5xx other than the controlled 503s.
    server_errors: ['rate<0.01'],
    http_req_duration: ['p(99)<2000'],
  },
};

const ips = 50; // a small botnet: the app keys on X-Forwarded-For behind the test proxy
const ip = () => `198.18.${Math.floor(Math.random() * ips)}.${Math.floor(Math.random() * 250) + 1}`;
const headers = (extra = {}) => ({
  'Content-Type': 'application/json',
  'X-MRAK-CSRF': '1',
  'X-Forwarded-For': ip(),
  ...extra,
});

function record(res, abusive) {
  serverErrors.add(res.status >= 500 && res.status !== 503);
  if (abusive) shed.add(res.status === 429 || res.status === 503 || res.status === 413);
}

export function stuffing() {
  const res = http.post(
    `${BASE}/v1/auth/login`,
    JSON.stringify({
      email: `victim${Math.floor(Math.random() * 20)}@example.com`,
      password: 'Summer2026!Summer',
    }),
    { headers: headers() },
  );
  record(res, true);
}

export function signup() {
  const res = http.post(
    `${BASE}/v1/auth/register`,
    JSON.stringify({
      email: `bot${Date.now()}${Math.random()}@example.com`,
      password: 'a long bot password',
      captcha: 'forged',
    }),
    { headers: headers() },
  );
  // Without a valid Turnstile token signups are refused (400) — that is also "shed".
  serverErrors.add(res.status >= 500 && res.status !== 503);
  shed.add(res.status !== 202);
}

export function bomb() {
  const res = http.post(
    `${BASE}/v1/auth/forgot-password`,
    JSON.stringify({ email: 'target@example.com', captcha: 'forged' }),
    { headers: headers() },
  );
  serverErrors.add(res.status >= 500 && res.status !== 503);
  shed.add(res.status !== 202);
}

export function forged() {
  const res = http.get(`${BASE}/v1/me`, {
    headers: {
      Authorization: 'Bearer eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.AAAA',
      'X-Forwarded-For': ip(),
    },
  });
  serverErrors.add(res.status >= 500);
  shed.add(res.status === 401 || res.status === 429);
}

export function giant() {
  const res = http.post(`${BASE}/v1/auth/login`, 'x'.repeat(64 * 1024), { headers: headers() });
  record(res, true);
}

// Refresh in a loop: forged cookies (fail closed) and, with REFRESH, a real session whose
// per-session policy (refresh-session 30/h) must cut it off.
export function refreshLoop() {
  const cookie = REFRESH && Math.random() < 0.5 ? REFRESH : `forged${String(Math.random())}`;
  const res = http.post(`${BASE}/v1/auth/refresh`, null, {
    headers: headers({ Cookie: `__Secure-mrak_rt=${cookie}`, Origin: ORIGIN }),
  });
  serverErrors.add(res.status >= 500 && res.status !== 503);
  shed.add(res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503);
}

// Cloud save uploads near the size cap: save-upload-user 30/h, then 429; no 5xx.
const saveBody = JSON.stringify({
  meta: {},
  data: 'x'.repeat(1024 * 1024),
  checksum: '0'.repeat(64),
});
export function saveUpload() {
  const res = http.put(`${BASE}/v1/saves/slot-1`, saveBody, {
    headers: headers({ Authorization: `Bearer ${TOKEN}`, 'If-None-Match': '*' }),
  });
  record(res, true);
  shed.add(res.status === 400 || res.status === 412 || res.status === 429);
}

// Signed full-pack URLs: no entitlement → 403; quota content-url-user 30/day → 429.
export function signedUrl() {
  const res = http.post(`${BASE}/v1/content/full`, '{}', {
    headers: headers({ Authorization: `Bearer ${TOKEN}` }),
  });
  serverErrors.add(res.status >= 500 && res.status !== 503);
  shed.add(res.status === 403 || res.status === 429);
}

export function health() {
  const res = http.get(`${BASE}/health`, { headers: { 'X-Forwarded-For': '203.0.113.10' } });
  healthLatency.add(res.timings.duration);
  check(res, { 'health 200': (r) => r.status === 200 });
}
