/**
 * Normal maps from albedo art (docs/systems/light.md → Rendering). Height = luminance (dark
 * cracks sink, bright edges rise), with transparent pixels as the floor so silhouettes get a
 * bevel. Sobel gradients per pixel, never across a frame/tile boundary of `cell` pixels, so
 * neighbouring tiles in a tileset or atlas do not bleed into each other.
 */
import { createImage, type Rgba } from './png';

export interface NormalOptions {
  /** Tile/frame size; gradients are not sampled across these boundaries (0 = whole image). */
  cell?: number;
  /** Bump strength (higher = deeper relief). */
  strength?: number;
}

export function normalMapOf(image: Rgba, options: NormalOptions = {}): Rgba {
  const { width, height, data } = image;
  const cell = options.cell ?? 0;
  const strength = options.strength ?? 2.2;
  const heightAt = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    const a = (data[i * 4 + 3] ?? 0) / 255;
    heightAt[i] = ((0.299 * r + 0.587 * g + 0.114 * b) / 255) * a + a * 0.35;
  }
  const sameCell = (x0: number, y0: number, x1: number, y1: number): boolean =>
    cell <= 0 ||
    (Math.floor(x0 / cell) === Math.floor(x1 / cell) &&
      Math.floor(y0 / cell) === Math.floor(y1 / cell));
  const h = (x: number, y: number, fx: number, fy: number): number => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    return sameCell(fx, fy, cx, cy)
      ? (heightAt[cy * width + cx] ?? 0)
      : (heightAt[fy * width + fx] ?? 0);
  };
  const out = createImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tl = h(x - 1, y - 1, x, y);
      const t = h(x, y - 1, x, y);
      const tr = h(x + 1, y - 1, x, y);
      const l = h(x - 1, y, x, y);
      const r = h(x + 1, y, x, y);
      const bl = h(x - 1, y + 1, x, y);
      const b = h(x, y + 1, x, y);
      const br = h(x + 1, y + 1, x, y);
      const dx = tr + 2 * r + br - (tl + 2 * l + bl);
      const dy = bl + 2 * b + br - (tl + 2 * t + tr);
      // Image y grows downwards; the normal's green points up the screen.
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * width + x) * 4;
      out.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out.data[o + 3] = 255;
    }
  }
  return out;
}
