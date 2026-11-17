# infra

- `postgres/init-databases.sh` — creates the `online` and `studio` databases, each owned by its own
  role, on the first start of the Postgres container (mounted into `/docker-entrypoint-initdb.d`).
  It only runs when the data volume is empty; to re-run it: `docker compose down -v`.

Deployment infrastructure (IaC) will live here.
