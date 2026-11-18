# Asset pipeline

Status: v1 · MVP: ✅ · Script: `apps/game/scripts/build-assets.ts` · Back to [GDD](../GDD.md) ·
[index](README.md) · app: [game-app](game-app.md)

## Purpose

Turn source art and sound into small, cacheable files loaded per zone, and keep the demo
download small (target: first load < 15 MB, time to menu < 5 s at 20 Mbps).

## Data

```
apps/game/assets/
  assets.config.json          groups (sprites?, audio[], demo?), zone → groups, budgets
  art-slots.json              every sprite: category (final size + pivot), frames
  src/sprites/<group>/<name>.aseprite|.ase|.psd|.png   source per slot (Git LFS)
  src/sprites/<group>/<name>_n.*                       optional painted normal map
  src/audio/*.wav             sound sources (Git LFS)
apps/game/public/assets/      generated, gitignored
  atlases/<group>.<hash>.png|json
  audio/<name>.<hash>.ogg|m4a
  manifest.json               { version, groups: { atlases, audio, demo }, zones }
```

## Rules

0. **Slots** ([art direction](../art-direction.md)): each source must match its slot's final size
   (else the build fails); a source without a slot, or a slot without a source, fails too.
   Aseprite files export every frame (`aseprite -b`, frames → `<name>-0…`), PSDs are flattened
   (`magick`); without the tool the build fails with a clear message. `pnpm art:placeholders`
   creates missing sources at the final size. The slot pivot is written into the atlas JSON
   (`pivot`), which Phaser uses as the default origin. The normal-map atlas (`<group>_n`) has the
   same layout: painted `<name>_n` frames or a normal map generated per sprite.
1. **Atlases:** one atlas per group, packed with `free-tex-packer-core` (MaxRects, padding 2,
   extrude 1, no rotation/trim — crisp pixel art), JSON-hash format loaded with `load.atlas`.
2. **Audio:** each sound is encoded twice with ffmpeg — Ogg Vorbis (q3) and AAC 96 kbps in m4a —
   and loaded as `[ogg, m4a]`; browsers without Vorbis (Safari) take the m4a.
3. **Hashing:** every output is named `<name>.<sha256:10>.<ext>`; the manifest is the only
   unhashed file and is served with `no-cache`. Hashed files are `immutable` for a year
   (`apps/game/public/_headers`, honoured by Cloudflare Pages/Netlify; replicate on other CDNs).
   Vite's own hashed code is emitted to `/app/`.
4. **Lazy loading:** `common` loads before the menu; each zone's groups load when the zone is first
   entered (`AssetService.loadZone`), with the simulation paused meanwhile.
5. **Budgets (fail the build):** no file > 2 MB (CLAUDE.md); demo groups ≤ 12 MiB. **Per zone
   (warning):** `common` + the zone's groups + its maps ≤ `maxZoneBytes` (4 MiB) or
   `zoneBytes[zone]`; over it the script warns and, in GitHub Actions, emits a `::warning`
   annotation.
6. **Without ffmpeg** the script warns and skips audio; CI installs ffmpeg and runs it with
   `--require-audio`, so releases always include sound.
7. Current art is **placeholder** pixel art at the final sizes; replace a source file (same name and
   size, any supported format) and run `pnpm --filter @mrak/game assets` — no code changes.

## Initial formulas

`demoBytes = Σ(atlas png + json) + Σ max(ogg, m4a)` over demo groups (one audio format is downloaded).

## Events

Runtime: `load:progress`, `load:complete`, `load:error`, `world:zoneLoading` (UI EventBus).

## Edge cases

- A group that does not fit in one 2048² atlas fails the build (split the group).
- A missing audio source referenced by the config fails the build.
- A failed zone download shows the load error screen (retry reloads the page).

## Test ideas

- Manifest schema parses the generated manifest (the script validates it before writing).
- `bytesOfGroups` counts one audio format per sound (`storage.test.ts`).
- Changing one PNG changes only that group's hashed names; the manifest updates.
- CI: `pnpm --filter @mrak/game run assets --require-audio` fails without ffmpeg.
