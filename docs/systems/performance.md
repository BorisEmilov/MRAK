# Performance

Status: v1 · Back to [GDD](../GDD.md) · [index](README.md) · tests: [testing](testing.md) ·
lights: [light](light.md) · assets: [asset pipeline](asset-pipeline.md)

## Targets

- **60 fps** on a mid-range laptop (integrated GPU, 4 cores, 8 GB) at 640 × 360 × integer zoom, in
  the village at night (the heaviest scene: lights, villagers, creatures).
- Time to menu < 5 s at 20 Mbps; demo download < 15 MB (asset budgets).
- **Memory flat over 2 hours**: no texture, scene-object or heap growth with play time.

## Rules

1. **Light budget:** Phaser renders ≤ 32 lights per camera (`maxLights`). A map holds ≤ 24 fixed
   lights (`map-light-budget`, content validation); the lantern cone, its spill and night effects
   use the rest. The debug console's "add lights" is the stress test.
2. **Pooling:** objects created while playing are pooled (`apps/game/src/game/pool.ts`): creature
   sprites are parked and reused across encounters and nights; only scene shutdown destroys them.
3. **Far simulation:** villagers outside the camera view (+ 64 px) walk in coarse 250 ms steps
   and are not animated; core keeps simulating everyone (positions are presentation only).
4. **Textures:** generated textures have stable keys (villager strips, icons, plants, creature
   stand-ins) and are created once; zone atlases and tilesets are unloaded when no longer needed
   (`AssetService.unloadExcept`). Nothing keyed by time or counter.
5. **Listeners:** every scene subscription is registered in `cleanups` and removed on `SHUTDOWN`.
6. **No React state per frame:** React receives snapshots at most every 100 ms (`GameHost`).

## Measuring

- FPS: the debug console (F1) shows it; Chrome DevTools Performance for frame breakdowns.
- Memory: `apps/game/e2e/soak.spec.ts` plays in a loop (zone changes, 6-hour time jumps that
  cycle day and night, conversations) and samples texture count, World scene objects and the JS
  heap after a forced GC (CDP). Fails if textures grow by > 8, objects by > 50 or the heap by
  ≥ 25 % between the first and the last sample. Nightly: 120 minutes.

## Edge cases

- Headless browsers have no GPU: E2E use SwiftShader; fps is only meaningful on real hardware.
- A map over the light budget fails `pnpm content:validate`.
