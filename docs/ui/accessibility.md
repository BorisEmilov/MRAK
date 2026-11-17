# Accessibility

Status: v1 · Code: `apps/game/src/storage/options.ts`, `apps/game/src/a11y/`, `packages/ui-kit` ·
Back to [UI index](README.md)

Goal: WCAG 2.2 AA for all menus and HUD, plus the game-accessibility basics
(gameaccessibilityguidelines.com "basic" and most "intermediate").

## Options (Options → Accessibility / Controls)

| Option              | Default | Effect                                                                                               |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| Text size           | 100 %   | 100–200 % root scale; all UI uses rem                                                                |
| Subtitles           | on      | Spoken lines shown with speaker name                                                                 |
| Sound captions      | on      | Non-speech sounds as `[Bell tolls, far away]` with a direction hint (`←`/`→`) and the caption icon   |
| Reduce flashes      | off     | Camera flashes become slow fades; no full-screen flashes over 3 Hz ever (always enforced)            |
| Reduce screen shake | off     | Shake amplitude × 0 (with it off: × 1)                                                               |
| Reduce distortion   | off     | No low-sanity screen distortion (existing)                                                           |
| Reduce motion       | system  | UI animations off; follows `prefers-reduced-motion` unless overridden                                |
| Colour-blind mode   | none    | protanopia / deuteranopia / tritanopia / monochrome palettes (see design system)                     |
| Fewer scares        | off     | No jump-scare stingers or sudden full-screen apparitions; dread events are kept but telegraphed      |
| Contextual hints    | on      | Onboarding hints ([onboarding](../systems/onboarding.md))                                            |
| HUD auto-fade       | on      | See [hud](hud.md)                                                                                    |
| Key bindings        | —       | Every action remappable (keyboard; gamepad layout fixed for now); conflicts are swapped, not blocked |

Options are presentation preferences (per device, `localStorage`); they never change game rules
or saves. Phaser reads them through the UI store (`fx` helpers: `shake`, `flash`, `scare`).

## Input

- **Keyboard:** everything reachable with Tab/Shift+Tab, arrows inside composite widgets (tabs,
  menus, sliders), Enter/Space to activate, Escape to close/back. Focus is always visible.
- **Gamepad:** D-pad / left stick move focus spatially between focusable elements, A confirms,
  B goes back (Escape), Y opens context menus, LB/RB switch tabs. `KeyHint` shows the glyph of the
  last used device (Xbox / PlayStation / generic).
- **Pointer & touch:** hit areas ≥ 44 px; long-press = context menu; no hover-only content.

## Audits

- `axe-core` runs in unit tests against every ui-kit component and the game menus (main, load,
  options, pause, glossary, credits): **no `serious` or `critical` violations** allowed.
- Storybook runs the a11y addon on every story (including colour contrast, which jsdom cannot check);
  `tokens.test.ts` verifies the palette contrast pairs.
- `text-size.test.ts` forbids font sizes below the 14 px minimum.
