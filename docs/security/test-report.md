# Security test report

Status of automated security testing and reviews. Update it after each pipeline change, each
staging campaign and each incident. Related: [threat model](threat-model.md),
[ASVS L2 checklist](asvs-checklist.md), [API Top 10](api-top10.md),
[incident runbook](../runbooks/security-incident.md).

Last update: 2026-11-18 · Scope: `services/online-api`, `services/studio-api`, `apps/game`,
`apps/landing`, containers, CI.

## Pipeline

| #   | Check                                                                       | Where                                                                                   | Blocking                         | Status (2026-11-18)                                                                           |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| 1a  | CodeQL `security-extended` (JS/TS)                                          | `security.yml` → codeql                                                                 | ruleset: code scanning high+     | ⏳ first run on GitHub                                                                        |
| 1b  | Semgrep (Node, Express, React, TS, JWT)                                     | `security.yml` → semgrep                                                                | yes (`--error`, severity ERROR)  | ⏳ first run on GitHub                                                                        |
| 1c  | ESLint `eslint-plugin-security` + XSS sinks                                 | `eslint.config.js` (in `pnpm lint`, ci.yml)                                             | yes (`--max-warnings=0`)         | ✅ green locally. 11 findings reviewed as false positives and justified inline (see below)    |
| 2a  | `pnpm audit --prod --audit-level high`                                      | `security.yml` → dependencies                                                           | yes                              | ✅ green, 1 documented exception                                                              |
| 2b  | OSV-Scanner (whole lockfile)                                                | `security.yml` → dependencies (`osv-scanner.toml`)                                      | yes                              | ⏳ first run on GitHub; 4 documented exceptions                                               |
| 2c  | Renovate (7-day release age, security PRs)                                  | `renovate.json`                                                                         | —                                | ⏳ install the Renovate app on the repository                                                 |
| 3   | gitleaks: pre-commit + full history                                         | `.husky/pre-commit`, ci.yml → secrets                                                   | yes                              | ✅                                                                                            |
| 4   | Trivy image + config; hardening probe                                       | `security.yml` → containers                                                             | yes (HIGH/CRITICAL with a fix)   | ⏳ needs Docker (not available locally); compose validated                                    |
| 5   | Security tests (phases 21, 23–25, 27)                                       | `security.yml` → security-tests (`pnpm --filter @mrak/online-api test:security`, tiers) | yes                              | ✅ 101 tests in 11 files + 3 tier tests green                                                 |
| 6   | OWASP ZAP baseline (site, game) + API scan                                  | `security-staging.yml`                                                                  | yes (warnings fail)              | ⏳ needs a staging environment                                                                |
| 7   | Schemathesis fuzzing (OpenAPI)                                              | `security-staging.yml` → fuzz                                                           | yes (no 5xx, schema conformance) | ⏳ needs staging                                                                              |
| 8   | k6 load and abuse                                                           | `security-staging.yml` → load-abuse (`tests/load/abuse.js`)                             | yes (k6 thresholds)              | ⏳ needs staging                                                                              |
| 9   | Client review: secrets, keys, Web Storage tokens, source maps, paid content | ci.yml build (`tests/security/client-build.mjs`, game `check:demo`)                     | yes                              | ✅ 63 files clean. Verified to fail on a planted key and on a token written to `localStorage` |

Staging runs after every successful `staging` deployment (`deployment_status`), weekly, and on
demand. They need the repository variables `STAGING_SITE_URL`, `STAGING_PLAY_URL` and
`STAGING_API_URL`, and the secrets `STAGING_K6_TOKEN` and `STAGING_K6_REFRESH` (a verified test
account with no purchases).

**Making it blocking.** In the `main` ruleset, mark these as required status checks: `CI / *`,
`Security / *`, and "Code scanning results: CodeQL, Semgrep — security alerts High or higher".

## Covered by the security tests (item 5)

