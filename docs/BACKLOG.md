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
- [ ] Studio: restricted DB role for `SALES_DATABASE_URL` (SELECT on users, entitlements,
      collector_names and `telemetry.events`; UPDATE on collector_names.status only); move the `/sales` page into
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

## Studio ([spec](systems/studio.md))

- [ ] Acceptance in the real game: create an event in Studio → Export to game → run `pnpm dev`
      and see it fire. Verified so far: export → files validate and contain the event (tests,
      headless UI run), not played.
- [ ] Deploy the Studio internally: Cloudflare Tunnel + Access application `studio.mrak.game`
      (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`), its own Postgres (run `prisma migrate deploy` for
      studio), never a public route.
- [ ] Deployed export: open a pull request with the exported files instead of writing to the
      container's `CONTENT_ROOT` (today "Export to game" targets a local checkout).
- [ ] Review the 13 `flag-never-set` findings in the current content (engine-set flags such as
      `virtuous` vs real gaps) and add an "engine sets this" marker to the registry so they stop
      showing.
- [ ] Graph auto-layout (dagre/elk) for readable quest/event chains; today columns per type.
- [ ] Editing of Ink stories and maps (read-only in Studio; analysis reads them).
- [ ] Locale editor with search and bulk add for a new entity's keys (today one key per entry).
- [ ] Concurrent-edit UX: show who else edits an entry; today an optimistic 409 asks to reload.
- [ ] UI tests (Playwright) in CI for the Studio flow.

## Telemetry ([spec](systems/telemetry.md))

- [ ] Acceptance in the real game: enable the option, play the prologue and a night in a browser
      against staging, and check the Studio panel (verified so far with the real
      `wireTelemetry` mapping and simulated core events → online-api → PostgreSQL → Studio).
- [ ] First-run consent prompt (today: only the Options → Gameplay toggle, off by default).
- [ ] Erasure by install id (data inventory says "Yes"): show the id in Options and add a delete
      route, or document that turning the option off is the objection and data expires in 90 days.
- [ ] Death heatmap on the zone map (needs `x,y` in the `death` event; today zone × night).
- [ ] Session/install-level "time per chapter" panel (events `chapter-end` are stored, not shown).
- [ ] Move aggregation to SQL / materialized views when rows exceed the 200 000-row cap.
- [ ] Enable `telemetry` in production only after the privacy page is published (switch +
      `VITE_TELEMETRY_SAMPLE`); set `TELEMETRY_SAMPLE` and the edge limit per expected volume.
- [ ] Partition maintenance logs a NOTICE per existing partition every hour; quiet it if noisy.

## Art pipeline ([art direction](art-direction.md), [asset pipeline](systems/asset-pipeline.md))

- [ ] Verify the Aseprite (`aseprite -b`) and PSD (`magick`) import paths with real files and add
      the tools to the CI assets job (not installed locally; PNG path verified).
- [ ] Villagers and portraits from the atlas: villagers and portraits are still drawn in code from
      `look` (`villager-art.ts`, 16 × 16). Add `villager-<id>` (character 16 × 24) and
      `portrait-<id>` (64 × 64) slots, and make `VillageNpcs` and the UI portraits use them when
      present.
- [ ] Tilesets from sources: Tiled tilesets are PNGs in `packages/content/maps`; export them from
      `assets/src/tilesets/*.aseprite` with the same pipeline.
- [ ] Palette check in the pipeline (warn on colours outside docs/art-direction.md).
- [ ] Play-test the guardian at 16 × 24 with pivot (feet) and the 32 × 32 creature placeholders
      in the browser (hitbox, lantern light height, depth sorting).
- [ ] Set real per-zone budgets once final art sizes are known (today 4 MiB per zone).
- [ ] The atlas shows 1-px extruded borders around frames with transparent edges; check they do
      not bleed when sprites are scaled (preload candle at 2×).

## Quality and performance ([testing](systems/testing.md), [performance](systems/performance.md))

- [ ] Run the 2-hour memory soak (nightly workflow) and record the curve; only a short local soak
      ran so far. Investigate any texture/object/heap growth it reports.
- [ ] Measure 60 fps on a real mid-range laptop (village at night, max lights) and record it; CI
      uses SwiftShader, so fps there is meaningless.
- [ ] Browser matrix: the Firefox, WebKit and Edge projects are configured but have only run in
      CI config, not locally (only Chromium is installed here). Manual Safari (macOS) pass before
      release.
- [ ] E2E purchase against the real flow: sign-in, Paddle sandbox checkout, webhook, entitlement
      and the full-pack download (today the store page is stubbed after "Buy").
- [ ] E2E "prologue until the first save" plays through the prologue scenes; today it checks the
      first autosave on entering the world.
- [ ] Studio view of bug reports (list, download the attached save, mark fixed).
- [ ] Bot: more of the game (dialogue choices, mysteries, exorcisms, pacts, gathering/crafting,
      items) and invariants per system (inventory counts, debt ≥ 0, one guardian alive).
- [ ] Pool more objects if profiling shows churn (whispers, particles, damage numbers).
- [ ] Coverage: raise the pacts (65 %) and save-checksum (60 %) branch thresholds with tests.

## Repository and infrastructure

- [ ] Commit the pending work (Conventional Commits) and push. Before pushing:
      `gh auth refresh -h github.com -s workflow`, which is needed for `.github/workflows`.
- [ ] Email provider for production (replace the inner mailer of `BudgetedMailer`).
- [ ] `terraform plan` for `infra/cloudflare` and `infra/gcp` with a validated Terraform install
      (CI job `Terraform (fmt + validate)` covers syntax once pushed).
