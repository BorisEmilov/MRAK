import { describe, expect, it } from 'vitest';
import { t } from './t';

describe('t', () => {
  it('returns the English string for a key', () => {
    expect(t('game.title')).toBe('MRAK');
  });

  it('interpolates parameters', () => {
    expect(t('hud.night', { night: 3, total: 12 })).toBe('night 3 of 12');
  });

  it('leaves unknown placeholders visible', () => {
    expect(t('hud.night', { night: 3 })).toBe('night 3 of {total}');
  });
});
