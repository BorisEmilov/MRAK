import { Condition } from '@mrak/content-schema';
import { describe, expect, it } from 'vitest';
import { ConditionEvaluator, evaluateCondition, type ConditionContext } from './conditions';
import { createRandom } from './random';
import { createInitialState, type WorldState } from './state/world-state';
import { fixtureDb } from './test/fixture';

function context(overrides: Partial<ConditionContext> = {}): ConditionContext {
  return {
    flag: (id) => id === 'witch-allied',
    stat: (id, villager) =>
      id === 'corruption' ? 45 : id === 'fear' && villager === 'velika' ? 80 : 0,
    itemCount: (id) => (id === 'garlic' ? 2 : 0),
    hasClue: (id) => id === 'm1-ledger',
    hasTalent: () => false,
    callingId: () => 'znaharka',
    pactSigned: () => false,
    chapterId: () => 'unclean-days',
    phase: () => 'night',
    villagerAlive: () => true,
    possessionRevealed: () => false,
    quest: () => ({ status: 'active', stage: 'keep-watch' }),
    mysteryConclusion: () => undefined,
    monthDay: () => ({ month: 6, day: 24 }),
    moon: () => 'full',
    festivalDay: (id) => id === 'enyovden',
    collection: (c) => (c === 'songs' ? { have: 2, total: 3 } : { have: 4, total: 4 }),
    random: createRandom(1),
    ...overrides,
  };
}

/** Conditions are always parsed with the content schema first, as the game does. */
const cond = (json: unknown): Condition => Condition.parse(json);

describe('evaluateCondition', () => {
  it('evaluates the documented example', () => {
    const c = cond({ all: [{ flag: 'witch-allied' }, { stat: 'corruption', '>=': 40 }] });
    expect(evaluateCondition(c, context())).toBe(true);
    expect(evaluateCondition(c, context({ stat: () => 39 }))).toBe(false);
  });

  it('supports any / not and villager-scoped stats', () => {
    const c = cond({
      any: [{ not: { phase: 'night' } }, { stat: 'fear', villager: 'velika', '>': 75 }],
    });
    expect(evaluateCondition(c, context())).toBe(true);
  });

  it('checks items, clues, calling, chapter and quests', () => {
    expect(evaluateCondition(cond({ hasItem: 'garlic', qty: 3 }), context())).toBe(false);
    expect(evaluateCondition(cond({ hasItem: 'garlic' }), context())).toBe(true);
    expect(evaluateCondition(cond({ clue: 'm1-ledger' }), context())).toBe(true);
    expect(evaluateCondition(cond({ calling: 'znaharka' }), context())).toBe(true);
    expect(evaluateCondition(cond({ chapter: 'enyovden' }), context())).toBe(false);
    expect(
      evaluateCondition(cond({ quest: 'unclean-days-chapter', stage: 'theophany' }), context()),
    ).toBe(false);
  });

  it('checks mystery conclusions', () => {
    const c = cond({ mysteryConcluded: 'wasting-bride', correct: true });
    expect(evaluateCondition(c, context())).toBe(false);
    expect(
      evaluateCondition(
        c,
        context({ mysteryConclusion: () => ({ correct: true, culprit: 'chorbadzhi-dimo' }) }),
      ),
    ).toBe(true);
  });

  it('makes chance conditions reproducible with the seed', () => {
    const c = cond({ chance: 0.5 });
    const run = (): boolean[] => {
      const ctx = context({ random: createRandom(42) });
      return Array.from({ length: 10 }, () => evaluateCondition(c, ctx));
    };
    expect(run()).toEqual(run());
  });
});

describe('comparators', () => {
  const at = (value: number) => context({ stat: () => value });
  it.each([
    ['>=', 5, 5, true],
    ['>=', 4, 5, false],
    ['>', 6, 5, true],
    ['>', 5, 5, false],
    ['<=', 5, 5, true],
    ['<=', 6, 5, false],
    ['<', 4, 5, true],
    ['<', 5, 5, false],
    ['==', 5, 5, true],
    ['==', 4, 5, false],
    ['!=', 4, 5, true],
    ['!=', 5, 5, false],
  ] as const)('%s: %d vs %d → %s', (op, value, target, expected) => {
    expect(evaluateCondition(cond({ stat: 'corruption', [op]: target }), at(value))).toBe(expected);
  });
});

