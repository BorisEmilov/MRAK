/**
 * Screen effects that respect the accessibility options (docs/ui/accessibility.md). Scenes must use
 * these instead of calling camera.shake/flash directly.
 */
import type { Options } from '../storage/options';

type FxOptions = Pick<Options, 'reduceShake' | 'reduceFlashes' | 'fewerScares'>;

export interface FxCamera {
  shake(duration: number, intensity: number): unknown;
  flash(duration: number, red: number, green: number, blue: number): unknown;
  fadeIn(duration: number, red: number, green: number, blue: number): unknown;
}

/** WCAG 2.3.1: never more than 3 flashes per second, whatever the options. */
export const MIN_FLASH_INTERVAL_MS = 1000 / 3;

export class ScreenFx {
  private lastFlash = -Infinity;

  constructor(
    private readonly options: () => FxOptions,
    private readonly now: () => number = () => performance.now(),
  ) {}

  shake(camera: FxCamera, durationMs: number, intensity: number): boolean {
    if (this.options().reduceShake) return false;
    camera.shake(durationMs, intensity);
    return true;
  }

  /** A flash, or a slow fade from the colour when flashes are reduced. */
  flash(
    camera: FxCamera,
    durationMs: number,
    rgb: [number, number, number] = [255, 255, 255],
  ): 'flash' | 'fade' | 'skipped' {
    const now = this.now();
    if (now - this.lastFlash < MIN_FLASH_INTERVAL_MS) return 'skipped';
    this.lastFlash = now;
    if (this.options().reduceFlashes) {
      camera.fadeIn(Math.max(durationMs * 4, 600), ...rgb);
      return 'fade';
    }
    camera.flash(durationMs, ...rgb);
    return 'flash';
  }

  /** Whether a jump scare (sudden apparition, stinger) may play. */
  allowScare(): boolean {
    return !this.options().fewerScares;
  }
}
