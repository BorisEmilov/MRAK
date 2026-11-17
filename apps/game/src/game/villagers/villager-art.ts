/**
 * Placeholder pixel art for villagers, drawn from their content `look` (colours, headwear,
 * beard, build). The world sprite frames, the panel portrait and the returned dead all come from
 * the same pixels, so a returned villager keeps their face. Pure: returns RGBA buffers.
 */
import type { VillagerLook } from '@mrak/content-schema';

export const FRAME = 16;
export const FRAMES = ['idle', 'walk-1', 'walk-2', 'work-1', 'work-2', 'cower'] as const;
export type FrameName = (typeof FRAMES)[number];
export type ArtVariant = 'living' | 'returned';

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

// Template legend: S skin · H hair · C clothes · A accent · E eye · L legs/boots · . empty.
const HEAD = [
  '................',
  '......HHHH......',
  '.....HHHHHH.....',
  '.....HSSSSH.....',
  '.....SESSES.....',
  '.....SSSSSS.....',
  '......SSSS......',
];
const BODY: Record<FrameName, string[]> = {
  idle: [
    '....CCCCCCCC....',
    '...CCCCAACCCC...',
    '...SCCCAACCCS...',
    '...SCCCCCCCCS...',
    '....CCCCCCCC....',
    '....CCCCCCCC....',
    '.....CC..CC.....',
    '.....LL..LL.....',
    '................',
  ],
  'walk-1': [
    '....CCCCCCCC....',
    '...CCCCAACCCC...',
    '..SCCCCAACCCC...',
    '....CCCCCCCCS...',
    '....CCCCCCCC....',
    '....CCCCCCCC....',
    '....CC....CC....',
    '...LL......LL...',
    '................',
  ],
  'walk-2': [
    '....CCCCCCCC....',
    '...CCCCAACCCC...',
    '...CCCCAACCCCS..',
    '...SCCCCCCCC....',
    '....CCCCCCCC....',
    '....CCCCCCCC....',
    '.....CCCCCC.....',
    '......LLLL......',
    '................',
  ],
  'work-1': [
    '..S.CCCCCCCC.S..',
    '..SCCCCAACCCCS..',
    '...CCCCAACCCC...',
    '....CCCCCCCC....',
    '....CCCCCCCC....',
    '....CCCCCCCC....',
    '.....CC..CC.....',
    '.....LL..LL.....',
    '................',
  ],
  'work-2': [
    '....CCCCCCCC....',
    '...CCCCAACCCC...',
    '..SSCCCAACCCSS..',
    '....CCCCCCCC....',
    '....CCCCCCCC....',
    '....CCCCCCCC....',
    '.....CC..CC.....',
    '.....LL..LL.....',
    '................',
  ],
  cower: [
    '...SCCCCCCCCS...',
    '...CCCCAACCCC...',
    '...CCCCAACCCC...',
    '....CCCCCCCC....',
    '....CCCCCCCC....',
    '....LLL..LLL....',
    '................',
    '................',
    '................',
  ],
};

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(c: Rgb, f: number): Rgb {
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const OUTLINE: Rgb = [24, 18, 16];
const PALE: Rgb = [176, 190, 170];

/** Colours of a look; the returned are grave-pale with dull clothes and red eyes. */
export function paletteOf(look: VillagerLook, variant: ArtVariant): Record<string, Rgb> {
  const skin = hexToRgb(look.skin);
  const base = {
    S: skin,
    H: hexToRgb(look.hair),
    C: hexToRgb(look.clothes),
    A: hexToRgb(look.accent),
    E: [30, 22, 20] as Rgb,
    L: [52, 40, 32] as Rgb,
  };
  if (variant === 'living') return base;
  return {
    S: mix(skin, PALE, 0.75),
    H: shade(base.H, 0.6),
    C: shade(mix(base.C, [70, 70, 70], 0.6), 0.7),
    A: shade(mix(base.A, [70, 70, 70], 0.6), 0.7),
    E: [190, 30, 30],
    L: [30, 28, 26],
  };
}

/** The template rows of a frame, with headwear, beard and build applied. */
export function frameRows(look: VillagerLook, frame: FrameName): string[] {
  const head = HEAD.map((r) => r.split(''));
  const set = (rows: string[][], x: number, y: number, c: string): void => {
    const row = rows[y];
    if (row && x >= 0 && x < FRAME) row[x] = c;
  };
  if (look.beard) {
    for (const x of [5, 6, 9, 10]) set(head, x, 5, 'H');
    for (const x of [6, 7, 8, 9]) set(head, x, 6, 'H');
  }
  // Headwear: W = hat (dark), K = kerchief (accent colour).
  switch (look.headwear) {
    case 'kerchief':
      for (let x = 5; x <= 10; x++) set(head, x, 1, 'A');
      for (let x = 4; x <= 11; x++) set(head, x, 2, 'A');
      set(head, 4, 3, 'A');
      set(head, 11, 3, 'A');
      set(head, 4, 4, 'A');
      set(head, 11, 4, 'A');
      break;
    case 'cap':
      for (let x = 5; x <= 10; x++) set(head, x, 1, 'W');
      for (let x = 4; x <= 11; x++) set(head, x, 2, 'W');
      break;
    case 'kalpak':
      for (let x = 5; x <= 10; x++) set(head, x, 0, 'W');
      for (let x = 5; x <= 10; x++) set(head, x, 1, 'W');
      for (let x = 4; x <= 11; x++) set(head, x, 2, 'W');
      break;
    case 'kalimavkion':
      for (let x = 4; x <= 11; x++) set(head, x, 0, 'W');
      for (let x = 5; x <= 10; x++) set(head, x, 1, 'W');
      for (let x = 5; x <= 10; x++) set(head, x, 2, 'W');
      break;
    case 'none':
      break;
  }
  const body = BODY[frame].map((r) => r.split(''));
  if (look.build === 'broad')
    for (const row of body.slice(0, 6)) {
      const first = row.indexOf('C');
      const last = row.lastIndexOf('C');
      if (first > 0) row[first - 1] = row[first - 1] === '.' ? 'C' : (row[first - 1] ?? '.');
      if (last >= 0 && last < FRAME - 1)
        row[last + 1] = row[last + 1] === '.' ? 'C' : (row[last + 1] ?? '.');
    }
  let rows = [...head, ...body].map((r) => r.join(''));
  if (frame === 'cower')
    rows = ['................', '................', ...rows.slice(0, FRAME - 2)];
  if (look.build === 'stooped') {
    // The head hangs forward and down by a pixel.
    rows = rows.map((r, y) => (y < HEAD.length ? `.${r.slice(0, FRAME - 1)}` : r));
    rows = ['................', ...rows.slice(0, FRAME - 1)];
  }
  return rows.slice(0, FRAME);
}

function colourOf(c: string, palette: Record<string, Rgb>): Rgb | null {
  if (c === '.') return null;
  if (c === 'W') return shade(palette['H'] ?? OUTLINE, 0.45);
  return palette[c] ?? null;
}

/** One 16 × 16 frame as RGBA, with a dark outline around the figure. */
export function framePixels(look: VillagerLook, frame: FrameName, variant: ArtVariant): Pixels {
  const rows = frameRows(look, frame);
  const palette = paletteOf(look, variant);
  const data = new Uint8ClampedArray(FRAME * FRAME * 4);
  const filled = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < FRAME && y < FRAME && (rows[y]?.[x] ?? '.') !== '.';
  for (let y = 0; y < FRAME; y++)
    for (let x = 0; x < FRAME; x++) {
      const o = (y * FRAME + x) * 4;
      let rgb = colourOf(rows[y]?.[x] ?? '.', palette);
      if (!rgb && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)))
        rgb = OUTLINE;
      if (!rgb) continue;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
  return { width: FRAME, height: FRAME, data };
}

