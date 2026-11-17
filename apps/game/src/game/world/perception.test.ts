import { describe, expect, it } from 'vitest';
import { corruptionTint, perceptionFrame, pickUnseen, shiftOffset } from './perception';

describe('perception in the world', () => {
  it('maps tier effects to the scene', () => {
    expect(perceptionFrame(null)).toEqual({ staring: false, movingObjects: false });
    expect(
      perceptionFrame({
        tier: 4,
        effects: ['filter', 'staring', 'moving-objects'],
        whisperKeys: [],
      }),
    ).toEqual({ staring: true, movingObjects: true });
  });

  it('only moves what nobody sees', () => {
    const view = { x: 0, y: 0, width: 100, height: 100 };
    const pts = [
      { x: 50, y: 50 },
      { x: 150, y: 50 },
      { x: -10, y: 20 },
    ];
    expect(pickUnseen(pts, view, 0)).toBe(1);
    expect(pickUnseen(pts, view, 1)).toBe(2);
    expect(pickUnseen([{ x: 1, y: 1 }], view, 0)).toBe(-1);
    const a = shiftOffset(0);
    const b = shiftOffset(1);
    expect(Math.hypot(a.dx, a.dy)).toBeLessThanOrEqual(4);
    expect(a).not.toEqual(b);
  });
});

describe('the mark of corruption', () => {
  it('changes the guardian sprite with Corruption', () => {
    expect(corruptionTint(0)).toBe(0xffffff);
    const half = corruptionTint(0.5);
    const full = corruptionTint(1);
    expect(half).not.toBe(0xffffff);
    expect(full).not.toBe(half);
    expect((full >> 8) & 0xff).toBeLessThan((half >> 8) & 0xff);
  });
});
