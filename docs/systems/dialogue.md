# Dialogue

Status: Draft v0.1 · MVP: ✅ · Package: `packages/core/dialogue` + `packages/content/ink` · Back to [GDD](../GDD.md) · [index](README.md) · decision: [ADR 0003](../adr/0003-ink-dialogue.md)

## Purpose

Conversations, confessions, bargains and narrated events, written in **Ink**. Ink controls flow and
text; **core controls state** — Ink reads and writes the WorldState only through external functions.

## Data

- `.ink` sources in `packages/content/ink/`, compiled to JSON at build time.
- Text: Ink lines reference **localization keys** (e.g. `#key:dlg.neda.charm.01`) resolved from
  `locales/en.json` (no hardcoded player-facing strings in code; Ink text is content).
- Choice tags: `#virtue:mercy`, `#sin:wrath`, `#check:persuasion:hard`, `#noSinTakeover`, `#forbidden`.
- External functions (whitelist): `get(path)`, `flag(id)`, `setFlag(id)`, `affinity(a,b)`,
  `changeAffinity(a,b,delta)`, `check(skill, difficulty)`, `give(itemId, qty)`, `take(itemId, qty)`,
  `addClue(id)`, `addDebt(amount, creditor)`, `time()`, `chapter()`.

## Rules

1. Ink never mutates state directly; every external function maps to a core command validated by core.
2. `check()` returns success and omen; Ink branches on both.
3. Sin takeover ([virtue-sin](virtue-sin.md)) is applied by core before choices are shown.
4. Hidden villager states (possession) are exposed to Ink only through symptom functions, never the truth.
5. Each knot is short; long scenes are split so they can be interrupted by the night.

## Initial formulas

- Time cost: 15 in-world minutes per conversation (5 for barks).

## Events

- **Emits:** `dialogue/started`, `dialogue/choiceMade { tags }`, `dialogue/ended`.
- **Consumes:** state snapshot; core events that unlock knots (`villager/secretRevealed`).

## Edge cases

- Ink story version changed in a save → resume at the start of the current knot (store knot path, not pointer).
- External function called with unknown ID → error in dev, safe no-op + telemetry in prod.

## Test ideas

- Lint: every `.ink` line has a localization key that exists in `en.json`.
- Every external function used in Ink is in the whitelist (static scan).
- Golden tests: scripted choice sequences produce expected state diffs.
- `noSinTakeover` choices are respected.

## Implementation (v1)

Supersedes the draft where they differ.

- **Sources:** `packages/content/ink/<story>.ink`, English text written in the story (Ink is content;
  other languages will get their own `.ink` set). A villager (`dialogue`) or a POI (`dialogue`)
  names its story.
- **Compilation:** `inkjs` compiles `.ink` → JSON at build time (Vite plugin in the game: dev,
  build and tests), and `pnpm content:validate` compiles every story in CI.
- **External functions (whitelist):** `get_flag(id)`, `set_flag(id)`, `get_stat(id)`,
  `add_stat(id, value)`, `has_item(id, qty)`, `give_item(id, qty)`, `skill_level(id)`,
  `villager_state(id)` (visible status only — never a hidden possession), `record_decision(id, choice)`.
  Writes become core commands (`applyEffects`, `recordDecision`), validated by core.
- **Ink keeps no state between conversations:** everything that must be remembered is a flag, a
  stat or a decision in the WorldState. Each conversation starts at the story's top.
- **Line tags:** `#shake`, `#whisper`, `#sfx:<id>`, `#speaker:<villager|guardian>`.
- **Choice tags:** nature `#empathy | #threat | #lie | #occult` (icon); `#virtue:<id>`, `#sin:<id>`,
  `#noSinTakeover`; requirements `#requires:flag:<id>`, `#requires:item:<id>:<qty>`,
  `#requires:skill:<id>:<rank>`, `#requires:stat:<id>:<min>`. A choice whose requirement fails is
  **shown disabled with its requirement**, never hidden.
- **Choosing** goes through the core command `dialogueChoice` (V1–V5 of
  [progression](progression.md)): blocked choices are refused, the sin may take over, the tags
  apply virtue/sin and the choice is recorded (`dialogue/choiceMade`).
- **Static validation (CI):** stories compile; only whitelisted externals; every flag id passed to
  `get_flag`/`set_flag` or used in `#requires:flag:` is declared in `flags.json`; stat, item, skill
  and villager ids exist; choice tags are known; content `dialogue` refs name existing stories.
- **UI:** portrait, name, text revealed letter by letter (skippable; instant with reduced motion),
  choices with nature icons, disabled choices with their requirement, a history of the
  conversation, effects for `#shake` / `#whisper` / `#sfx`.
- A conversation costs nothing in time in v1 (the 15 minutes rule waits for the scheduler).
