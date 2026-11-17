# Design system

Status: v1 · Package: `packages/ui-kit` (tokens, components, icons, Storybook) · Back to
[UI index](README.md) · Pillar 6: _the UI is clear and friendly even when the world is not._

The world of MRAK is dark and uncertain; the interface is not. It looks like a **folk engraving on
parchment and soot**: woodcut silhouettes, double ruled frames, warm candle light on dark earth.
It reads instantly: icons always come with a name, numbers are big, and nothing important is
hidden behind a hover-only or right-click-only control.

## 1. Palette

Tokens live in `packages/ui-kit/src/styles/tokens.css` (`--mrak-*`) and are mirrored in
`src/tokens.ts`, where a unit test checks every text/background pair against WCAG AA.

| Family       | Token                  | Hex       | Use                                               |
| ------------ | ---------------------- | --------- | ------------------------------------------------- |
| Earth (soot) | `--mrak-earth-950`     | `#0e0a08` | App background, letterbox                         |
|              | `--mrak-earth-900`     | `#17110d` | Panel background                                  |
|              | `--mrak-earth-800`     | `#221a14` | Raised surface, inputs, slots                     |
|              | `--mrak-earth-700`     | `#33271e` | Hover surface, dividers                           |
|              | `--mrak-earth-500`     | `#6b5642` | Borders, engraved rules                           |
| Blood red    | `--mrak-blood-800`     | `#4a0d0d` | Danger surface                                    |
|              | `--mrak-blood-600`     | `#8a1c1c` | Danger button background (with parchment text)    |
|              | `--mrak-blood-400`     | `#d4574d` | Danger text/icons on dark, selection rule         |
|              | `--mrak-gold-600`      | `#9c6b1c` | Meter fill, pressed primary button                |
|              | `--mrak-gold-400`      | `#e0a94a` | Focus ring, accents, primary icons, links         |
|              | `--mrak-gold-200`      | `#f3d9a0` | Highlighted text, active tab                      |
| Parchment    | `--mrak-parchment-100` | `#f2e8d2` | Body text on dark; tooltip/modal paper background |
|              | `--mrak-parchment-300` | `#cdb98f` | Secondary text on dark                            |
| Ink          | `--mrak-ink-900`       | `#1c1410` | Text on parchment and on gold                     |
| Semantic     | `--mrak-good`          | `#8fbf72` | Gains, success (sage green)                       |
|              | `--mrak-bad`           | `#e07a5f` | Losses, failure                                   |
|              | `--mrak-info`          | `#86b3d1` | Neutral information                               |

Rules:

- Body text is **parchment-100 on earth-900/950** (contrast ≈ 15:1); secondary text parchment-300
  (≈ 9:1). Never use earth-500 or blood-600 for text.
- **Primary** buttons: gold-400 background, ink-900 text. **Danger**: blood-600 background,
  parchment-100 text. **Secondary**: transparent with an engraved border.
- Paper surfaces (tooltips, modals for documents): parchment-100 with ink-900 text.
- Colour is never the only signal: gains/losses also carry `+`/`−` and an arrow icon; states carry an
  icon and a word.

### Colour-blind modes

`data-mrak-colorblind` on `<html>` swaps the semantic tokens to an Okabe–Ito-based set:

| Mode           | good      | bad       | info      |
| -------------- | --------- | --------- | --------- |
| default        | `#8fbf72` | `#e07a5f` | `#86b3d1` |
| `protanopia`   | `#56b4e9` | `#e69f00` | `#cc79a7` |
| `deuteranopia` | `#56b4e9` | `#e69f00` | `#cc79a7` |
| `tritanopia`   | `#009e73` | `#d55e00` | `#cc79a7` |
| `monochrome`   | `#f2e8d2` | `#f2e8d2` | `#f2e8d2` |

(`monochrome` relies entirely on icons, signs and words — useful to verify that rule.)

## 2. Typography

| Role             | Family                                                                | Licence | Where                          |
| ---------------- | --------------------------------------------------------------------- | ------- | ------------------------------ |
| Display (titles) | **IM Fell English SC** — 18th-century letterpress, engraved character | SIL OFL | Game title, panel/modal titles |
| Text (all else)  | **Atkinson Hyperlegible Next** — designed for low-vision readability  | SIL OFL | Everything else                |

Both are self-hosted through `@fontsource/*` (no third-party font requests: privacy/GDPR, offline).
Display is **never** used below 20 px, for numbers, or for more than one line of body text.

### Sizes (at text scale 100 %)

| Token                 | rem   | px  | Use                                      |
| --------------------- | ----- | --- | ---------------------------------------- |
| `--mrak-text-xs`      | 0.875 | 14  | **Minimum.** Key hints, captions, badges |
| `--mrak-text-sm`      | 1     | 16  | Tooltip descriptions, secondary lines    |
| `--mrak-text-md`      | 1.125 | 18  | Body, buttons, menus                     |
| `--mrak-text-lg`      | 1.375 | 22  | HUD values, panel titles                 |
| `--mrak-text-xl`      | 1.75  | 28  | Modal titles                             |
| `--mrak-text-display` | 3     | 48  | Game title                               |