/** Every frame side by side (a strip FRAMES × 16 px wide), for one texture per villager. */
export function stripPixels(look: VillagerLook, variant: ArtVariant): Pixels {
  const width = FRAME * FRAMES.length;
  const data = new Uint8ClampedArray(width * FRAME * 4);
  FRAMES.forEach((name, i) => {
    const f = framePixels(look, name, variant);
    for (let y = 0; y < FRAME; y++)
      data.set(f.data.subarray(y * FRAME * 4, (y + 1) * FRAME * 4), (y * width + i * FRAME) * 4);
  });
  return { width, height: FRAME, data };
}

/** Head and shoulders of the idle frame, scaled up (nearest neighbour) on a dark ground. */
export function portraitPixels(look: VillagerLook, variant: ArtVariant, scale = 6): Pixels {
  const crop = { x: 2, y: 0, w: 12, h: 12 };
  const src = framePixels(look, 'idle', variant);
  const width = crop.w * scale;
  const height = crop.h * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  const ground: Rgb = variant === 'returned' ? [28, 34, 32] : [46, 36, 28];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = crop.x + Math.floor(x / scale);
      const sy = crop.y + Math.floor(y / scale);
      const s = (sy * FRAME + sx) * 4;
      const o = (y * width + x) * 4;
      const opaque = (src.data[s + 3] ?? 0) > 0;
      data[o] = opaque ? (src.data[s] ?? 0) : ground[0];
      data[o + 1] = opaque ? (src.data[s + 1] ?? 0) : ground[1];
      data[o + 2] = opaque ? (src.data[s + 2] ?? 0) : ground[2];
      data[o + 3] = 255;
    }
  return { width, height, data };
}
