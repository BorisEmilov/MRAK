/** Input devices and bindings shown by KeyHint (docs/ui/accessibility.md → Input). */
export type InputMode = 'keyboard' | 'gamepad';
export type PadType = 'xbox' | 'playstation' | 'nintendo' | 'generic';
export type PadButton =
  | 'a'
  | 'b'
  | 'x'
  | 'y'
  | 'lb'
  | 'rb'
  | 'lt'
  | 'rt'
  | 'view'
  | 'menu'
  | 'ls'
  | 'rs'
  | 'up'
  | 'down'
  | 'left'
  | 'right';

/** Standard Gamepad mapping (W3C) button index per button. */
export const PAD_INDEX: Readonly<Record<PadButton, number>> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  view: 8,
  menu: 9,
  ls: 10,
  rs: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
};

export interface Binding {
  /** `KeyboardEvent.code` values (`KeyE`, `Space`), or `MouseLeft` / `MouseRight`. */
  keys: readonly string[];
  pad?: PadButton | undefined;
}

export function padTypeOf(id: string): PadType {
  if (/054c|playstation|dualshock|dualsense/i.test(id)) return 'playstation';
  if (/057e|nintendo|switch|joy-con/i.test(id)) return 'nintendo';
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  return 'generic';
}

/** Short glyph shown on the button and its spoken name key (PlayStation face buttons). */
export function padGlyph(
  button: PadButton,
  type: PadType,
): {
  glyph: string;
  spoken?: 'ui.pad.cross' | 'ui.pad.circle' | 'ui.pad.square' | 'ui.pad.triangle';
} {
  if (type === 'playstation') {
    const ps = {
      a: ['✕', 'ui.pad.cross'],
      b: ['○', 'ui.pad.circle'],
      x: ['□', 'ui.pad.square'],
      y: ['△', 'ui.pad.triangle'],
    } as const;
    if (button in ps) {
      const [glyph, spoken] = ps[button as keyof typeof ps];
      return { glyph, spoken };
    }
    const names: Partial<Record<PadButton, string>> = {
      lb: 'L1',
      rb: 'R1',
      lt: 'L2',
      rt: 'R2',
      view: 'Create',
      menu: 'Options',
      ls: 'L3',
      rs: 'R3',
    };
    if (names[button]) return { glyph: names[button] };
  }
  if (type === 'nintendo') {
    // Nintendo swaps A/B and X/Y positions: show the label printed on the button in that place.
    const swapped: Partial<Record<PadButton, string>> = {
      a: 'B',
      b: 'A',
      x: 'Y',
      y: 'X',
      lb: 'L',
      rb: 'R',
      lt: 'ZL',
      rt: 'ZR',
      view: '−',
      menu: '+',
    };
    if (swapped[button]) return { glyph: swapped[button] };
  }
  const xbox: Record<PadButton, string> = {
    a: 'A',
    b: 'B',
    x: 'X',
    y: 'Y',
    lb: 'LB',
    rb: 'RB',
    lt: 'LT',
    rt: 'RT',
    view: 'View',
    menu: 'Menu',
    ls: 'LS',
    rs: 'RS',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
  };
  return { glyph: xbox[button] };
}
