import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from '../../host/content';
import {
  FRAME,
  FRAMES,
  framePixels,
  frameRows,
  hexToRgb,
  portraitPixels,
  stripPixels,
} from './villager-art';

const db = loadContentDatabase();
const look = (id: string) => db.get('villagers', id).look;
const key = (p: { data: Uint8ClampedArray }) => Array.from(p.data).join(',');

describe('villager art', () => {
  it('every frame is 16 rows of 16 template cells', () => {
    for (const v of db.all('villagers'))
      for (const f of FRAMES) {
        const rows = frameRows(v.look, f);
        expect(rows).toHaveLength(FRAME);
        for (const r of rows) expect(r).toHaveLength(FRAME);
      }
  });

  it('uses the look’s colours and is deterministic', () => {
    const velika = look('velika');
    const a = framePixels(velika, 'idle', 'living');
    expect(key(a)).toBe(key(framePixels(velika, 'idle', 'living')));
    const colours = new Set<string>();
    for (let i = 0; i < a.data.length; i += 4)
      if (a.data[i + 3])
        colours.add(`${String(a.data[i])},${String(a.data[i + 1])},${String(a.data[i + 2])}`);
    expect(colours).toContain(hexToRgb(velika.skin).join(','));
    expect(colours).toContain(hexToRgb(velika.clothes).join(','));
  });

  it('gives the eight villagers eight different faces', () => {
    const portraits = db.all('villagers').map((v) => key(portraitPixels(v.look, 'living', 1)));
    expect(new Set(portraits).size).toBe(8);
  });

  it('the returned keep their silhouette but not their colours', () => {
    const velika = look('velika');
    const living = framePixels(velika, 'idle', 'living');
    const returned = framePixels(velika, 'idle', 'returned');
    const alpha = (p: typeof living) => Array.from(p.data.filter((_, i) => i % 4 === 3)).join(',');
    expect(alpha(returned)).toBe(alpha(living));
    expect(key(returned)).not.toBe(key(living));
  });

  it('a strip holds every frame in order', () => {
    const strip = stripPixels(look('petko'), 'living');
    expect(strip.width).toBe(FRAME * FRAMES.length);
    const third = framePixels(look('petko'), FRAMES[2], 'living');
    const row = 8;
    const fromStrip = strip.data.subarray(
      (row * strip.width + 2 * FRAME) * 4,
      (row * strip.width + 3 * FRAME) * 4,
    );
    expect(Array.from(fromStrip)).toEqual(
      Array.from(third.data.subarray(row * FRAME * 4, (row + 1) * FRAME * 4)),
    );
  });

  it('portraits are opaque and scaled', () => {
    const p = portraitPixels(look('pop-stoyan'), 'living', 4);
    expect(p.width).toBe(48);
    expect(p.data.filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true);
  });
});
