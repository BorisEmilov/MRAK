import { describe, expect, it } from 'vitest';
import { createRandom, RandomStreams } from './random';

const take = (rng: { next(): number }, n: number): number[] =>
  Array.from({ length: n }, () => rng.next());

describe('createRandom', () => {
  it('is deterministic for the same seed', () => {
    expect(take(createRandom(1830), 5)).toEqual(take(createRandom(1830), 5));
  });

  it('differs for different seeds', () => {
    expect(createRandom(1).next()).not.toBe(createRandom(2).next());
  });

  it('produces integers within the inclusive range', () => {
    const rng = createRandom(42);
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('rejects invalid ranges and empty picks', () => {
    expect(() => createRandom(0).int(5, 1)).toThrow(RangeError);
    expect(() => createRandom(0).pick([])).toThrow(RangeError);
  });

  it('resumes the exact sequence from a saved state', () => {
    const a = createRandom(99);
    take(a, 10);
    const b = createRandom(0);
    b.setState(a.getState());
    expect(take(b, 5)).toEqual(take(a, 5));
  });
});

describe('RandomStreams', () => {
  it('reproduces every stream from the same seed', () => {
    const a = new RandomStreams(1834);
    const b = new RandomStreams(1834);
    expect(take(a.get('director'), 5)).toEqual(take(b.get('director'), 5));
    expect(take(a.get('checks'), 5)).toEqual(take(b.get('checks'), 5));
  });

  it('keeps streams independent: consuming one never shifts another', () => {
    const a = new RandomStreams(7);
    const b = new RandomStreams(7);
    take(a.get('night'), 100);
    expect(take(a.get('checks'), 5)).toEqual(take(b.get('checks'), 5));
  });

  it('derives different sequences per stream', () => {
    const streams = new RandomStreams(7);
    expect(take(streams.get('director'), 3)).not.toEqual(take(streams.get('checks'), 3));
  });

  it('serializes and restores mid-sequence', () => {
    const a = new RandomStreams(3);
    take(a.get('loot'), 17);
    const saved = a.serialize();
    const b = RandomStreams.deserialize(saved);
    expect(take(b.get('loot'), 5)).toEqual(take(a.get('loot'), 5));
    expect(take(b.get('villagers'), 5)).toEqual(take(new RandomStreams(3).get('villagers'), 5));
  });

  it('rewinds with restore()', () => {
    const streams = new RandomStreams(5);
    const before = streams.serialize();
    const first = take(streams.get('checks'), 3);
    streams.restore(before);
    expect(take(streams.get('checks'), 3)).toEqual(first);
    expect(() => {
      streams.restore({ seed: 6, streams: {} });
    }).toThrow(RangeError);
  });
});
