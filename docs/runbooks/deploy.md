# Runbook — deploy, migrations, rollback, secrets, observability

Platform: [ADR 0011](../adr/0011-hosting-gcp.md). Infrastructure: `infra/gcp` (one state per
environment) and `infra/cloudflare` (one state for the zone). Related runbooks:
[restore](restore.md), [abuse](abuse.md), [security incident](security-incident.md).

## Environments

| Env        | Where                                                             | URLs                                                                        | Data                                      |
| ---------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| dev        | `docker compose up --build` (Postgres, Redis, APIs) + `pnpm dev`  | localhost                                                                   | Local, disposable                         |
| staging    | GCP project `mrak-staging`, Pages branch `staging`, R2 `-staging` | staging / play-staging / api-staging `.mrak.game`, behind Cloudflare Access | Test accounts only, never production data |
| production | GCP project `mrak-production`, Pages branch `main`, R2            | mrak.game, play.mrak.game, api.mrak.game                                    | Real                                      |

**GitHub environments.** `staging` and `production` each have their own variables:
`GCP_PROJECT`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_REGISTRY`,
`GCP_SQL_INSTANCE` (from `terraform output deploy`), plus `API_URL`, `SITE_URL`, `PLAY_URL`,
`TURNSTILE_SITEKEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_ENV` and `CLOUDFLARE_ACCOUNT_ID`. Their
secrets are `CLOUDFLARE_PAGES_TOKEN`, `CF_ACCESS_CLIENT_ID/SECRET` (staging) and
`STAGING_DB_PASSWORD` (restore drill). `production` requires a reviewer and allows only `main`.

## First-time setup

1. Create both projects. Create the EU state bucket `mrak-terraform-state` with versioning,
   readable only by the infra admins.
2. Per environment:
   `terraform -chdir=infra/gcp init -backend-config=prefix=<env>`, then
   `terraform -chdir=infra/gcp apply -var-file=<env>.tfvars`.
3. Add the manual secrets (see Secrets below), then list them in `manual_secrets_ready` and apply
   again.
4. Edge: run `terraform -chdir=infra/cloudflare apply` with `api_origin_hosts`, the
   `edge_secrets` (`terraform output -raw edge_secret` of each environment) and
   `team_email_domain`.
5. Copy `terraform output deploy` into the GitHub environment variables.

## Deploy (one merge)

Merging to `main` runs `.github/workflows/deploy.yml`:

1. **Build** the runtime and migration images once. The job summary shows the release's
   migration SQL.
2. **Staging:** push the images, run the migrate job, deploy the API, smoke-test `/health`
   through the edge, then build and publish both static sites to Pages (branch `staging`).
3. **Production:** waits for a reviewer to approve the `production` environment, who reads the
   migration SQL first. Then the same steps, with Pages branch `main`.

If the smoke test fails, traffic goes straight back to the previous revision and the job fails.

## Migrations (reviewed before they run)

- **On every PR** (ci.yml → Migration review): migrations must apply on a clean Postgres and
  match `schema.prisma` (no drift). Applied migrations are immutable. Destructive SQL (DROP,
  type changes, SET NOT NULL, renames, TRUNCATE) needs the `migration-reviewed` label, and
  CODEOWNERS review `prisma/`.
- **Expand/contract**, so a rollback never needs a down-migration. Release N adds (new nullable
  columns or tables) and the code reads both. Release N+1 switches the code. Release N+2 removes
  the old part, only after N+1 has been stable for a full day.
- **A migration failed in production?** The API was not deployed (the step stops the job).
  Restore with [restore](restore.md) only if data was damaged; otherwise fix forward with a new
  migration.

## Rollback (tested in staging every release cycle)

Actions → Deploy → Run workflow → `action=rollback`, choose the environment, and optionally a
revision. The API moves 100 % of traffic to the previous revision immediately. In production the
Pages projects also roll back to their previous deployment. Thanks to expand/contract, the
database stays as it is.

Manual equivalent:

```sh
gcloud run services update-traffic online-api --region europe-west1 --to-revisions <rev>=100
```

## Secrets (Secret Manager, rotation documented)

| Secret                                    | Rotation             | How                                                                                                                                                                                             |
| ----------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_JWT_KEYS`                           | 90 days              | `pnpm --filter @mrak/online-api keygen`, add `[new, old]`, deploy, wait 10 min, then `[new]` ([incident runbook §3](security-incident.md#3-rotate-jwt-signing-keys-no-downtime))                |
| `EDGE_SECRET`                             | 180 days             | New version **and** the Cloudflare `edge_secrets` value at once: apply Cloudflare first with the new value, add the version, redeploy. A short 403 window is possible, so do it at low traffic. |
| `DATABASE_URL`                            | 180 days             | `terraform taint random_password.db` → apply (new user password and secret version) → redeploy                                                                                                  |
| `REDIS_URL` / `REDIS_CA_CERT`             | 180 days / CA expiry | `gcloud redis instances … --auth-string` rotation → apply → redeploy                                                                                                                            |
| `AUTH_SECRET`                             | 365 days             | Taint and apply. Limiter keys reset.                                                                                                                                                            |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` | 180 days             | Paddle dashboard → `gcloud secrets versions add` → redeploy → revoke the old key                                                                                                                |
| `R2_*`                                    | 180 days             | New R2 token → version → redeploy → revoke                                                                                                                                                      |
| `TURNSTILE_SECRET`, `EMAIL_API_KEY`       | 365 / 180 days       | Provider console → version → redeploy                                                                                                                                                           |

Add a version with `printf %s "$VALUE" | gcloud secrets versions add NAME --data-file=-`, then
disable the old version once the new revision is serving. When a secret is due, Secret Manager
publishes to `secret-rotation`, which triggers the "Secret rotation due" alert. Never paste
secrets into issues, chats or CI logs.

## Observability

- **Dashboard:** "MRAK online-api (<env>)" in Cloud Monitoring. It shows requests by class,
  latency p95, 401/429, login failures, refresh-token reuse, purchases and webhook failures,
  emails by kind, 429 by policy (quotas), instances against the ceiling, Cloud SQL CPU and Redis
  memory.
- **Alerts** (email): 5xx > 1 %, 401 spike, 429 spike, refresh reuse, failing payment webhooks,
  latency p95, app alerts (email budget, Redis, limiter), instances at the ceiling, daily cost
  anomaly (instance-hours), secret rotation due, API down (uptime check), budget 50/80/100 % and
  forecast.
- **Logs** are JSON with `severity` and `message`, kept 30 days. They contain no IPs, emails,
  tokens or account ids. Metric events are `evt=audit|email|rate-limited` and `alert=…`.
- **Traces:** Cloud Trace samples requests, and request logs carry `logging.googleapis.com/trace`.
- **Thresholds** live in `infra/gcp` (`alert_thresholds`); tune them after two weeks of real
  traffic.

## Release checklist

- [ ] CI and Security are green; migration review passed (label if destructive).
- [ ] Production approval: migration SQL read, expand/contract respected.
- [ ] After the deploy, watch the dashboard for 15 minutes: no rise in 5xx, latency or 401.
