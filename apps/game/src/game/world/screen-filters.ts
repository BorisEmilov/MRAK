/**
 * Camera filters (docs/systems/light.md → Rendering): colour grading (season, sanity, pulled-down
 * moon), vignette, and hallucination distortion. Parameters come from the pure `grade()`.
 */
import type * as Phaser from 'phaser';
import type { GradeOutput } from './grading';

export const NOISE_TEXTURE = 'mrak-distortion-noise';

/** A smooth RGB noise texture for the displacement filter (generated once). */
function ensureNoise(scene: Phaser.Scene): void {
  if (scene.textures.exists(NOISE_TEXTURE)) return;
  const size = 128;
  const canvas = scene.textures.createCanvas(NOISE_TEXTURE, size, size);
  if (!canvas) return;
  const ctx = canvas.getContext();
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const a = (x / size) * Math.PI * 2;
      const b = (y / size) * Math.PI * 2;
      const r = 0.5 + 0.25 * Math.sin(a * 3 + Math.cos(b * 2)) + 0.25 * Math.sin(b * 5 + a);
      const g = 0.5 + 0.25 * Math.cos(b * 3 + Math.sin(a * 2)) + 0.25 * Math.cos(a * 4 - b);
      const o = (y * size + x) * 4;
      image.data[o] = Math.round(r * 255);
      image.data[o + 1] = Math.round(g * 255);
      image.data[o + 2] = 128;
      image.data[o + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  canvas.refresh();
}

export class ScreenFilters {
  private readonly grading: Phaser.Filters.ColorMatrix;
  private readonly vignette: Phaser.Filters.Vignette;
  private readonly displacement: Phaser.Filters.Displacement;
  private distortion = 0;

  constructor(scene: Phaser.Scene, camera: Phaser.Cameras.Scene2D.Camera) {
    ensureNoise(scene);
    this.grading = camera.filters.internal.addColorMatrix();
    this.displacement = camera.filters.internal.addDisplacement(NOISE_TEXTURE, 0, 0);
    this.displacement.setActive(false);
    this.vignette = camera.filters.external.addVignette(0.5, 0.5, 0.78, 0.12, 0x000000);
  }

  apply(out: GradeOutput): void {
    this.grading.colorMatrix.set(out.matrix);
    this.vignette.radius = out.vignette.radius;
    this.vignette.strength = out.vignette.strength;
    this.distortion = out.distortion;
    this.displacement.setActive(out.distortion > 0);
  }

  /** Animates the distortion (call every frame). */
  update(timeMs: number): void {
    if (this.distortion <= 0) return;
    const t = timeMs / 1000;
    this.displacement.x = this.distortion * Math.sin(t * 0.9);
    this.displacement.y = this.distortion * Math.cos(t * 0.6);
  }
}
