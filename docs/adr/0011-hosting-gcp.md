# ADR 0011 — Hosting: Cloud Run, Cloud SQL and Memorystore in the EU

- Status: accepted
- Date: 2026-11-18
- Related: [ADR 0008](0008-cloudflare-edge.md) (edge; its Tunnel decision is replaced by the edge
  secret below), [deploy runbook](../runbooks/deploy.md), `infra/gcp`, `infra/cloudflare`

## Context

The online API needs a managed EU platform with autoscaling and a hard cost ceiling, managed
PostgreSQL with backups and point-in-time recovery, managed Redis, a secret manager with rotation,
and metrics, logs, traces and alerts — all for a small team and a small budget. Static sites are
already on Cloudflare Pages, and paid content is in private R2.

## Decision

| Need           | Choice (region `europe-west1`, Belgium)                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API containers | **Cloud Run** (request-based billing, `min 1 / max 4` in production, `0 / 2` in staging). `max_instance_count` is the **hard cost ceiling**: 4 × pool 10 = 40 DB connections. |
| Migrations     | Cloud Run **job** `online-api-migrate` (`prisma migrate deploy`) before each release                                                                                          |
| PostgreSQL     | **Cloud SQL for PostgreSQL 16**, private IP only, TLS required. Production is regional HA with daily backups (30 kept) and PITR (7 days of logs).                             |
| Redis          | **Memorystore for Redis 7.2**, AUTH and TLS, private service access. Production uses the Standard tier (HA).                                                                  |
| Secrets        | **Secret Manager**, EU-only replication, rotation schedule with notifications, mounted as env vars (`latest`)                                                                 |
| Observability  | Cloud Logging (30-day retention), Cloud Monitoring (dashboard, log-based metrics, alerts, uptime check), Cloud Trace (sampled requests)                                       |
| CI identity    | Workload Identity Federation from GitHub Actions, bound to the GitHub environment. No service-account keys.                                                                   |
| Environments   | `dev` = Docker Compose. `staging` and `production` are separate GCP projects with separate Terraform states, secrets and databases.                                           |

**Edge → origin.** Cloudflare proxies `api.*` to the Cloud Run hostname (Host header rewrite) and
adds `x-mrak-edge: <EDGE_SECRET>`. The API refuses every request without it (only `/health` stays
open for probes) and only then trusts `CF-Connecting-IP` as the client IP. This replaces the Tunnel
of ADR 0008. On Cloud Run, a `cloudflared` connector would need always-allocated CPU, about €45
per instance per month, and Cloud Run is not reachable by IP anyway. The trade-off is that the
`*.run.app` URL is public, but it answers 403 without the secret. Every request also counts
against `max_instances`, so the cost of hitting it directly is bounded.

### Estimated monthly cost (EUR, list prices, before free tiers)

| Item                                           | Staging | Production   |
| ---------------------------------------------- | ------- | ------------ |
| Cloud Run API (1 warm instance, low traffic)   | ~0–5    | ~15–40       |
| Cloud SQL (g1-small zonal / 1 vCPU 3.75 GB HA) | ~25     | ~110         |
| Memorystore 1 GB (Basic / Standard HA)         | ~35     | ~70          |
| Logging, monitoring, Secret Manager, registry  | ~2      | ~5–10        |
| **Total**                                      | **~65** | **~200–230** |

Budgets with alerts at 50/80/100 % and on the 100 % forecast: €60 staging, €250 production. Hitting
the instance ceiling and an anomalous number of billable instance-hours per day also alert.
Cloudflare (Pages, WAF, R2) is billed separately and is flat-rate or low.

### Scaling

The API is stateless (state lives in Postgres and Redis), so it scales horizontally up to the
ceiling. Raising the ceiling is a reviewed Terraform change and must keep
`max_instances × DB_POOL_MAX < max_connections`. Past about 400 RPS sustained, re-evaluate: a
larger Cloud SQL tier, PgBouncer, and more Redis memory.

## Alternatives considered

- **Scaleway** (Serverless Containers, Managed DB, Redis; EU company). Good sovereignty and price,
  but PITR, alerting and IaC coverage were weaker for our needs. It stays the fallback, because
  the app is a portable container.
- **Fly.io**: cheap and simple, but its managed Postgres is younger and its EU-only guarantees
  for logs and metrics are weaker.
- **Kubernetes (GKE)**: too much operational load for one service.
- **Keeping Cloudflare Tunnel**: the cost and complexity described above.

## Consequences

- ✔ One merge deploys; rollback is an instant traffic switch to the previous revision.
- ✔ PITR, HA and backups are managed; restores are drilled monthly in staging.
- ✔ The cost ceiling is enforced by the platform, not by hope.
- ✘ Memorystore is the largest fixed cost at low traffic. Revisit if Redis use stays small.
- ✘ The edge secret must be rotated in Cloudflare and in Secret Manager together (deploy runbook).
