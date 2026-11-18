# Backlog — pending tasks

Work deferred from finished phases. Tick the box and add the commit when done.

## Store and payments (phase 27, [store](systems/store.md))

- [ ] **Acceptance in Paddle sandbox**: buy → webhook → entitlement → full pack download →
      Continue the same save. Needs sandbox API key, webhook secret, price ids (full-game,
      collector) and client token.
- [ ] Check the `/buy/checkout/` CSP with the real Paddle overlay; if it needs inline styles,
      decide how to allow them on that page only (without breaking `check-security.mjs`).
- [ ] Play the demo build (`pnpm --filter @mrak/game build && preview`) through night 4 in a
      browser: demo-end card, download, reload, Continue.
- [ ] Upload the full pack to the private R2 bucket and set `FULL_PACK_*` in production.
- [ ] Collector's edition: upload the soundtrack and artbook, then add download routes (same
      signed-URL mechanism, `collector` entitlement).
- [ ] Credits page: show approved collector names.
- [ ] Studio: restricted DB role for `SALES_DATABASE_URL` (SELECT on users, entitlements and
      collector_names; UPDATE on collector_names.status only); move the `/sales` page into
      `apps/studio-web` when it exists.
- [ ] Paid ink stories and maps: give them a `tier` and include them in `splitByTier` once
      full-only zones or stories exist.
- [ ] In the game: a "Full game" entry in the main menu (download when owned) besides the
      demo-end card.
- [ ] Provider fraud rules and 3-D Secure: export the dashboard settings and review them (C-30).
- [ ] Steam / mobile: `source: steam|ios|android` entitlements from server-verified receipts.

## Public website ([apps/landing](../apps/landing))

- [ ] Run Lighthouse on the deployed site (target ≥ 90 in all categories).
- [ ] Run Mozilla Observatory on the deployed site (target A).
- [ ] Trailer, screenshots, GIFs and the final OpenGraph image (placeholders today).
- [ ] Full-game price on the site (`FULL_PRICE`) once confirmed.
- [ ] Run the E2E suite against Docker (`E2E_API_URL=http://localhost:3000 pnpm e2e`).
- [ ] Legal review of privacy, terms (incl. terms of sale), refunds, cookies and press texts.

## Security (pipeline in [test report](security/test-report.md))

- [ ] Push the workflows and enable the `main` ruleset: required checks `CI / *` and
      `Security / *`, plus code scanning results (High or higher).
- [ ] Install Renovate on the repository.
- [ ] First green run of CodeQL, Semgrep, OSV-Scanner and Trivy. Triage any findings and update
      the report.
- [ ] Staging: set `STAGING_*_URL` variables and the `STAGING_K6_*` secrets, then run
      `Security (staging)` (ZAP, Schemathesis, k6).
- [ ] JWT key rotation drill in staging (`tests/security/rotation-drill.mjs`); record the
      result.
- [ ] External pentest before opening registration to the public; fix and retest highs.
- [ ] Re-review the audit exceptions by 2026-12-18 (picomatch, zod via jimp, glob,
      minimatch).
- [ ] Remaining ASVS 🟡/⏳ rows (TLS/infra, admin MFA, logging integrity).

## Deployment and operations ([deploy runbook](runbooks/deploy.md), [ADR 0011](adr/0011-hosting-gcp.md))

- [ ] Create the GCP projects `mrak-staging` and `mrak-production`, the billing account, and the
      EU state bucket. Set `billing_account` in the tfvars.
- [ ] First `terraform apply` for `infra/gcp` (both environments) and `infra/cloudflare`. Fix
      whatever `terraform validate` or `plan` reports: the code has never been run against real
      providers.
- [ ] Confirm that Cloudflare origin rules also send the rewritten host as SNI to `*.run.app`;
      if not, use a Cloud Run domain mapping or a load balancer.
- [ ] GitHub environments `staging` and `production`: variables and secrets from the runbook,
      required reviewers on `production`, `main`-only deployments.
- [ ] Add the manual secrets (JWT keys, Turnstile, Paddle, R2, email) and set
      `manual_secrets_ready`.
- [ ] Acceptance: deploy with one merge; run the rollback workflow in staging and record it.
- [ ] Acceptance: first restore drill run (Actions → Restore drill) and record the restore time.
      Add the `STAGING_DB_PASSWORD` secret first.
- [ ] Acceptance: check the dashboard and alerts with real traffic (send a test notification),
      and tune the thresholds after 2 weeks.
- [ ] Real daily cost anomaly alert: billing export to BigQuery plus a scheduled query. Today
      only the instance-hours proxy and the budgets alert.
- [ ] Full OpenTelemetry tracing (DB and Redis spans). Today only Cloud Run's sampled request
      traces with log correlation.
- [ ] Choose an email provider in the EU, sign its DPA, and add `EMAIL_API_KEY` to the API.
- [ ] Sign the DPAs: Google Cloud, Cloudflare, Paddle. Keep the processor table in
      `docs/security/data-inventory.md` up to date.
- [ ] Studio deployment: internal only (VPN or Cloudflare Access + `SALES_DATABASE_URL` with a
      restricted role). Not deployed yet.
- [ ] Deletion ledger (keyed hash of deleted account ids + time, kept for the backup lifetime) so
      erasures can be re-applied after a restore.
- [ ] Production restore drill (quarterly, inside the production project) and its RTO
      measurement.

## Repository and infrastructure

- [ ] Commit the pending work (Conventional Commits) and push. Before pushing:
      `gh auth refresh -h github.com -s workflow`, which is needed for `.github/workflows`.
- [ ] Email provider for production (replace the inner mailer of `BudgetedMailer`).
- [ ] `terraform plan` for `infra/cloudflare` and `infra/gcp` with a validated Terraform install
      (CI job `Terraform (fmt + validate)` covers syntax once pushed).
