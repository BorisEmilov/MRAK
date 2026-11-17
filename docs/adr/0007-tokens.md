# ADR 0007 — Access and refresh tokens

- Status: accepted (implemented in `services/online-api/src/auth`)
- Date: 2026-11-17
- Back to [threat model](../security/threat-model.md) · controls C-04 … C-16, C-35 … C-37, C-42

## Context

The game is a static SPA on `play.mrak.game`, the landing on `mrak.game`, the API on
`api.mrak.game` (one registrable domain). Desktop/mobile shells (Tauri/Capacitor, phase 34) cannot
rely on browser cookies. CLAUDE.md requires short-lived EdDSA access tokens, opaque rotated
refresh tokens stored as hashes with reuse detection, the refresh token in an HttpOnly Secure
SameSite cookie in browsers and the access token in memory only.

## Decision

- **Access token:** JWT signed with Ed25519 (`alg: EdDSA`, header `typ: at+jwt`, `kid`), TTL
  **10 min**, claims `sub`, `sid`, `iat`, `exp`, `iss`, `aud`, `jti` only. Verification pins the
  algorithm list to `EdDSA`, requires `iss`, `aud`, `typ` and all claims, resolves the key by
  `kid` from the local key set (unknown `kid` → 401) and checks the session row is not revoked.
  Keys: `AUTH_JWT_KEYS` (secret store) holds ≤ 4 private JWKs; the first signs, all verify; the
  public set is served at `GET /.well-known/jwks.json`. Rotation: add the new key second → deploy →
  move it first → after 10 min drop the old one.
- **Refresh token:** 32 random bytes (base64url), stored only as SHA-256 hex. One family per
  session. **Sliding 30 days, absolute 90 days** from session creation. Every use rotates it (the
  used row gets `usedAt`/`replacedById`; a conditional update guarantees only one concurrent
  rotation wins). A used token presented again ⇒ the session and every token of the family are
  revoked, an audit row `refresh-reuse/blocked` is written and the user is emailed. No grace
  window.
- **Browsers:** cookie `__Secure-mrak_rt`; `HttpOnly; Secure; SameSite=Strict; Path=/v1/auth;
Domain=mrak.game; Max-Age` = remaining sliding life. Every `/v1/auth/*` POST requires
  `X-MRAK-CSRF: 1` (forces a CORS preflight); a present `Origin` must be in the exact allow-list,
  and cookie-bearing requests must send one. CORS credentials only on `/v1/auth`.
- **Native platforms** (`platform: desktop | android | ios` at login): no cookie; the refresh
  token travels in the JSON body and is kept in the OS secure store (phase 34).
- **Revocation:** `logout` revokes its session; `logout-all`, password change, password reset and
  account deletion revoke all sessions. Access tokens die with their session immediately because
  every authenticated request checks the session row.
- **Client** (`packages/api-client` `createAccountClient`): token in a closure, never Web Storage
  or IndexedDB; one refresh on 401; `resume()` at startup.

Endpoints (`/v1`): `auth/register`, `auth/verify-email`, `auth/resend-verification`, `auth/login`,
`auth/refresh`, `auth/logout`, `auth/logout-all`, `auth/forgot-password`, `auth/reset-password`,
`GET|PATCH /me`, `GET /me/sessions`, `DELETE /me/sessions/:id`, `POST /me/change-password`,
`GET /me/export`, `DELETE /me`, `GET /.well-known/jwks.json`, `GET /health`. Spec:
`services/online-api/openapi.json` (generated).

## Consequences

- ✔ XSS cannot read the refresh token; a stolen access token is useless after logout.
- ✔ Theft of a refresh token is detected on the next legitimate use (both parties lose it).
- ✘ One DB read per authenticated request (session check) and one write per refresh.
- ✘ Two tabs refreshing at the same instant: one wins, the other looks like reuse and signs the
  user out. The client serialises refreshes per tab; cross-tab coordination (BroadcastChannel) is
  a follow-up.

## Alternatives considered

- Server sessions with a cookie on every request: CSRF protection on every route; rejected.
- Long-lived JWT refresh tokens: cannot be revoked or rotated with reuse detection; rejected.
- A reuse grace window: tolerates two-tab races but weakens detection; rejected for now.
