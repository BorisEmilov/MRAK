import { describe, expect, it, vi } from 'vitest';
import { ScreenFx, type FxCamera } from './fx';

function camera(): FxCamera & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    shake: vi.fn(() => calls.push('shake')),
    flash: vi.fn(() => calls.push('flash')),
    fadeIn: vi.fn(() => calls.push('fade')),
  };
}

describe('screen fx', () => {
  it('respects reduce shake / flashes and fewer scares', () => {
    let time = 0;
    const opts = { reduceShake: true, reduceFlashes: true, fewerScares: true };
    const fx = new ScreenFx(
      () => opts,
      () => time,
    );
    const cam = camera();
    expect(fx.shake(cam, 200, 0.01)).toBe(false);
    expect(fx.flash(cam, 100)).toBe('fade');
    expect(fx.allowScare()).toBe(false);
    opts.reduceFlashes = false;
    time = 1000;
    expect(fx.flash(cam, 100)).toBe('flash');
    expect(cam.calls).toEqual(['fade', 'flash']);
  });

  it('never flashes more than 3 times per second', () => {
    let time = 0;
    const fx = new ScreenFx(
      () => ({ reduceShake: false, reduceFlashes: false, fewerScares: false }),
      () => time,
    );
    const cam = camera();
    const results = [0, 100, 200, 340, 400, 700].map((ms) => {
      time = ms;
      return fx.flash(cam, 50);
    });
    expect(results).toEqual(['flash', 'skipped', 'skipped', 'flash', 'skipped', 'flash']);
  });
});