describe('ConditionEvaluator on a real world state', () => {
  const state = (): WorldState => {
    const s = createInitialState(fixtureDb, { callingId: 'znaharka' });
    s.flags['a'] = true;
    s.stats['corruption'] = 30;
    s.villagerStats['velika'] = { fear: 70 };
    s.guardian.pack.push({ item: 'garlic', qty: 2 });
    s.guardian.talents.push('pact-tree/A1');
    s.mysteries['m1'] = {
      links: [],
      board: {},
      retracted: [],
      status: 'concluded',
      clues: ['c-ledger'],
      conclusion: { culprit: 'todor', correct: true },
    };
    s.quests['q1'] = { status: 'active', stage: 's1' };
    s.pacts['some-pact'] = { signedAt: { day: s.clock.day, minute: 0 }, clauses: {} };
    s.possessions.push({ demon: 'lesser-bes', host: 'velika', stage: 2, revealed: true });
    s.calendar = { chapterId: 'unclean-days', chapterStart: s.clock.day, nightIndex: 1 };
    s.modifiers.push({ source: 't-grit', modifier: { statBonus: 'corruption', value: 15 } });
    return s;
  };
  const evaluator = new ConditionEvaluator(fixtureDb, createRandom(3));
  const yes = (json: unknown): boolean => evaluator.evaluate(cond(json), state());

  it('reads every kind of world fact', () => {
    expect(yes({ flag: 'a' })).toBe(true);
    expect(yes({ flag: 'b' })).toBe(false);
    expect(yes({ stat: 'corruption', '==': 45 })).toBe(true); // 30 + 15 from a passive modifier
    expect(yes({ stat: 'fear', villager: 'velika', '>=': 70 })).toBe(true);
    expect(yes({ stat: 'fear', villager: 'todor', '==': 10 })).toBe(true);
    expect(yes({ hasItem: 'garlic', qty: 2 })).toBe(true);
    expect(yes({ clue: 'c-ledger' })).toBe(true);
    expect(yes({ clue: 'c-alibi' })).toBe(false);
    expect(yes({ talent: 't-grit' })).toBe(true);
    expect(yes({ calling: 'znaharka' })).toBe(true);
    expect(yes({ pactSigned: 'some-pact' })).toBe(true);
    expect(yes({ chapter: 'unclean-days' })).toBe(true);
    expect(yes({ phase: 'day' })).toBe(true);
    expect(yes({ villagerAlive: 'velika' })).toBe(true);
    expect(yes({ villagerAlive: 'nobody' })).toBe(false);
    expect(yes({ possessionRevealed: 'velika' })).toBe(true);
    expect(yes({ possessionRevealed: 'todor' })).toBe(false);
    expect(yes({ quest: 'q1', status: 'active', stage: 's1' })).toBe(true);
    expect(yes({ quest: 'q1', status: 'done' })).toBe(false);
    expect(yes({ mysteryConcluded: 'm1', correct: true, culprit: 'todor' })).toBe(true);
    expect(yes({ mysteryConcluded: 'm1', culprit: 'velika' })).toBe(false);
  });

  it('treats missing quests and mysteries as false', () => {
    const empty = createInitialState(fixtureDb);
    expect(evaluator.evaluate(cond({ quest: 'q1' }), empty)).toBe(false);
    expect(evaluator.evaluate(cond({ mysteryConcluded: 'm1' }), empty)).toBe(false);
    expect(evaluator.evaluate(cond({ calling: 'znaharka' }), empty)).toBe(false);
    expect(evaluator.evaluate(cond({ chapter: 'unclean-days' }), empty)).toBe(false);
  });
});

describe('calendar and collection conditions', () => {
  it('date ranges are inclusive and may wrap the new year', () => {
    const at = (month: number, day: number) => context({ monthDay: () => ({ month, day }) });
    const summer = cond({ date: { from: '06-01', to: '07-31' } });
    const winter = cond({ date: { from: '12-01', to: '02-28' } });
    expect(evaluateCondition(summer, at(6, 1))).toBe(true);
    expect(evaluateCondition(summer, at(7, 31))).toBe(true);
    expect(evaluateCondition(summer, at(8, 1))).toBe(false);
    expect(evaluateCondition(winter, at(12, 25))).toBe(true);
    expect(evaluateCondition(winter, at(1, 10))).toBe(true);
    expect(evaluateCondition(winter, at(3, 1))).toBe(false);
  });

  it('moon, festival day and collection progress', () => {
    const ctx = context();
    expect(evaluateCondition(cond({ moon: ['full', 'waning-gibbous'] }), ctx)).toBe(true);
    expect(evaluateCondition(cond({ moon: ['new'] }), ctx)).toBe(false);
    expect(evaluateCondition(cond({ festivalDay: 'enyovden' }), ctx)).toBe(true);
    expect(evaluateCondition(cond({ collection: 'songs', '>=': 2 }), ctx)).toBe(true);
    expect(evaluateCondition(cond({ collection: 'songs', '>=': 'all' }), ctx)).toBe(false);
    expect(evaluateCondition(cond({ collection: 'herbs', '>=': 'all' }), ctx)).toBe(true);
    expect(evaluateCondition(cond({ collection: 'songs', '<': 3 }), ctx)).toBe(true);
  });

  it('festivalDay holds only on the first day of the festival', () => {
    const on = (day: number) => {
      const s = createInitialState(fixtureDb, { start: { year: 1834, month: 12, day } });
      return new ConditionEvaluator(fixtureDb, createRandom(1)).evaluate(
        cond({ festivalDay: 'unclean-days' }),
        s,
      );
    };
    expect(on(25)).toBe(true);
    expect(on(26)).toBe(false);
    expect(on(24)).toBe(false);
  });
});
