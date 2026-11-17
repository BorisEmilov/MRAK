# ADR 0005 — Monorepo tooling and pinned versions

- Status: accepted
- Date: 2026-11-15

## Context

MRAK has a browser game, a marketing site, internal tooling and two backend services that share
types, content and rules.

## Decision

- pnpm workspaces + Turborepo; layout `apps/`, `packages/`, `services/`, `infra/`, `docs/`.
- Game: Vite + React 19 + TypeScript (strict) + Phaser 4. React = UI, Phaser = world, linked only
  by a typed EventBus. Base resolution 640×360, `pixelArt: true`, integer zoom
  (`Scale.NONE` + `MAX_ZOOM`, recomputed on resize).
- Rules in `packages/core` (pure TS, ESLint forbids Phaser/React/DOM).
- Services: Express 5 + Zod 4 + Prisma 7 (driver adapter `@prisma/adapter-pg`) + Vitest/Supertest.
- Landing: Astro (static).
- TypeScript pinned to 6.0.x: typescript-eslint 8 does not support TypeScript 7 yet.
- Prisma pinned to 7.10.1: the npm `latest` tag points to an 8.0 release candidate.

## Consequences

- Internal packages are consumed as TypeScript source (no build step) — fast, but each consumer
  must use a compatible tsconfig.
- Upgrade to TypeScript 7 once typescript-eslint supports it.
