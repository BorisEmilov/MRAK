import { describe, expect, it } from 'vitest';
import { itemCount } from '../items/inventory';
import { Game } from '../game';
import { fixtureDb } from '../test/fixture';
import {
  cellsInDisc,
  countRevealed,
  decodeBase64,
  encodeBase64,
  isRevealed,
  revealCells,
} from './exploration';

describe('explored bitset', () => {
  it('base64 round-trips any bytes', () => {
    for (let n = 0; n < 10; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n) & 0xff);
      expect([...decodeBase64(encodeBase64(bytes))]).toEqual([...bytes]);
    }
    expect(encodeBase64(Uint8Array.from([77, 97, 110]))).toBe('TWFu');
  });

  it('reveals cells idempotently', () => {
    const a = revealCells('', [0, 9, 1000]);
    expect(countRevealed(a)).toBe(3);
    expect(revealCells(a, [9, 0])).toBe(a);
    const bytes = decodeBase64(a);
    expect(isRevealed(bytes, 9)).toBe(true);
    expect(isRevealed(bytes, 8)).toBe(false);
    expect(() => revealCells('', [-1])).toThrow(RangeError);
  });

  it('cellsInDisc stays inside the map', () => {
    const cells = cellsInDisc(0, 0, 2, 10, 10);
    expect(cells.every((c) => c >= 0 && c < 100)).toBe(true);
    expect(cells).toContain(0);
    expect(cellsInDisc(5, 5, 0, 10, 10)).toEqual([]);
    expect(cellsInDisc(5.5, 5.5, 1, 10, 10)).toContain(55);
  });
});

describe('POIs and exploration commands', () => {
  const newGame = (): Game => Game.newGame({ content: fixtureDb, seed: 3 });

  it('revealCells stores the bitset in the zone state', () => {
    const game = newGame();
    expect(game.dispatch({ type: 'revealCells', zone: 'forest', cells: [1, 2, 3] }).ok).toBe(true);
    expect(countRevealed(game.snapshot().zones['forest']?.explored ?? '')).toBe(3);
    expect(game.dispatch({ type: 'revealCells', zone: 'nowhere', cells: [1] }).ok).toBe(false);
  });

  it('a once-POI applies its effects only the first time', () => {
    const game = newGame();
    const first = game.dispatch({ type: 'interactPoi', zone: 'forest', poi: 'oil-cache' });
    expect(first.ok).toBe(true);
    expect(first.events.map((e) => e.type)).toEqual([
      'world/poiDiscovered',
      'world/poiInteracted',
      'inventory/itemAdded',
    ]);
    game.dispatch({ type: 'interactPoi', zone: 'forest', poi: 'oil-cache' });
    expect(itemCount(game.snapshot(), 'lamp-oil')).toBe(6);
    expect(game.snapshot().zones['forest']).toMatchObject({
      pois: ['oil-cache'],
      used: ['oil-cache'],
    });
  });

  it('a repeatable POI applies its effects every time', () => {
    const game = newGame();
    game.dispatch({ type: 'interactPoi', zone: 'forest', poi: 'well' });
    game.dispatch({ type: 'interactPoi', zone: 'forest', poi: 'well' });
    expect(game.snapshot().stats['sanity']).toBe(78);
  });

  it('discoverPoi is idempotent and rejects unknown POIs', () => {
    const game = newGame();
    expect(game.dispatch({ type: 'discoverPoi', zone: 'forest', poi: 'well' }).events).toHaveLength(
      1,
    );
    expect(game.dispatch({ type: 'discoverPoi', zone: 'forest', poi: 'well' }).events).toHaveLength(
      0,
    );
    expect(game.dispatch({ type: 'discoverPoi', zone: 'forest', poi: 'nope' }).ok).toBe(false);
  });

  it('noise rises with makeNoise and decays 2 per in-world minute', () => {
    const game = newGame();
    game.dispatch({ type: 'makeNoise', level: 6 });
    expect(game.snapshot().explorer.noise).toBe(6);
    game.tick(1000);
    expect(game.snapshot().explorer.noise).toBeCloseTo(4);
    for (let i = 0; i < 5; i++) game.tick(1000);
    expect(game.snapshot().explorer.noise).toBe(0);
  });
});
