import { describe, expect, it } from 'vitest';
import { Game } from './game';
import { fixtureDb } from './test/fixture';

const db = fixtureDb;
const game = () =>
  Game.newGame(
    { content: db, seed: 2 },
    { start: { year: 1835, month: 1, day: 10 }, startMinute: 600, startZone: 'village' },
  );
const fx = (g: Game, effects: unknown[]) => g.dispatch({ type: 'applyEffects', effects });
const types = (r: ReturnType<Game['dispatch']>) => r.events.map((e) => e.type);

describe('quests (docs/systems/quests.md → Implementation)', () => {
  it('advances stage by stage, applies onComplete, marks the point of no return, completes', () => {
    const g = game();
    fx(g, [{ startQuest: 'ally' }]);
    const r = fx(g, [{ setFlag: 'b' }]);
    expect(types(r)).toEqual(expect.arrayContaining(['quest/stageAdvanced', 'quest/noReturn']));
    expect(g.snapshot().flags['witch-allied']).toBe(true);
    // The flag changes the zone: the forest is hostile now.
    expect(g.zoneVariant('forest')).toBe('hostile');
    expect(types(fx(g, [{ setFlag: 'ev-fired' }]))).toContain('quest/completed');
    expect(g.snapshot().quests['ally']?.status).toBe('done');
  });

  it('rival routes block each other both ways; completing one fails the other', () => {
    const g = game();
    fx(g, [{ startQuest: 'ally' }]);
    const blocked = fx(g, [{ startQuest: 'burn' }]);
    expect(blocked.events).toContainEqual({
      type: 'quest/blocked',
      payload: { quest: 'burn', by: 'ally' },
    });
    expect(g.snapshot().quests['burn']).toBeUndefined();

    const h = game();
    fx(h, [{ startQuest: 'burn' }]);
    expect(types(fx(h, [{ startQuest: 'ally' }]))).toContain('quest/blocked');
    expect(types(fx(h, [{ setFlag: 'a' }]))).toContain('quest/completed');
    expect(types(fx(h, [{ startQuest: 'ally' }]))).toContain('quest/blocked');
  });

  it('a failed rival no longer blocks; failWhen fails the quest', () => {
    const g = game();
    fx(g, [{ startQuest: 'ally' }]);
    expect(types(fx(g, [{ setFlag: 'bridge-burned' }]))).toContain('quest/failed');
    expect(types(fx(g, [{ startQuest: 'burn' }]))).toContain('quest/started');
  });
});

it('a quest with startWhen starts by itself unless a rival blocks it', () => {
  const g = game();
  expect(g.snapshot().quests['q-auto']).toBeUndefined();
  expect(types(fx(g, [{ setFlag: 'moon-pulled-down' }]))).toContain('quest/started');
});

describe('dialogue choices (docs/systems/dialogue.md → Implementation)', () => {
  const guardian = () => {
    const g = game();
    g.dispatch({
      type: 'createGuardian',
      calling: 'acolyte',
      tree: 'exorcist',
      bonus: 'wits',
      virtue: 'mercy',
      sin: 'wrath',
    });
    return g;
  };
  const choose = (g: Game, options: string[][], wanted: number) =>
    g.dispatch({ type: 'dialogueChoice', story: 'test', options, wanted });

  it('refuses unmet requirements and choices the sin forbids; records the choice and its tags', () => {
    const g = guardian();
    expect(choose(g, [['requires:flag:a'], []], 0)).toMatchObject({
      ok: false,
      reason: 'requirement not met',
    });
    expect(choose(g, [['requires:item:garlic:2']], 0).ok).toBe(true);
    expect(choose(g, [['requires:skill:faith:1', 'requires:stat:faith:50']], 0).ok).toBe(true);
    const r = choose(g, [['virtue:mercy'], []], 0);
    expect(r.events).toContainEqual({
      type: 'dialogue/choiceMade',
      payload: { story: 'test', index: 0, tags: ['virtue:mercy'] },
    });
    expect(types(r)).toContain('virtue/acted');
    expect(g.snapshot().decisions.at(-1)).toMatchObject({ id: 'dialogue:test', choice: '0' });
    fx(g, [
      { setStat: 'corruption', value: 90 },
      { setStat: 'faith', value: 0 },
    ]);
    expect(choose(g, [['virtue:patience']], 0)).toMatchObject({
      ok: false,
      reason: 'your sin will not allow it',
    });
    expect(choose(g, [[]], 3)).toMatchObject({ ok: false, reason: 'no such choice' });
  });

  it('the sin sometimes speaks instead, never on noSinTakeover', () => {
    const g = guardian();
    let took = 0;
    let vow = 0;
    for (let i = 0; i < 40; i++) {
      fx(g, [
        { setStat: 'corruption', value: 90 },
        { setStat: 'faith', value: 0 },
      ]);
      if (types(choose(g, [['empathy'], ['sin:wrath']], 0)).includes('sin/tookOver')) took += 1;
      if (types(choose(g, [['noSinTakeover'], ['sin:wrath']], 0)).includes('sin/tookOver'))
        vow += 1;
    }
    expect(took).toBeGreaterThan(8);
    expect(vow).toBe(0);
  });
});
