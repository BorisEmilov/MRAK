/**
 * Design tokens (docs/ui/design-system.md). The CSS custom properties in styles/tokens.css must
 * match these values; tokens.test.ts checks both the match and WCAG contrast of text pairs.
 */
export const PALETTE = {
  'earth-950': '#0e0a08',
  'earth-900': '#17110d',
  'earth-800': '#221a14',
  'earth-700': '#33271e',
  'earth-500': '#6b5642',
  'blood-800': '#4a0d0d',
  'blood-600': '#8a1c1c',
  'blood-400': '#d4574d',
  'gold-600': '#9c6b1c',
  'gold-400': '#e0a94a',
  'gold-200': '#f3d9a0',
  'parchment-100': '#f2e8d2',
  'parchment-300': '#cdb98f',
  'ink-900': '#1c1410',
  good: '#8fbf72',
  bad: '#e07a5f',
  info: '#86b3d1',
} as const;
export type PaletteToken = keyof typeof PALETTE;

/** Semantic colours per colour-blind mode (Okabe–Ito based). */
export const COLORBLIND_MODES = {
  none: { good: '#8fbf72', bad: '#e07a5f', info: '#86b3d1' },
  protanopia: { good: '#56b4e9', bad: '#e69f00', info: '#cc79a7' },
  deuteranopia: { good: '#56b4e9', bad: '#e69f00', info: '#cc79a7' },
  tritanopia: { good: '#009e73', bad: '#d55e00', info: '#cc79a7' },
  monochrome: { good: '#f2e8d2', bad: '#f2e8d2', info: '#f2e8d2' },
} as const;
export type ColorblindMode = keyof typeof COLORBLIND_MODES;

/** Text/background pairs that ship in the UI, with their required WCAG ratio. */
export const CONTRAST_PAIRS: readonly [fg: string, bg: string, min: number, use: string][] = [
  [PALETTE['parchment-100'], PALETTE['earth-900'], 4.5, 'body text on panel'],
  [PALETTE['parchment-100'], PALETTE['earth-950'], 4.5, 'body text on background'],
  [PALETTE['parchment-300'], PALETTE['earth-900'], 4.5, 'secondary text on panel'],
  [PALETTE['parchment-300'], PALETTE['earth-800'], 4.5, 'secondary text on slot'],
  [PALETTE['gold-200'], PALETTE['earth-900'], 4.5, 'highlight text'],
  [PALETTE['gold-400'], PALETTE['earth-900'], 4.5, 'accent text / links'],
  [PALETTE['ink-900'], PALETTE['gold-400'], 4.5, 'primary button'],
  [PALETTE['parchment-100'], PALETTE['blood-600'], 4.5, 'danger button'],
  [PALETTE['blood-400'], PALETTE['earth-900'], 4.5, 'danger text'],
  [PALETTE['ink-900'], PALETTE['parchment-100'], 4.5, 'tooltip text'],
  [PALETTE.good, PALETTE['earth-900'], 4.5, 'gain'],
  [PALETTE.bad, PALETTE['earth-900'], 4.5, 'loss'],
  [PALETTE.info, PALETTE['earth-900'], 4.5, 'info'],
  [PALETTE['gold-400'], PALETTE['earth-700'], 3, 'focus ring on hover surface (non-text)'],
  [PALETTE['earth-500'], PALETTE['earth-950'], 1.5, 'decorative border'],
];

/** Font sizes in rem (1rem = 16 px at 100 % text scale). 14 px is the minimum. */
export const TEXT_SIZES = {
  xs: 0.875,
  sm: 1,
  md: 1.125,
  lg: 1.375,
  xl: 1.75,
  display: 3,
} as const;
export const MIN_TEXT_PX = 14;

export const TEXT_SCALES = [1, 1.25, 1.5, 1.75, 2] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG 2 contrast ratio. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
