# MRAK — Agent context

## What it is

MRAK is a 2D browser horror RPG with village management and roguelite night
exploration. Setting: the village of Mrak, Rhodope Mountains, Bulgaria,
1830s–1870s (Ottoman rule, National Revival). Tone references: Cult of the
Lamb (management + action loop), Fear Street: 1666 (generational pact,
witch hunt, inverted truth — thematic inspiration only, never copied),
Hereditary / The Exorcist (demonic dread). Real Bulgarian folklore is the base.

## Design pillars (non-negotiable)

1. Dread, not cheap jump scares.
2. Every decision leaves a permanent scar on the world.
3. Continuous growth: the guardian (attributes, skills, talent trees),
   the village (buildings, population, reputation) and the bloodline
   (Bloodline Tree) always have a next goal. Skills improve by use;
   talents are bought with Revelation earned from milestones, never
   from killing. Progression is never sold for money.
4. The player never knows if an event is real, a mystery or a hallucination.
5. Longevity through systems, not filler.
6. The UI is clear and friendly even when the world is not: icons, tooltips,
   readable fonts, nothing hidden behind obscure controls.

## Language

- ALL player-facing text is English, via localization keys (locales/en.json).
  Never hardcode player-facing strings.
- Bulgarian folklore terms keep their transliterated name with an English
  explanation in the glossary (e.g. "karakondzhul", "samodiva", "kukeri").
- Code, comments, commits and docs/systems are English.

## Tech rules

- Game: Vite + React + TypeScript (strict) + Phaser 4. React renders UI;
  Phaser renders the world. They talk ONLY through the typed EventBus and
  read-only snapshots from core. No React state updated every frame.
- packages/core: pure TypeScript, no Phaser, no React, no DOM. All game
  rules live here and are unit-tested with Vitest.
- Content is DATA in packages/content (JSON + .ink + maps), validated by
  packages/content-schema (Zod). Never hardcode content in code. Types come
  from z.infer in @mrak/content-schema — never redefine them. Every flag/stat/
  rule is declared in packages/content/data/flags.json. Spec:
  docs/systems/content-model.md and docs/systems/conditions-effects.md.
- Ink reads/writes the WorldState only through external functions.
- All persistent state goes through WorldState and is serializable.
- Randomness only through a seeded IRandom (reproducible tests).
- Assets: texture atlases, lazy loading per zone, no asset > 2 MB without
  justification.
- Services: Node LTS + TS strict + Express + Prisma + PostgreSQL + Redis +
  Zod + Vitest/Supertest. OpenAPI for every endpoint.

## Security rules (non-negotiable)

- Never trust the client (the browser game is public code). Validate
  everything server-side with Zod and size limits.
- Passwords: Argon2id only. Never log passwords, tokens, full emails or
  Authorization headers.
- Access token: short-lived JWT (EdDSA). Refresh token: opaque, random,
  stored only as a hash, rotated on every use with reuse detection.
- In the browser: refresh token in an HttpOnly Secure SameSite cookie;
  access token in memory only. Never localStorage for tokens.
- Every public endpoint has a rate limit, body size limit, timeout and
  pagination cap. A test fails if an endpoint has no declared rate limit.
- Paid content is never shipped to clients without an entitlement.
- No secrets in the repo; gitleaks in CI.
- Any change to auth, rate limits, payments or permissions requires new
  security tests and an update to docs/security/threat-model.md.
- Internal tools (studio) are never exposed to the internet.
- GDPR: data minimization, export and deletion of accounts.

## Conventions

- TypeScript strict, no `any`, ESLint + Prettier.
- Conventional Commits.
- Every new system: spec in docs/systems/<system>.md BEFORE code.

## Definition of done

- Typecheck, lint and all tests green.
- System spec updated.
- No hardcoded content or player-facing strings.
- Summary of changes and risks at the end of the session.

## Key docs

docs/GDD.md, docs/BACKLOG.md (deferred tasks), docs/lore/, docs/systems/, docs/ui/, docs/security/,
docs/business/, docs/adr/

## Phaser 4 skills

docs/phaser-skills/ holds the official Phaser 4 agent skills, vendored from
the `skills/` folder of github.com/phaserjs/phaser (see SOURCE.md there).
Before writing or changing Phaser code, read the relevant SKILL.md
(e.g. scenes/, game-setup-and-config/, scale-and-responsive/, tilemaps/,
v3-to-v4-migration/). Most Phaser examples online are Phaser 3: trust
these skills over memory. Do not edit the vendored files.

## Repository layout

- apps/game — Vite + React + Phaser 4 (the game). apps/landing — Astro site.
- apps/studio-web — internal content studio (later). apps/desktop, apps/mobile — placeholders.
- packages/core — pure game rules. packages/content — data + locales/en.json.
- packages/content-schema — Zod schemas. packages/api-client — typed API client.
- packages/ui-kit — design tokens, React components, icon sprite, Storybook (docs/ui/).
- services/online-api — public API. services/studio-api — internal API (never public).
- Every service route is declared with `defineRoute` (mandatory rate limit) and
  registered in `src/routes/index.ts`; routes.test.ts enforces it.
- infra/ — Postgres init, deployment. docs/ — see Key docs.

## Commands

- pnpm dev — game at http://localhost:5173 (pnpm dev:all for everything)
- pnpm test | pnpm lint | pnpm typecheck | pnpm format
- pnpm --filter @mrak/ui-kit storybook — component/icon review (http://localhost:6006);
  pnpm --filter @mrak/ui-kit icons after editing packages/ui-kit/icons/manifest.json
- pnpm content:validate — validate packages/content (schemas, refs, flags, locale keys,
  demo/full, trees, mysteries, manifest). pnpm content:manifest after changing content;
  pnpm content:schema to re-export JSON Schemas.
- docker compose up --build — postgres, redis, online-api (:3000), studio-api (:3100)

## Token-optimized development

### Core rules

- Minimize token consumption on every task.
- Never inspect the entire project or read unrelated files.
- Use targeted searches (grep/ripgrep) before opening files; read only relevant sections.
- Never rewrite entire files for small changes; never refactor unrelated code.
- No unnecessary abstractions, files or documentation. Reuse existing systems and conventions.

### Workflow

1. Identify the exact task.
2. Locate relevant files with targeted searches.
3. Inspect only necessary code.
4. Implement the smallest viable change.
5. Run only relevant tests.
6. Report the result concisely.

### Context management

- Do not re-read files already inspected in the session or repeat project explanations.
- Use existing documentation as the source of project context.
- Do not explore dependencies unless necessary.
- If context is insufficient, request only the missing information.

### Code modifications

- Preserve existing architecture and interfaces; modify the minimum number of files.
- Avoid unnecessary comments and documentation.
- Do not duplicate functionality or modify unrelated systems.

### Output

After each task, report only (extremely concise):

- Files modified.
- Changes made.
- Tests performed.
- Remaining issues.

### Agent behavior

- Work directly on simple tasks; no subagents for simple operations.
- Avoid speculative analysis and unnecessary planning.
- Do not reconsider decisions without new evidence.
- Ask before performing large architectural changes.
