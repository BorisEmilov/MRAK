import type { UiStringKey } from '../strings';

const NAMED_KEYS: Readonly<Record<string, UiStringKey>> = {
  Space: 'ui.key.space',
  Enter: 'ui.key.enter',
  Escape: 'ui.key.escape',
  Tab: 'ui.key.tab',
  ShiftLeft: 'ui.key.shift',
  ShiftRight: 'ui.key.shift',
  ControlLeft: 'ui.key.control',
  ControlRight: 'ui.key.control',
  AltLeft: 'ui.key.alt',
  AltRight: 'ui.key.alt',
  Backspace: 'ui.key.backspace',
  ArrowUp: 'ui.key.arrow-up',
  ArrowDown: 'ui.key.arrow-down',
  ArrowLeft: 'ui.key.arrow-left',
  ArrowRight: 'ui.key.arrow-right',
  MouseLeft: 'ui.key.mouse-left',
  MouseRight: 'ui.key.mouse-right',
};

/** `KeyE` → `E`, `Digit1` → `1`, `F5` → `F5`, named keys through the strings. */
export function keyLabel(code: string, text: (k: UiStringKey) => string): string {
  const named = NAMED_KEYS[code];
  if (named) return text(named);
  const m = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);
  return m?.[1] ?? code;
}
