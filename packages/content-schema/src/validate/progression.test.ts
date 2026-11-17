import { describe, expect, it } from 'vitest';
import { MILESTONE_TRIGGERS } from '../entities/guardian';
import { codes, mutate, realPack } from '../test-helpers';

describe('progression content (docs/systems/progression.md)', () => {
  it('the real pack has progression rules, milestones, tones and debt content', () => {
    expect(codes(realPack())).toEqual([]);
  });

  it('rejects talk tones tagged with an unknown virtue or sin', () => {
    const raw = mutate(realPack(), 'talk-tones', 'comfort', (t) => {
      t['tags'] = ['virtue:greed'];
    });
    expect(codes(raw)).toContain('talk-tone-tag');
  });

  it('rejects a sin blocking an unknown virtue', () => {
    const raw = mutate(realPack(), 'sins', 'wrath', (s) => {
      s['blocks'] = ['bravery'];
    });
    expect(codes(raw)).toContain('sin-blocks');
  });

  it('a dark tree adding debt names its debt source', () => {
    const raw = mutate(realPack(), 'trees', 'servant-of-the-horned-one', (t) => {
      delete t['debtSource'];
    });
    expect(codes(raw)).toContain('tree-dark-debt');
  });

  it('callings need the progression rules', () => {
    const raw = realPack();
    raw.collections['progression-rules'] = [];
    expect(codes(raw)).toContain('progression-rules-missing');
  });

  it('no milestone trigger is a kill (Revelation never comes from killing)', () => {
    for (const t of MILESTONE_TRIGGERS) expect(t).not.toMatch(/kill|died|slain|combat/);
  });
});
