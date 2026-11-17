# @mrak/online-api

Public online API (accounts, cloud saves, entitlements).

- `pnpm --filter @mrak/online-api dev` — run with hot reload on port 3000
- `GET /health` — liveness check

Every route is declared through `defineRoute` with a mandatory rate limit and registered in `src/routes/index.ts`.