| Phase | Area                      | Tests                                                                                                                                                                                                   |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21    | Design controls           | `routes/routes.test.ts` (every route has a rate limit; bearer → per-user; auth fails closed), `openapi.test.ts`, `app.test.ts` (413/415, timeouts, headers)                                             |
| 23    | Accounts                  | `auth/auth.test.ts`, `auth/units.test.ts` (Argon2id, JWT alg/kid/iss/aud, refresh rotation and reuse, reset, CSRF, deletion and export)                                                                 |
| 24    | Abuse and cost            | `limits/limits.test.ts` (429 per policy, fail closed, switches → 503, email budget)                                                                                                                     |
| 25    | Cloud saves               | `saves/saves.test.ts` (IDOR, If-Match/412/428, size, checksum, quota)                                                                                                                                   |
| 27    | Payments and paid content | `store/store.test.ts` (forged, stale and replayed webhooks, idempotency, refund, chargeback, velocity, signed URL expiry), `content/presign.test.ts`, content-schema `tiers.test.ts`, game `check:demo` |

## Findings and exceptions

| Id                  | Severity | Where                                     | Decision                                                                                                                                                             | Review by  |
| ------------------- | -------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| GHSA-fc5q-39xc-vjpf | High     | picomatch ≤ 4.0.7 (landing build tooling) | No patched release exists. Only used by the Astro build on repo-owned globs; the output is static. Accepted with expiry (`pnpm-workspace.yaml`, `osv-scanner.toml`). | 2026-12-18 |
| GHSA-mrhx-c7xc-m3w5 | High     | zod 3 via jimp (texture packer, dev)      | The fix exists only in zod 4, which jimp does not support yet. Dev-only, on repo-owned assets. Accepted with expiry. Renovate watches jimp.                          | 2026-12-18 |
| GHSA-3g3m-2fjr-6pw4 | Moderate | glob via Storybook (dev)                  | Accepted with expiry.                                                                                                                                                | 2026-12-18 |
| GHSA-g3hv-75wg-m249 | Moderate | minimatch via typescript-eslint (dev)     | Accepted with expiry.                                                                                                                                                | 2026-12-18 |
| LINT-unsafe-regex   | Info     | Id/locale-key patterns (6)                | False positive: the patterns are separator-delimited and match in linear time. A 200 000-character adversarial input takes under 50 ms. Justified inline.            | —          |
| LINT-fs-path        | Info     | `server.ts`, `catalog.ts`, `openapi.ts`   | Paths come from deploy config or are fixed. The dev file route checks the name with a regex and `basename()` and is refused in production. Justified inline.         | —          |

**Open high or critical findings: none.** The two high advisories above are accepted exceptions
with an expiry date: they are not reachable at runtime, and no usable fix exists yet.

## Containers (item 4)

Both APIs run on `node:24-alpine` with `apk upgrade`, and the runtime image has no
npm/npx/corepack/yarn. They run as `USER node`. In compose they have a read-only root filesystem
(`/tmp` as tmpfs), `cap_drop: ALL` and `no-new-privileges`. CI checks the image: it runs as
non-root, cannot write to the filesystem and has no package manager. Trivy scans the image and the
configuration.

## Key rotation drill

| Date | Environment | Result                                                                                                                                                                                                                                                      |
| ---- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —    | staging     | ⏳ Not run yet: needs staging. Procedure in the [runbook](../runbooks/security-incident.md#3-rotate-jwt-signing-keys-no-downtime) (`tests/security/rotation-drill.mjs`). The unit evidence is `units.test.ts` "verifies with any published key (rotation)". |

## External pentest (before opening registration to the public)

- **Scope:** online-api (all of OpenAPI), auth flows in the landing site and the game, the
  payment and webhook flow in Paddle sandbox, paid-content download, and the edge configuration.
  Studio is internal-only, so the test verifies that it cannot be reached from the internet.
- **Requirements:** an independent firm (CREST/OSCP), staging with production configuration, and
  test accounts. All highs and criticals must be fixed and retested before the launch gate.
- **Disclosure:** `security.txt` is published at `https://mrak.game/.well-known/security.txt`
  (`Contact: mailto:security@mrak.game`, `Expires: 2027-11-18`). Renew it before it expires.
- **Status:** ⏳ not scheduled ([backlog](../BACKLOG.md)).

## Acceptance

| Criterion                                      | Status                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security pipeline green and blocking           | 🟡 Local parts green (lint incl. security rules, audit, security tests, client review). The GitHub jobs and the ruleset still have to be enabled. |
| No open high/critical findings                 | ✅ None open. 2 accepted exceptions with expiry, unreachable at runtime.                                                                          |
| Key rotation drill in staging without downtime | ⏳ Needs staging (script and procedure ready).                                                                                                    |
