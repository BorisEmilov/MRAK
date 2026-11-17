/**
 * Tracks the last input device (for KeyHint glyphs), holds the current bindings, and — when
 * `gamepadNavigation` is on — drives focus with a gamepad: D-pad/stick move focus spatially,
 * A clicks, B sends Escape, Y opens the context menu, LB/RB switch tabs.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { InputContext } from './context';
import { PAD_INDEX, padTypeOf, type Binding, type InputMode, type PadType } from './devices';
import { moveFocus, type Direction } from './spatial';

const REPEAT_DELAY_MS = 400;
const REPEAT_RATE_MS = 120;
const STICK_DEADZONE = 0.5;

function key(doc: Document, keyName: string): void {
  const target = doc.activeElement ?? doc.body;
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }),
  );
}

function cycleTabs(doc: Document, step: 1 | -1): void {
  const tabs = [...doc.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')];
  const current = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  const next = tabs[(current + step + tabs.length) % tabs.length];
  next?.focus();
  next?.click();
}

/** Nudges a focused range input; stepUp/stepDown bypass React's value tracker, so it sees the change. */
function nudgeRange(el: HTMLInputElement, dir: 1 | -1): void {
  if (dir > 0) el.stepUp();
  else el.stepDown();
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function InputProvider({
  bindings,
  gamepadNavigation = false,
  force,
  children,
}: {
  bindings: Readonly<Record<string, Binding>>;
  gamepadNavigation?: boolean;
  /** Fixes the device shown by KeyHint (Storybook, screenshots). */
  force?: { mode: InputMode; padType: PadType } | undefined;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<InputMode>('keyboard');
  const [padType, setPadType] = useState<PadType>('generic');

  useEffect(() => {
    const toKeyboard = (): void => {
      setMode('keyboard');
    };
    window.addEventListener('keydown', toKeyboard, true);
    window.addEventListener('pointerdown', toKeyboard, true);
    return () => {
      window.removeEventListener('keydown', toKeyboard, true);
      window.removeEventListener('pointerdown', toKeyboard, true);
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('getGamepads' in navigator)) return undefined;
    let frame = 0;
    const held = new Map<string, number>(); // control → time of next repeat
    const poll = (time: number): void => {
      frame = requestAnimationFrame(poll);
      const pad = [...navigator.getGamepads()].find((p) => p?.connected);
      if (!pad) return;
      const pressed = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
      const [ax = 0, ay = 0] = pad.axes;
      const controls: Record<string, boolean> = {
        up: pressed(PAD_INDEX.up) || ay < -STICK_DEADZONE,
        down: pressed(PAD_INDEX.down) || ay > STICK_DEADZONE,
        left: pressed(PAD_INDEX.left) || ax < -STICK_DEADZONE,
        right: pressed(PAD_INDEX.right) || ax > STICK_DEADZONE,
        a: pressed(PAD_INDEX.a),
        b: pressed(PAD_INDEX.b),
        y: pressed(PAD_INDEX.y),
        lb: pressed(PAD_INDEX.lb),
        rb: pressed(PAD_INDEX.rb),
      };
      for (const [control, down] of Object.entries(controls)) {
        if (!down) {
          held.delete(control);
          continue;
        }
        const next = held.get(control);
        const repeats = ['up', 'down', 'left', 'right'].includes(control);
        if (next !== undefined && (!repeats || time < next)) continue;
        held.set(control, time + (next === undefined ? REPEAT_DELAY_MS : REPEAT_RATE_MS));
        setMode('gamepad');
        setPadType(padTypeOf(pad.id));
        if (gamepadNavigation) act(control);
      }
    };
    const act = (control: string): void => {
      const active = document.activeElement;
      if (control === 'a' && active instanceof HTMLElement) active.click();
      else if (control === 'b') key(document, 'Escape');
      else if (control === 'y' && active instanceof HTMLElement) {
        const r = active.getBoundingClientRect();
        active.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: r.left,
            clientY: r.bottom,
          }),
        );
      } else if (control === 'lb' || control === 'rb')
        cycleTabs(document, control === 'rb' ? 1 : -1);
      else if (
        (control === 'left' || control === 'right') &&
        active instanceof HTMLInputElement &&
        active.type === 'range'
      )
        nudgeRange(active, control === 'right' ? 1 : -1);
      else if (['up', 'down', 'left', 'right'].includes(control))
        moveFocus(document, control as Direction);
    };
    // Poll only once a gamepad exists (browsers announce it on the first button press).
    const start = (): void => {
      if (frame === 0) frame = requestAnimationFrame(poll);
    };
    if ([...navigator.getGamepads()].some((p) => p?.connected)) start();
    window.addEventListener('gamepadconnected', start);
    return () => {
      window.removeEventListener('gamepadconnected', start);
      cancelAnimationFrame(frame);
    };
  }, [gamepadNavigation]);

  const value = useMemo(
    () => ({ mode: force?.mode ?? mode, padType: force?.padType ?? padType, bindings }),
    [mode, padType, bindings, force?.mode, force?.padType],
  );
  return <InputContext.Provider value={value}>{children}</InputContext.Provider>;
}
