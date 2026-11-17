/**
 * In-world input: held keys by remappable action (KeyboardEvent.code, docs/ui/accessibility.md)
 * and the standard-mapping gamepad. Edges ("pressed this frame") for one-shot actions.
 */
import { PAD_INDEX, type Binding } from '@mrak/ui-kit';
import type { ActionId } from '../../input/bindings';
import { snap8, STICK_DEADZONE, type Vec } from './movement';

type Bindings = Record<ActionId, Binding>;

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, select, textarea, [contenteditable="true"]') !== null
  );
}

export class Controls {
  private readonly held = new Set<string>();
  private readonly pressedKeys = new Set<string>();
  private padPrev = new Set<number>();
  private padNow = new Set<number>();
  private stick: Vec = { x: 0, y: 0 };
  private readonly onDown = (e: KeyboardEvent): void => {
    if (typing(e.target)) return;
    if (!e.repeat) this.pressedKeys.add(e.code);
    this.held.add(e.code);
  };
  private readonly onUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };
  private readonly onBlur = (): void => {
    this.held.clear();
  };

  constructor(
    private readonly bindings: () => Bindings,
    private readonly target: Window = window,
  ) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  /** Call once per frame before reading edges. */
  poll(): void {
    this.padPrev = this.padNow;
    this.padNow = new Set();
    this.stick = { x: 0, y: 0 };
    const pads =
      typeof navigator !== 'undefined' && 'getGamepads' in navigator ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p?.connected && p.mapping === 'standard') ?? null;
    if (!pad) return;
    pad.buttons.forEach((b, i) => {
      if (b.pressed) this.padNow.add(i);
    });
    this.stick = snap8({ x: pad.axes[0] ?? 0, y: pad.axes[1] ?? 0 }, STICK_DEADZONE);
  }

  /** Clears one-shot presses (end of frame). */
  endFrame(): void {
    this.pressedKeys.clear();
  }

  /** Forget everything held (e.g. a menu opened). */
  release(): void {
    this.held.clear();
    this.pressedKeys.clear();
  }

  isDown(action: ActionId): boolean {
    const b = this.bindings()[action];
    if (b.keys.some((k) => this.held.has(k))) return true;
    return b.pad !== undefined && this.padNow.has(PAD_INDEX[b.pad]);
  }

  pressed(action: ActionId): boolean {
    const b = this.bindings()[action];
    if (b.keys.some((k) => this.pressedKeys.has(k))) return true;
    if (b.pad === undefined) return false;
    const i = PAD_INDEX[b.pad];
    return this.padNow.has(i) && !this.padPrev.has(i);
  }

  /** Left stick, snapped to 8 directions. */
  stickVector(): Vec {
    return this.stick;
  }

  /** True when the gamepad was used this frame (for prompts and aiming). */
  padActive(): boolean {
    return this.padNow.size > 0 || this.stick.x !== 0 || this.stick.y !== 0;
  }
}
