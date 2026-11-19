# ADR 0012 — Hosting on free tiers: Pages, Render, Neon, Upstash

- Status: accepted (supersedes [ADR 0011](0011-hosting-gcp.md))
- Date: 2026-11-18
- Related: [ADR 0008](0008-cloudflare-edge.md), [deploy runbook](../runbooks/deploy.md),
  [restore runbook](../runbooks/restore.md), `render.yaml`, `infra/cloudflare`

## Context

ADR 0011 (Cloud Run, Cloud SQL, Memorystore) costs about €65 + €230 per month before the game has
any players. Until the demo proves demand, hosting must cost nothing and need no credit card, while
keeping the security rules of CLAUDE.md: the API only behind the edge, server-side validation,
rate limits backed by Redis, secrets out of the repository, EU data.

## Decision

| Piece                         | Service (region)                                         | Free tier (checked 2026-11)                                    |
| ----------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| Landing + game (static)       | **Cloudflare Pages**                                     | Static hosting, global CDN                                     |
| `/api/*` proxy (same origin)  | **Pages Functions** (`functions/api/[[path]].ts`)        | Counted as Workers: 100 000 requests/day                       |
| Online API (Express)          | **Render** free web service, Docker image (Frankfurt)    | 512 MB RAM, 750 instance-hours/month, sleeps after 15 min idle |
| PostgreSQL                    | **Neon** Free (AWS `eu-central-1`, Frankfurt)            | 1 GB per project, 100 CU-hours/month per project, scale to 0   |
| Redis (rate limits, switches) | **Upstash** Free (`eu-central-1`)                        | 256 MB, 500 000 commands/month                                 |
| Captcha                       | Cloudflare Turnstile                                     | Free                                                           |
| Paid and seasonal content     | Cloudflare R2 (free tier; needs a card on file) or Pages | 10 GB, no egress fees                                          |
| CI/CD and images              | GitHub Actions, GitHub Container Registry (public)       | Unlimited on public repositories                               |
| Errors and uptime             | Sentry Free (EU region) + a free uptime monitor          | —                                                              |

**Edge → origin.** The browser only talks to its own origin (`play.mrak.game/api/…`,
`mrak.game/api/…`). The Pages Function strips any client-sent `x-mrak-edge` and
`x-mrak-client-ip`, adds `x-mrak-edge: <EDGE_SECRET>` and `x-mrak-client-ip: <CF-Connecting-IP>`,
and forwards to the Render URL (`https://<service>.onrender.com`, removing the `/api` prefix). The
API refuses every request without the secret (only `GET /health` stays open for probes) and only
then trusts `x-mrak-client-ip`. `CF-Connecting-IP` cannot be used at the origin any more: Render
sits behind Cloudflare too, which rewrites it to the Worker's address. Same origin also means no
CORS preflights and a smaller CSP (`connect-src 'self'`). The refresh cookie keeps
`Domain=mrak.game`, `HttpOnly; Secure; SameSite=Strict` and moves to `Path=/api/v1/auth`
(`COOKIE_PATH`).

**Releases.** Actions builds the API image once (`RELEASE` = commit), scans it (Trivy), pushes it
to GHCR, runs `prisma migrate deploy` against Neon from the migration image, then calls the Render
deploy hook with that image. The smoke test waits until `/api/health` through the edge reports
the new release; otherwise it redeploys the previous image. Rollback = deploy hook with an older
image (instant to start, no rebuild). Render's pre-deploy command is a paid feature, hence
migrations from Actions; they stay expand/contract.

**Environments.** `staging` and `production` are fully separate: two Render services (staging in a
second free Render workspace, so its hours never eat production's 750), two Neon projects, two
Upstash databases, Pages branch `staging` (preview variables) behind Cloudflare Access.

**Database connections.** The API uses Neon's **direct** endpoint (not the PgBouncer pooler: the
driver sets `statement_timeout` as a startup parameter, which the pooler refuses) with
`sslmode=require` and `DB_POOL_MAX=5` — one instance, far below Neon's connection limit.

**Backups.** Neon Free keeps only a short restore window, so `backup.yml` takes a nightly
`pg_dump`, encrypts it with `age` (public key in the repository variables, private key offline)
and uploads it to a private R2 bucket (30 days). The monthly restore drill decrypts the latest dump
into a throw-away Postgres inside Actions and runs `infra/postgres/verify-restore.sh`; production
data never reaches staging or the logs.

## Limits and how we watch them

- **Render 750 h:** one always-on instance uses ~744 h. The uptime monitor pings production every
  5 minutes (it also keeps it awake: no 30–60 s cold start for players). Staging sleeps.
- **Neon 100 CU-hours:** at 0.25 CU, 24/7 would be ~186 CU-hours, so the database must scale to
  zero. `/health` touches only Redis; hourly jobs (telemetry partitions, purges) wake it a few
  minutes each. Neon emails at its usage thresholds.
- **Upstash 500 000 commands:** each API request uses about 2–4 commands (limiter, switches); that
  is roughly 4 000 requests/day. When the quota runs out Redis refuses commands and auth fails
  closed (503, threat model C-07). Upstash emails at 80 %.
- **Workers 100 000 requests/day:** only `/api/*` invokes the Function; static files never do.

Upgrade path (each is a plan change, not a migration): Render Starter (no sleep, pre-deploy
migrations), Neon Launch (longer PITR), Upstash pay-as-you-go. Moving back to ADR 0011 needs only
the image and the env vars: the app is unchanged.

## Alternatives considered

- **ADR 0011 (GCP):** right for scale, too expensive for a demo with no players.
- **Fly.io / Railway:** no lasting free tier without a card.
- **Cloudflare Workers for the API:** Express, Prisma's `pg` adapter and Argon2 (native) do not run
  there without a rewrite.

## Consequences

- ✔ €0/month and no card (R2 needs one on file, for paid content and backups only).
- ✔ Same security model: edge secret, server-side limits, secrets only in each provider's store.
- ✘ Render is a US company (EU region; SCCs/DPF in its DPA). Listed in the privacy page.
- ✘ No managed HA, short PITR, logs kept 7 days on Render. Accepted until revenue.
- ✘ Free quotas are hard ceilings: past them the service stops rather than billing. That is the
  cost ceiling, but it is also an availability risk at launch; upgrade before marketing pushes.
