# ADR 0001 — Browser-first game with Phaser 4 for the world and React for the UI

- Status: accepted
- Date: 2026-11-15
- Back to [GDD](../GDD.md)

## Context

MRAK is a 2D pixel-art game with heavy UI (journal, deduction board, villager management, talent
trees, tooltips). It must run in the browser first (free demo, frictionless access), and later ship
on desktop and mobile wrappers. Pillar 6 demands a clear, accessible UI.

## Decision

- **Platform:** browser-first (desktop browsers; mobile later via wrapper).
- **World rendering:** **Phaser 4** (WebGL) — scenes, tilemaps, lighting, particles, input.
  Base resolution **640×360**, `pixelArt: true`, integer zoom.
- **UI:** **React** (DOM over the canvas) — journal, board, menus, tooltips, accessibility
  (screen readers, keyboard navigation, scalable fonts).
- **Boundary:** React and Phaser communicate **only** through a typed EventBus and read-only
  snapshots from `packages/core`. No React state updated every frame.
- **Language/tooling:** TypeScript strict, Vite.

## Consequences

- ✔ DOM UI gives accessible text, fonts and layout for free; Phaser does what it is good at.
- ✔ Same build serves demo and full game; wrappers (Electron/Tauri/Capacitor) can reuse it.
- ✘ Two render trees to keep in sync; mitigated by the core snapshot model.
- ✘ Browser constraints: asset size (≤ 2 MB per asset, lazy loading per zone), audio unlock, tab throttling.

## Alternatives considered

- Godot/Unity web export: heavier downloads, weaker DOM-quality UI, harder accessibility.
- Pure Phaser UI: possible but costly for complex text UI and accessibility.
- Pure DOM/canvas without an engine: too much engine work for lighting and tilemaps.
