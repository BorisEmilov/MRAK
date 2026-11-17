/**
 * Phaser 4 lighting of a zone (docs/systems/light.md → Rendering): ambient by time of day, the
 * lantern as a cone light that follows the facing direction, and the map's fixed lights.
 */
import type { Ambient, LightCircle } from '@mrak/core';
import type * as Phaser from 'phaser';
import { TILE } from '../constants';
import { turnTowards } from './movement';
import type { LightDef } from './zone-map';

/** Visual radius of the lantern relative to its rule radius (light fades to 0 at the edge). */
export const LANTERN_VISUAL_FACTOR = 1.6;
/** Full width of the lantern cone (radians) and its soft edge. */
const CONE_INNER = Math.PI * 0.42;
const CONE_OUTER = Math.PI * 0.75;
/** How fast the cone turns (radians per second). */
const TURN_SPEED = 9;
/** Fraction of a fixed light's visual radius that counts as "in the light" for darkness. */
const SAFE_FRACTION = 0.7;

interface Fixed {
  def: LightDef;
  light: Phaser.GameObjects.Light;
  seed: number;
}

export interface LightingFrame {
  ambient: Ambient;
  /** Lantern equipped and lit. */
  lit: boolean;
  /** Lantern rule radius in tiles. */
  radiusTiles: number;
  x: number;
  y: number;
  /** Facing direction (radians). */
  facing: number;
  /** Seconds since the last frame. */
  dt: number;
  /** Milliseconds (scene time). */
  time: number;
}

function toRgb(tint: readonly [number, number, number], level: number): number {
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * level * 255)));
  return (c(tint[0]) << 16) | (c(tint[1]) << 8) | c(tint[2]);
}

function nightish(phase: Ambient['phase']): boolean {
  return phase === 'night' || phase === 'dusk';
}

export class ZoneLighting {
  private readonly lantern: Phaser.GameObjects.Light;
  private readonly spill: Phaser.GameObjects.Light;
  private readonly fixed: Fixed[];
  private angle = Math.PI / 2;
  private lanternOn = false;

  constructor(
    private readonly scene: Phaser.Scene,
    defs: readonly LightDef[],
  ) {
    scene.lights.enable();
    this.lantern = scene.lights.addConeLight(
      0,
      0,
      64,
      0xffc874,
      1.6,
      this.angle,
      CONE_INNER,
      CONE_OUTER,
    );
    this.spill = scene.lights.addLight(0, 0, 28, 0xffb060, 0.7);
    this.fixed = defs.map((def, i) => ({
      def,
      light: scene.lights.addLight(def.x, def.y, def.radius, def.color, def.intensity),
      seed: i * 1.7,
    }));
  }

  /** Extra fixed lights (debug: stress test for the 60 fps budget). */
  addDebugLights(defs: readonly LightDef[]): void {
    for (const def of defs)
      this.fixed.push({
        def,
        light: this.scene.lights.addLight(def.x, def.y, def.radius, def.color, def.intensity),
        seed: this.fixed.length * 1.7,
      });
  }

  get activeLights(): number {
    return this.fixed.filter((f) => f.light.visible).length + (this.lanternOn ? 2 : 0);
  }

  update(f: LightingFrame): void {
    this.scene.lights.setAmbientColor(toRgb(f.ambient.tint, f.ambient.level));
    // Lights matter less in daylight (no glare at noon), fully at night.
    const weight = 1 - 0.7 * f.ambient.level;
    const t = f.time / 1000;

    for (const { def, light, seed } of this.fixed) {
      const on = !def.night || nightish(f.ambient.phase);
      light.setVisible(on);
      if (!on) continue;
      let flicker = 1;
      if (def.kind === 'bonfire' || def.kind === 'hearth')
        flicker = 1 + 0.14 * Math.sin(t * 11 + seed) * Math.sin(t * 4.3 + seed * 2);
      else if (def.kind === 'candle' || def.kind === 'window')
        flicker = 1 + 0.06 * Math.sin(t * 7 + seed) * Math.sin(t * 2.9 + seed);
      else if (def.kind === 'spirit') flicker = 0.75 + 0.25 * Math.sin(t * 1.6 + seed);
      light.intensity = def.intensity * flicker * weight;
    }

    this.lanternOn = f.lit;
    this.lantern.setVisible(f.lit);
    this.spill.setVisible(f.lit);
    if (!f.lit) return;
    this.angle = turnTowards(this.angle, f.facing, TURN_SPEED * f.dt);
    const flicker = 1 + 0.08 * Math.sin(t * 9.1) * Math.sin(t * 3.7);
    const radius = Math.max(TILE, f.radiusTiles * TILE * LANTERN_VISUAL_FACTOR);
    this.lantern.x = f.x;
    this.lantern.y = f.y - 4;
    this.lantern.radius = radius * flicker;
    this.lantern.z = radius * 0.12;
    this.lantern.setConeRotation(this.angle);
    this.lantern.intensity = 1.7 * weight;
    this.spill.x = f.x;
    this.spill.y = f.y - 6;
    this.spill.radius = Math.max(20, radius * 0.4) * flicker;
    this.spill.intensity = 0.8 * weight;
  }

  /** Circles (pixels) that count as light for the darkness rule. */
  safeCircles(
    f: Pick<LightingFrame, 'ambient' | 'lit' | 'radiusTiles' | 'x' | 'y'>,
  ): LightCircle[] {
    const out: LightCircle[] = this.fixed
      .filter(({ def }) => !def.night || nightish(f.ambient.phase))
      .map(({ def }) => ({ x: def.x, y: def.y, radius: def.radius * SAFE_FRACTION }));
    if (f.lit) out.push({ x: f.x, y: f.y, radius: f.radiusTiles * TILE });
    return out;
  }

  destroy(): void {
    for (const { light } of this.fixed) this.scene.lights.removeLight(light);
    this.scene.lights.removeLight(this.lantern);
    this.scene.lights.removeLight(this.spill);
  }
}
