# infra

- `postgres/init-databases.sh` — creates the `online` and `studio` databases, each owned by its own
  role, on the first start of the Postgres container (mounted into `/docker-entrypoint-initdb.d`).
  It only runs when the data volume is empty; to re-run it: `docker compose down -v`.

- `cloudflare/` — the edge as Terraform: proxy, API tunnel, WAF, edge rate limits, cache rules,
  private R2 bucket, alerts (see its README and `docs/runbooks/abuse.md`).

- `gcp/` — staging and production on Google Cloud, EU ([ADR 0011](../docs/adr/0011-hosting-gcp.md)):
  network, Cloud Run API and migrate job, Cloud SQL (backups + PITR), Memorystore, Secret
  Manager with rotation, GitHub Workload Identity Federation, registry, dashboard, alerts, budget.
  `verify-restore.sh` checks restored databases. Runbooks: `docs/runbooks/deploy.md`, `restore.md`.
