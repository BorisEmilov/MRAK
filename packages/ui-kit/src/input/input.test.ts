import { describe, expect, it } from 'vitest';
import { keyLabel } from './keys';
import { padGlyph, padTypeOf } from './devices';
import { pickInDirection } from './spatial';

const r = (left: number, top: number) => ({ left, top, width: 10, height: 10 });

describe('gamepad helpers', () => {
  it('picks the nearest element in a direction', () => {
    const from = r(100, 100);
    const others = [r(100, 50), r(100, 160), r(160, 100), r(40, 104), r(300, 300)];
    expect(pickInDirection(from, others, 'up')).toBe(0);
    expect(pickInDirection(from, others, 'down')).toBe(1);
    expect(pickInDirection(from, others, 'right')).toBe(2);
    expect(pickInDirection(from, others, 'left')).toBe(3);
    expect(pickInDirection(from, [r(100, 50)], 'down')).toBe(-1);
  });

  it('recognises pads and names their buttons', () => {
    expect(padTypeOf('054c-0ce6-DualSense Wireless Controller')).toBe('playstation');
    expect(padTypeOf('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(padTypeOf('Unknown pad')).toBe('generic');
    expect(padGlyph('a', 'playstation')).toEqual({ glyph: '✕', spoken: 'ui.pad.cross' });
    expect(padGlyph('a', 'xbox')).toEqual({ glyph: 'A' });
    expect(padGlyph('a', 'nintendo')).toEqual({ glyph: 'B' });
    expect(padGlyph('lb', 'playstation').glyph).toBe('L1');
  });

  it('labels keyboard codes', () => {
    const text = (k: string) => `<${k}>`;
    expect(keyLabel('KeyE', text)).toBe('E');
    expect(keyLabel('Digit3', text)).toBe('3');
    expect(keyLabel('Space', text)).toBe('<ui.key.space>');
    expect(keyLabel('F5', text)).toBe('F5');
  });
});
