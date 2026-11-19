# Runbook — deploy, migrations, rollback, secrets, observability

Platform: [ADR 0012](../adr/0012-hosting-free-tier.md) — Cloudflare Pages (+ `/api` Function),
Render (API), Neon (Postgres), Upstash (Redis). Infrastructure as code: `render.yaml` (API
service) and `infra/cloudflare` (zone, Pages projects, WAF, R2). Related runbooks:
[restore](restore.md), [abuse](abuse.md), [security incident](security-incident.md).

## Environments

| Env        | API (Render)                                 | Database / Redis                                    | Sites (Pages)                                                                   | Data                                      |
| ---------- | -------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| dev        | `docker compose up --build` + `pnpm dev`     | local containers                                    | localhost                                                                       | Local, disposable                         |
| staging    | `mrak-api-staging` (second Render workspace) | Neon project `mrak-staging`, Upstash `mrak-staging` | branch `staging`: staging / play-staging `.mrak.game`, behind Cloudflare Access | Test accounts only, never production data |
| production | `mrak-api` (`render.yaml`)                   | Neon project `mrak`, Upstash `mrak`                 | branch `main`: mrak.game, play.mrak.game                                        | Real                                      |

The browser only calls its own origin: `https://<site>/api/<path>` → Pages Function → Render.

**GitHub environments** `staging` and `production` (production requires a reviewer and allows only
`main`):

| Kind     | Name                                                                                                           | Value                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| variable | `API_ORIGIN`                                                                                                   | Render service URL, `https://<service>.onrender.com`                    |
| variable | `SITE_URL`, `PLAY_URL`                                                                                         | `https://mrak.game`, `https://play.mrak.game` (staging hosts)           |
| variable | `TURNSTILE_SITEKEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_ENV`                                                       | public client keys                                                      |
| variable | `CLOUDFLARE_ACCOUNT_ID`                                                                                        | account id                                                              |
| variable | `BACKUP_AGE_RECIPIENT` (production)                                                                            | `age1…` public key                                                      |
| secret   | `RENDER_DEPLOY_HOOK`                                                                                           | Render → service → Settings → Deploy Hook                               |
| secret   | `MIGRATE_DATABASE_URL`                                                                                         | Neon **direct** connection string, `?sslmode=require`                   |
| secret   | `CLOUDFLARE_PAGES_TOKEN`                                                                                       | API token: Account → Cloudflare Pages → Edit                            |
| secret   | `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` (staging)                                                     | Access service token for CI                                             |
| secret   | `BACKUP_DATABASE_URL`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`, `BACKUP_AGE_KEY` (production) | read-only Neon role; R2 token scoped to `mrak-backups`; age private key |

## First-time setup

1. **Neon:** two projects (`mrak`, `mrak-staging`), region AWS Frankfurt, Postgres 17. Copy each
   **direct** connection string (not `-pooler`). For backups and the Studio, also create a
   read-only role (`GRANT pg_read_all_data`).
2. **Upstash:** two Redis databases in `eu-central-1` with TLS; copy each `rediss://` URL.
3. **Secrets:** generate per environment `AUTH_JWT_KEYS` (`pnpm --filter @mrak/online-api keygen`,
   wrapped in `[ … ]`), `AUTH_SECRET` and `EDGE_SECRET` (`openssl rand -base64 48` each).
4. **Render:** production → Blueprint from `render.yaml`. Staging → a second workspace, a web
   service from the existing image `ghcr.io/<owner>/mrak-online-api:<sha>` with the same variables
   (staging values, `SENTRY_ENVIRONMENT=staging`, `PADDLE_API_URL` sandbox). Fill the
   `sync: false` secrets in the dashboard. Copy each service URL and **Deploy Hook**.
5. **GHCR:** after the first build, make the package `mrak-online-api` public (Packages → Package
   settings → Change visibility) or give Render a registry credential.
6. **Cloudflare:** `terraform -chdir=infra/cloudflare init && terraform -chdir=infra/cloudflare apply`
   with `api_origins` (the two Render URLs), `edge_secrets` (the two `EDGE_SECRET`),
   `team_email_domain`, `alert_email`. It creates the Pages projects with `API_ORIGIN` and
   `EDGE_SECRET` (production and preview), DNS, WAF, the edge rate limit and the R2 buckets.
   State is local (`infra/cloudflare/terraform.tfstate`, gitignored, holds secrets): keep it in
   the password manager.
7. **GitHub environments:** the table above.
8. **Uptime monitor** (free plan of any provider): `GET https://play.mrak.game/api/health` every
   5 minutes, alert by email. It also keeps the production instance awake.
9. **Sentry:** EU organisation, one Node project; its DSN goes to `SENTRY_DSN` on Render.

