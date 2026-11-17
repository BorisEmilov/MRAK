/**
 * Gathering points in the world (docs/systems/inventory.md → Gathering points): a small tuft with
 * blossoms in the point's tint. Out of season the plant is not there at all; picked clean, only
 * the bare stems remain. Textures are drawn once per tint.
 */
import type { GatherStatus } from '@mrak/core';
import type * as Phaser from 'phaser';
import { pickUnseen, shiftOffset } from './perception';

const SIZE = 16;
const DEPTH = 9;

export interface PlantPoint {
  id: string;
  x: number;
  y: number;
  tint: string;
}

/** Deterministic tuft: stems, leaves and (unless bare) blossoms. */
export function plantPixels(tint: string, bare: boolean): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(new ArrayBuffer(SIZE * SIZE * 4));
  const put = (x: number, y: number, [r, g, b]: readonly number[], a = 255): void => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    data[i] = r ?? 0;
    data[i + 1] = g ?? 0;
    data[i + 2] = b ?? 0;
    data[i + 3] = a;
  };
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const stem = [58, 92, 44];
  const leaf = [84, 120, 56];
  const bloom = hex(tint);
  const stems: readonly [number, number][] = [
    [4, 6],
    [7, 3],
    [10, 5],
    [12, 8],
  ];
  for (const [x, top] of stems) {
    for (let y = top; y < SIZE - 1; y++) put(x + (y % 5 === 0 ? 1 : 0), y, stem);
    put(x - 1, top + 4, leaf);
    put(x + 1, top + 6, leaf);
    if (!bare) {
      put(x, top - 1, bloom);
      put(x - 1, top, bloom);
      put(x + 1, top, bloom);
      put(x, top, [255, 240, 200]);
    }
  }
  for (let x = 2; x < SIZE - 2; x++) put(x, SIZE - 1, [40, 52, 30], 160);
  return data;
}

export class GatherPlants {
  private readonly sprites = new Map<string, Phaser.GameObjects.Image>();

  constructor(
    private readonly scene: Phaser.Scene,
    points: readonly PlantPoint[],
  ) {
    for (const p of points) {
      const key = this.texture(p.tint, false);
      this.texture(p.tint, true);
      const sprite = scene.add.image(p.x, p.y, key).setDepth(DEPTH).setVisible(false);
      sprite.setData('tint', p.tint);
      this.sprites.set(p.id, sprite);
    }
  }

  private texture(tint: string, bare: boolean): string {
    const key = `plant-${tint.slice(1)}${bare ? '-bare' : ''}`;
    if (this.scene.textures.exists(key)) return key;
    const canvas = this.scene.textures.createCanvas(key, SIZE, SIZE);
    const ctx = canvas?.getContext();
    if (canvas && ctx) {
      ctx.putImageData(new ImageData(plantPixels(tint, bare), SIZE, SIZE), 0, 0);
      canvas.refresh();
    }
    return key;
  }

  update(status: Readonly<Record<string, GatherStatus>>): void {
    for (const [id, sprite] of this.sprites) {
      const s = status[id];
      sprite.setVisible(s !== undefined && s !== 'season');
      if (s === 'ready' || s === 'regrowing') {
        const tint = String(sprite.getData('tint'));
        sprite.setTexture(this.texture(tint, s === 'regrowing'));
      }
    }
  }

  /** Low Sanity: one plant out of `view` shifts a little; `restore` puts every plant back. */
  shiftUnseen(view: { x: number; y: number; width: number; height: number }, turn: number): void {
    const list = [...this.sprites.values()].filter((s) => s.visible);
    const i = pickUnseen(list, view, turn);
    const sprite = list[i];
    if (!sprite) return;
    if (sprite.getData('home') === undefined) sprite.setData('home', { x: sprite.x, y: sprite.y });
    const { dx, dy } = shiftOffset(turn);
    const home = sprite.getData('home') as { x: number; y: number };
    sprite.setPosition(home.x + dx, home.y + dy);
  }

  restore(): void {
    for (const s of this.sprites.values()) {
      const home = s.getData('home') as { x: number; y: number } | undefined;
      if (home) s.setPosition(home.x, home.y);
    }
  }

  destroy(): void {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
  }
}
