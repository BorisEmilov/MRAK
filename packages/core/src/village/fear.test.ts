import { describe, expect, it } from 'vitest';
import { contagion, type ContagionInput } from './fear';

const rules = { contagionRate: 0.02, contagionCap: 5, proximityWeight: 0.25 };

function input(
  fear: Record<string, number>,
  affinity: Record<string, Record<string, number>>,
  together: [string, string][] = [],
  extra: Partial<ContagionInput> = {},
): ContagionInput {
  const pairs = new Set(together.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  return {
    ids: Object.keys(fear),
    fear,
    affinity: (from, to) => affinity[from]?.[to],
    together: (a, b) => pairs.has(`${a}|${b}`),
    spread: () => 1,
    gain: () => 1,
    ...extra,
  };
}

describe('fear contagion', () => {
  it('affinity 100, fear 80 → 0: the receiver gains 80 × 0.02 = 1.6 in an hour', () => {
    const d = contagion(input({ a: 80, b: 0 }, { b: { a: 100 }, a: { b: 100 } }), rules);
    expect(d['b']).toBeCloseTo(1.6);
    expect(d['a']).toBe(0);
  });

  it('is capped at 5 per hour before the gain factor', () => {
    const d = contagion(
      input({ a: 100, b: 0 }, { b: { a: 100 } }, [], { gain: (id) => (id === 'b' ? 0.5 : 1) }),
      { ...rules, contagionRate: 0.2 },
    );
    expect(d['b']).toBe(2.5);
  });

  it('a grudge (negative affinity) transmits nothing; nor does indifference apart', () => {
    const d = contagion(input({ a: 90, b: 0, c: 0 }, { b: { a: -60 } }), rules);
    expect(d['b']).toBe(0);
    expect(d['c']).toBe(0);
  });

  it('proximity spreads fear between strangers at the same place', () => {
    const d = contagion(input({ a: 90, b: 10 }, {}, [['a', 'b']]), rules);
    expect(d['b']).toBeCloseTo(0.25 * 80 * 0.02);
  });

  it('uses the receiver’s affinity first, the sender’s when the receiver has none', () => {
    const own = contagion(input({ a: 60, b: 10 }, { b: { a: 20 }, a: { b: 100 } }), rules);
    expect(own['b']).toBeCloseTo(0.2 * 50 * 0.02);
    const theirs = contagion(input({ a: 60, b: 10 }, { a: { b: 100 } }), rules);
    expect(theirs['b']).toBeCloseTo(1 * 50 * 0.02);
  });

  it('affinity cycles cannot push anyone above the hourly cap', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const all = Object.fromEntries(
      ids.map((i) => [i, Object.fromEntries(ids.map((j) => [j, 100]))]),
    );
    const d = contagion(
      input({ a: 100, b: 100, c: 100, d: 0 }, all, [
        ['a', 'd'],
        ['b', 'd'],
      ]),
      { ...rules, contagionRate: 1 },
    );
    expect(d['d']).toBe(5);
    expect(d['a']).toBe(0);
  });

  it('a stronger spreader (traits) passes on more', () => {
    const base = contagion(input({ a: 60, b: 10 }, { b: { a: 50 } }), rules)['b'] ?? 0;
    const bride = contagion(
      input({ a: 60, b: 10 }, { b: { a: 50 } }, [], { spread: (id) => (id === 'a' ? 1.25 : 1) }),
      rules,
    )['b'];
    expect(bride).toBeCloseTo(base * 1.25);
  });
});
