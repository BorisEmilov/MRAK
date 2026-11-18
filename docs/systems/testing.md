# Testing and quality

Status: v1 · Back to [GDD](../GDD.md) · [index](README.md) · performance: [performance](performance.md)

## Layers

| Layer        | Where                                      | Runs                                   |
| ------------ | ------------------------------------------ | -------------------------------------- |
| Unit (rules) | `packages/core/src/**/*.test.ts` (Vitest)  | every CI run, with coverage thresholds |
| Balance      | `pnpm --filter @mrak/core simulate`        | every CI run (fails outside the bands) |
| Headless bot | `pnpm --filter @mrak/core bot [n] [seeds]` | every CI run: 12 nights × 50 seeds     |
| UI / a11y    | `apps/game/src/**/*.test.tsx`              | every CI run                           |
| E2E          | `apps/game/e2e/game.spec.ts` (Playwright)  | CI (Chromium); nightly browser matrix  |
| Memory soak  | `apps/game/e2e/soak.spec.ts`               | nightly, `SOAK_MINUTES=120` (Chromium) |

## Coverage (core)

Global: lines ≥ 90 %, branches ≥ 80 %. Per critical system (`packages/core/vitest.config.ts`;
raise, never lower): conditions and effects, WorldState, pacts, possession, lineage, saves,
achievements, and the bot itself. A threshold miss fails `pnpm test`.

## Balance gate

The phase-11 progression simulator (`scripts/simulate.ts`, profiles × 20 seeds) compares Revelation,
power and debt at fixed hours with the bands of [progression-economy](progression-economy.md) and
exits 1 when a value leaves its band. It takes ~2 s, so CI runs it on every change, which covers
every change to talents, trees, milestones and Revelation data.

## Bot (`packages/core/src/bot/bot.ts`)

Plays a real `Game` on the real content with a seeded random player: guardian creation, letting
time pass, zones, POIs, talks with tones, tasks, talents, buildings, lantern and darkness, rest,
marriage and apprentices, night actions and creature strikes, heirs and "let a year pass".

- **Exceptions:** any command that throws.
- **Soft-locks:** time that does not advance after 20 `advanceTime`/`rest` commands; an heir awaited
  with no candidate, no child growing up and the line not ended (the heir screen would be empty
  and cannot be closed); fewer nights than asked within the command budget.
- **Impossible states:** the snapshot fails `WorldStateSchema`, a non-finite stat, a clock minute
  outside 0–1439, an unknown current zone; time running backwards.
- **Saves:** each new day, `save → JSON → load` must give the same state.
- "The line ends" (death without heirs) is a legitimate end: the bot starts a new chronicle and
  keeps counting nights.

Acceptance: 12 nights × 50 seeds without problems (~40 s).

## E2E (`apps/game/e2e`)

Against the Vite dev server; helpers go through the DEV-only hooks `window.__mrak` (host, store)
and `window.__mrakGame`, which only issue core commands or call the scene's own methods.

1. New game → guardian creation → first autosave (entering the first zone) → reload → Continue.
2. Zone change through the scene's exit path (fade, restart, zone assets).
3. Dialogue: talking to a villager opens their story; a choice continues it.
4. Simulated purchase: the demo-end card (4 nights survived) → "Buy the full game" opens the store
   page (stubbed with `context.route`).
5. Report a bug: without the consent box no save or seed; with it both are attached.

Every test fails on an uncaught page error.

## Browser matrix

Playwright projects: `chromium` (Chrome), `firefox`, `webkit` (Safari engine) and `edge`
(`msedge` channel). CI runs Chromium on every push; the nightly workflow runs all four (Edge on
Windows). Real Safari on macOS is checked by hand before a release (WebKit is the engine only).

## Bug reports

Pause menu → "Report a bug": the player's description and the game version; the current save and
its seed only when the consent box is ticked. Sent to `POST /v1/bug-reports` (online-api, threat
model C-44: strict schema, ≤ 1 MB, 10/h per IP, no account/contact/IP, 90 days); without an API
(offline builds) the report is downloaded as a JSON file the player can send.
