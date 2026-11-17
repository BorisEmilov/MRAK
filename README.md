# MRAK

2D browser horror RPG with village management and roguelite night exploration, set in the
Rhodope Mountains, 1830s–1870s. Agent and contributor rules: [CLAUDE.md](./CLAUDE.md).

## Requirements

| Tool           | Version                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| Node.js        | 24 LTS (`.nvmrc`)                                                                       |
| pnpm           | 12.18 (`corepack enable` picks it from `packageManager`)                                |
| Docker Compose | v2 (your user must be able to access the Docker daemon)                                 |
| ffmpeg         | any recent — encodes game audio (ogg + m4a); without it `pnpm dev` runs silently        |
| Git LFS        | any recent — `git lfs install` (png/ogg/wav/psd/aseprite)                               |
| gitleaks       | 8.x — required by the pre-commit hook ([install](https://github.com/gitleaks/gitleaks)) |

## Getting started

```sh
corepack enable
git lfs install
pnpm install
cp .env.example .env   # then replace every change-me value
pnpm dev               # opens the game at http://localhost:5173
```

## Commands

| Command                     | What it does                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                  | Game (Vite + React + Phaser) with hot reload, opens the browser    |
| `pnpm dev:all`              | Every app and service in dev mode (game, landing :4321, APIs)      |
| `pnpm test`                 | Vitest in every package                                            |
| `pnpm lint`                 | ESLint (type-aware, zero warnings)                                 |
| `pnpm typecheck`            | `tsc --noEmit` / `astro check` in every package                    |
| `pnpm format`               | Prettier write (`pnpm format:check` in CI)                         |
| `pnpm build`                | Production builds                                                  |
| `docker compose up --build` | Postgres 16 (online + studio DBs), Redis 7, online-api, studio-api |

Once the stack is up:

```sh
curl -i http://127.0.0.1:3000/health   # online-api
curl -i http://127.0.0.1:3100/health   # studio-api
```

## Layout

```
apps/        game · landing · studio-web · desktop · mobile
packages/    core · content · content-schema · api-client · ui-kit
services/    online-api · studio-api
infra/       postgres init, deployment
docs/        lore · systems · ui · security · runbooks · business · adr · phaser-skills
```

## Git hooks

`pre-commit` runs gitleaks on staged changes, then ESLint + Prettier on staged files
(lint-staged). Commits follow [Conventional Commits](https://www.conventionalcommits.org).