- **Nothing below 14 px** at 100 %. A test (`text-size.test.ts`) fails on any `font-size` in the
  ui-kit or game CSS that is not a token or is below the minimum.
- Text scale (options): 100 / 125 / 150 / 175 / 200 %. It scales the root `font-size`, so every
  rem-based size, spacing and hit area scales with it.
- Line height 1.45 for text, 1.15 for titles; max line length 70ch in documents.

## 3. Spacing, size and shape

- Spacing scale (4 px base): `--mrak-space-1` 4 · `2` 8 · `3` 12 · `4` 16 · `5` 24 · `6` 32 · `7` 48.
- **Hit areas ≥ 44 × 44 px** (WCAG 2.5.5) for every interactive control, 48 px on touch layouts.
- Radii are small (2–4 px): engravings have square corners. Icons: 16 / 20 / 24 / 32 / 48 px.
- Phone layouts keep a 16 px side gutter; panels are `min(32rem, 100vw − 32px)` wide.

## 4. The folk-engraving style

- **Frames:** a double rule — 1 px border (earth-500) plus an inset 1 px line 3 px inside
  (box-shadow) — with optional small corner diamonds. No glossy gradients, no blur glass.
- **Texture:** a faint diagonal hatching (`repeating-linear-gradient`, ≤ 4 % opacity) on panels,
  like cross-hatching in a woodcut. Off in high-contrast and "reduce visual noise" contexts.
- **Icons:** single-colour solid silhouettes (game-icons.net, see [icons](icons.md)), coloured
  through `currentColor` with the palette: gold for resources and actions, parchment for UI,
  blood for danger and the Horned One, semantic colours for states.
- **Motion:** short (120–200 ms) fades and ink-spread reveals; no bouncing. Everything respects
  `prefers-reduced-motion` and the in-game "reduce motion" options.

## 5. States

| State         | Treatment                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------- |
| Default       | Engraved border earth-500                                                                    |
| Hover         | Border gold-400, surface earth-700, icon brightens; never the only way to reveal information |
| Focus-visible | **2 px gold-400 outline, 2 px offset** — never removed; same look for keyboard and gamepad   |
| Active        | Inset shadow, 1 px down                                                                      |
| Selected      | Blood-400 left rule (tabs: bottom rule) + `aria-selected`/`aria-pressed`                     |
| Disabled      | 50 % opacity, `cursor: not-allowed`, **and a tooltip that says why** (`disabledReason`)      |
| Danger        | Blood button + `irreversible` icon; requires confirmation (see UX patterns)                  |
| Loading       | `aria-busy`, a slow candle-flicker on the icon (static with reduced motion)                  |

## 6. Components (`@mrak/ui-kit`)

Panel · Button · IconButton · Tooltip · Tabs · Modal · ConfirmModal · Toast (provider + hook) ·
ProgressMeter · ResourceCounter · ItemSlot · Portrait · KeyHint · ContextMenu · Icon. Every one has
Storybook stories and an axe test. Player-facing strings are **always passed in** (the kit has no
text of its own); generic labels (Close, Undo, key names…) come from `UiKitProvider`, which the game
fills from `locales/en.json`.

## 7. UX patterns

1. **Every icon has a tooltip** with a name and a description. `Icon` requires either `label`
   (+ optional `description`, rendered as a Tooltip) or `decorative` — allowed only when a
   visible text label sits next to it (a Button with text, a counter with its name).
   `IconButton` requires `label` and always shows a tooltip.
2. **Every action shows its cost and its known consequence** before it is taken: `Button`,
   `ContextMenu` items and `ItemSlot` accept `cost` (list of resource icon + amount) and
   `consequence` (text), shown inline or in the tooltip. Unknown consequences are shown as such
   ("Its consequences are unknown") — never silently omitted.
3. **Irreversible actions ask for confirmation** (`ConfirmModal`): the title names the action, the
   body states what is lost, the confirm button repeats the verb ("Accuse Radka"), focus starts
   on **Cancel**, Escape cancels. Accusations, sacrifices, pacts, burning, deleting a save.
4. **Undo where possible** in village management (assigning villagers, queueing builds, moving
   stores): the change applies immediately and a Toast offers **Undo** for 8 s (focusable,
   paused while hovered/focused). Night actions are not undoable — that is the game.
5. **Disabled controls explain why** (tooltip `disabledReason`), never just grey out.
6. **No hidden controls:** every context-menu action is also reachable from a visible button or
   key; long-press on touch, Menu key / Shift+F10 / gamepad Y open context menus.
7. **Numbers without anxiety tricks:** values change with a short highlight and a `+n`/`−n`
   badge; sanity is shown **without numbers** (ProgressMeter `qualitative`).

## 8. HUD

See [hud](hud.md): minimal, icon-based resources, time and phase, village notices, contextual
interaction prompt with the right KeyHint, and it fades when nothing needs attention.

## 9. Accessibility

See [accessibility](accessibility.md) for options (subtitles and sound captions, flashes, shake,
colour-blind modes, remapping, text scale, keyboard/gamepad navigation, fewer scares) and the
audit process (axe in tests and Storybook).