## Deploy (one merge)

Merging to `main` runs `.github/workflows/deploy.yml`:

1. **Build** the API and migration images once (`RELEASE` = commit) and push them to GHCR. The
   job summary shows the release's migration SQL.
2. **Staging:** migrate Neon from the migration image, call the Render deploy hook with the new
   image, wait until Render's `/health` reports the new release (10 min), build both sites with
   `/api` as the API URL, publish them to Pages (branch `staging`), and check
   `PLAY_URL/api/health` through the Function.
3. **Production:** waits for a reviewer to approve the `production` environment, who reads the
   migration SQL first. Then the same steps, with Pages branch `main`.

If the new release does not come up, the job redeploys the previous image and fails.

## Migrations (reviewed before they run)

- **On every PR** (ci.yml → Migration review): migrations must apply on a clean Postgres and
  match `schema.prisma` (no drift). Applied migrations are immutable. Destructive SQL (DROP,
  type changes, SET NOT NULL, renames, TRUNCATE) needs the `migration-reviewed` label, and
  CODEOWNERS review `prisma/`.
- **Expand/contract**, so a rollback never needs a down-migration. Release N adds (new nullable
  columns or tables) and the code reads both. Release N+1 switches the code. Release N+2 removes
  the old part, only after N+1 has been stable for a full day.
- **A migration failed?** The API was not deployed (the step stops the job). Restore with
  [restore](restore.md) only if data was damaged; otherwise fix forward with a new migration.

## Rollback (tested in staging every release cycle)

Actions → Deploy → Run workflow → `action=rollback`, the environment, and the full commit SHA of
the release to restore (any earlier deploy run shows it). Render starts that image (about a
minute); the job waits until `/health` reports it. In production the Pages projects also roll back
to their previous deployment. Thanks to expand/contract, the database stays as it is.
Manual equivalent: Render dashboard → service → Events → _Rollback_ on an earlier deploy.

## Secrets (provider stores only, rotation documented)

API secrets live in the Render service environment; Pages secrets in the Pages project (through
Terraform); CI secrets in the GitHub environments. Never in the repository, issues, chats or logs.

| Secret                                    | Rotation        | How                                                                                                                                                                |
| ----------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_JWT_KEYS`                           | 90 days         | `keygen`, set `[new, old]`, redeploy, wait 10 min, then `[new]` ([incident runbook §3](security-incident.md#3-rotate-jwt-signing-keys-no-downtime))                |
| `EDGE_SECRET`                             | 180 days        | New value in `edge_secrets` → `terraform apply` (Pages) and on Render at the same time, then redeploy Pages. A short 403 window is possible: do it at low traffic. |
| `DATABASE_URL`                            | 180 days        | Neon → Roles → reset password → update Render, `MIGRATE_DATABASE_URL` and `BACKUP_DATABASE_URL`                                                                    |
| `REDIS_URL`                               | 180 days        | Upstash → Reset password → update Render                                                                                                                           |
| `AUTH_SECRET`                             | 365 days        | New random value on Render. Limiter keys reset.                                                                                                                    |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` | 180 days        | Paddle dashboard → Render → redeploy → revoke the old key                                                                                                          |
| `R2_*`                                    | 180 days        | New R2 token → Render / GitHub → revoke                                                                                                                            |
| `TURNSTILE_SECRET`, `EMAIL_API_KEY`       | 365 / 180 days  | Provider console → Render                                                                                                                                          |
| `BACKUP_AGE_KEY`                          | on staff change | New age key pair: new recipient variable, keep the old private key until its dumps expire (30 days)                                                                |

Rotation dates are tracked in the owner's calendar (no managed rotation on the free tiers).

## Observability

- **Errors:** Sentry (EU), `online-api` project: every 5xx with stack and release. Events carry no
  request, user, headers, cookies or breadcrumbs (`src/observability/sentry.ts`).
- **Uptime:** the external monitor on `/api/health` (edge + Function + Render + Redis).
- **Logs:** Render → service → Logs (kept 7 days on the free plan). JSON, no IPs, emails, tokens
  or account ids. Metric events are `evt=audit|email|rate-limited` and `alert=…`: search them in
  the log view.
- **Quotas:** Neon (CU-hours, storage), Upstash (commands) and Render (instance hours) email at
  their thresholds; check their dashboards weekly before launch ([ADR 0012 → Limits](../adr/0012-hosting-free-tier.md#limits-and-how-we-watch-them)).

## Release checklist

- [ ] CI and Security are green; migration review passed (label if destructive).
- [ ] Production approval: migration SQL read, expand/contract respected.
- [ ] After the deploy, watch Sentry and the Render logs for 15 minutes: no new errors or 5xx.
