# infra

- `postgres/init-databases.sh` — creates the `online` and `studio` databases, each owned by its own
  role, on the first start of the Postgres container (mounted into `/docker-entrypoint-initdb.d`).
  It only runs when the data volume is empty; to re-run it: `docker compose down -v`.

- `postgres/verify-restore.sh` — checks a restored online-api database (restore drill and real
  restores; `docs/runbooks/restore.md`).

- `cloudflare/` — the edge as Terraform (Free plan): Pages projects with the `/api` Function
  variables, WAF, edge flood backstop, cache rules, private R2 buckets, alerts (see its README
  and `docs/runbooks/abuse.md`).

- `../render.yaml` — the online-api service on Render ([ADR 0012](../docs/adr/0012-hosting-free-tier.md)).
  Database: Neon; Redis: Upstash (set up in their consoles; `docs/runbooks/deploy.md`).
