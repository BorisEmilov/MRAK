import { describe, expect, it } from 'vitest';
import { buildJsonSchemas } from './json-schema';
import { Condition, Effect } from './lang';
import { COLLECTION_NAMES } from './pack';
import { collectRefs } from './walk';

describe('condition language', () => {
  it('accepts the documented examples', () => {
    expect(
      Condition.safeParse({ all: [{ flag: 'witch-allied' }, { stat: 'corruption', '>=': 40 }] })
        .success,
    ).toBe(true);
    expect(
      Condition.safeParse({ not: { any: [{ phase: 'night' }, { chance: 0.25 }] } }).success,
    ).toBe(true);
  });

  it('rejects unknown operators, empty groups and snake_case ids', () => {
    expect(Condition.safeParse({ flagg: 'x' }).success).toBe(false);
    expect(Condition.safeParse({ all: [] }).success).toBe(false);
    expect(Condition.safeParse({ flag: 'witch_allied' }).success).toBe(false);
    expect(Condition.safeParse({ chance: 1.5 }).success).toBe(false);
  });
});

describe('effect language', () => {
  it('accepts the documented examples', () => {
    expect(Effect.safeParse({ setFlag: 'bridge-burned' }).success).toBe(true);
    expect(Effect.safeParse({ addStat: 'hysteria', value: 10 }).success).toBe(true);
    expect(
      Effect.safeParse({
        if: { flag: 'forest-hostile' },
        then: [{ addStat: 'sanity', value: -5 }],
        else: [{ modifier: { fateDice: 1, context: 'vs-demon' } }],
      }).success,
    ).toBe(true);
  });

  it('rejects mixed or incomplete effects', () => {
    expect(Effect.safeParse({ setFlag: 'a', clearFlag: 'b' }).success).toBe(false);
    expect(Effect.safeParse({ ability: { uses: 1, per: 'night', effects: [] } }).success).toBe(
      false,
    );
  });

  it('finds references nested inside conditions and effects', () => {
    const effect = Effect.parse({
      if: { all: [{ flag: 'a' }, { stat: 'fear', villager: 'velika', '>': 50 }] },
      then: [{ ability: { uses: 1, per: 'night', effects: [{ addDebt: 'devils-luck' }] } }],
    });
    const refs = collectRefs(Effect, effect).map((r) => `${r.kind}:${r.id}@${r.path}`);
    expect(refs).toEqual([
      'flag:a@if.all[0].flag',
      'stat:fear@if.all[1].stat',
      'villager:velika@if.all[1].villager',
      'debt-source:devils-luck@then[0].ability.effects[0].addDebt',
    ]);
  });
});

describe('JSON Schema export', () => {
  const schemas = buildJsonSchemas();

  it('exports every collection plus the language and file formats', () => {
    for (const name of [
      ...COLLECTION_NAMES,
      'condition',
      'effect',
      'flags',
      'locale',
      'manifest',
    ]) {
      expect(schemas[name]).toBeDefined();
    }
  });

  it('keeps recursion as $ref', () => {
    const condition = JSON.stringify(schemas['condition']);
    expect(condition).toContain('"$ref"');
    expect(condition).toContain('2020-12');
  });
});
