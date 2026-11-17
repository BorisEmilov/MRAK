/**
 * Creatures of the night in the scene (docs/systems/night-exploration.md → Implementation): one
 * sprite per active encounter of the zone, moved by the core AI (`stepCreature`) from what it
 * hears and sees; a creature that reaches the guardian strikes (a core command).
 */
import {
  effectiveStat,
  newAgent,
  stepCreature,
  type ContentDatabase,
  type CreatureAgent,
  type Snapshot,
} from '@mrak/core';
import type * as Phaser from 'phaser';
import { TILE_SIZE } from '@mrak/content-schema';
import { patrolAround } from './alerts';

const STRIKE_COOLDOWN_MS = 1500;
const REACH_TILES = 0.6;
const DEPTH = 11;

interface Live {
  id: number;
  creature: string;
  sprite: Phaser.GameObjects.Image;
  agent: CreatureAgent;
  patrol: { x: number; y: number }[];
  lastStrike: number;
}

export interface NightHost {
  content: ContentDatabase;
  snapshot(): Snapshot | null;
  dispatch(command: { type: 'creatureStrikes'; encounter: number }): { ok: boolean };
}

export class NightCreatures {
  private readonly live = new Map<number, Live>();
  private flash = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: NightHost,
    private readonly zone: string,
    private readonly pois: readonly { id: string; x: number; y: number }[],
  ) {}

  private texture(creature: string): string {
    const key = `creature-${creature}`;
    if (this.scene.textures.exists(key)) return key;
    const size = 24;
    const canvas = this.scene.textures.createCanvas(key, size, size);
    const ctx = canvas?.getContext();
    if (canvas && ctx) {
      ctx.fillStyle = creature === 'returned' ? '#8d8f86' : '#141018';
      ctx.beginPath();
      ctx.ellipse(12, 14, 8, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = creature === 'lesser-bes' ? '#e0b030' : '#d0303a';
      ctx.fillRect(8, 10, 2, 2);
      ctx.fillRect(14, 10, 2, 2);
      canvas.refresh();
    }
    return key;
  }

  /** Spawns sprites for new encounters of this zone and removes ended ones. */
  sync(snapshot: Snapshot): void {
    const active = snapshot.night.encounters.filter(
      (e) => e.state === 'active' && e.zone === this.zone,
    );
    for (const [id, l] of this.live)
      if (!active.some((e) => e.id === id)) {
        l.sprite.destroy();
        this.live.delete(id);
      }
    for (const e of active) {
      if (this.live.has(e.id)) continue;
      const poi = this.pois.find((p) => p.id === e.poi);
      if (!poi) continue;
      const start = { x: poi.x / TILE_SIZE, y: poi.y / TILE_SIZE };
      const sprite = this.scene.add.image(poi.x, poi.y, this.texture(e.creature)).setDepth(DEPTH);
      this.live.set(e.id, {
        id: e.id,
        creature: e.creature,
        sprite,
        agent: newAgent(start),
        patrol: patrolAround(start.x, start.y),
        lastStrike: 0,
      });
    }
  }

  /** The lantern flashed: every light-shy creature flees on the next step. */
  flashed(): void {
    this.flash = true;
  }

  update(
    time: number,
    dt: number,
    guardian: { x: number; y: number },
    lightTiles: number,
    noise: number,
  ): void {
    const at = { x: guardian.x / TILE_SIZE, y: guardian.y / TILE_SIZE };
    // Darkness levels make creatures keener: they see and hear further.
    const snapshot = this.host.snapshot();
    const keen =
      snapshot && this.host.content.hasStat('creature-cunning-rate')
        ? effectiveStat(snapshot, this.host.content, 'creature-cunning-rate')
        : 1;
    for (const l of this.live.values()) {
      const base = this.host.content.get('creatures', l.creature).ai;
      const ai = { ...base, sight: base.sight * keen, hearing: base.hearing * keen };
      l.agent = stepCreature(
        l.agent,
        ai,
        { guardian: at, noise, light: lightTiles, flash: this.flash },
        dt,
        l.patrol,
      );
      l.sprite.setPosition(l.agent.pos.x * TILE_SIZE, l.agent.pos.y * TILE_SIZE);
      l.sprite.setAlpha(l.agent.mode === 'flee' ? 0.5 : 1);
      const near = Math.hypot(l.agent.pos.x - at.x, l.agent.pos.y - at.y) <= REACH_TILES;
      if (near && l.agent.mode === 'hunt' && time - l.lastStrike >= STRIKE_COOLDOWN_MS) {
        l.lastStrike = time;
        this.host.dispatch({ type: 'creatureStrikes', encounter: l.id });
      }
    }
    this.flash = false;
  }

  destroy(): void {
    for (const l of this.live.values()) l.sprite.destroy();
    this.live.clear();
  }
}
