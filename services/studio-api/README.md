# @mrak/studio-api

Internal studio API for content tooling. Never exposed to the internet.

- `pnpm --filter @mrak/studio-api dev` — run with hot reload on port 3100
- `GET /health` — liveness check

Every route is declared through `defineRoute` with a mandatory rate limit and registered in `src/routes/index.ts`.
