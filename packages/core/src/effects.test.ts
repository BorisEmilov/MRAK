import { Effect } from '@mrak/content-schema';
import { describe, expect, it } from 'vitest';
import { itemCount } from './items/inventory';
import { EffectApplier, EffectError, type EffectContext, type RuleHandler } from './effects';
import { event, type CoreEvent } from './events';
import { RandomStreams } from './random';
import { effectiveStat, getStat } from './state/stats';
import { createInitialState, type WorldState } from './state/world-state';
import { fixtureDb } from './test/fixture';

const applier = new EffectApplier();

function setup(rules: Map<string, RuleHandler> = new Map()): {
  state: WorldState;
  ctx: EffectContext;
} {
  const state = createInitialState(fixtureDb);
  return {
    state,
    ctx: {
      db: fixtureDb,
      random: new RandomStreams(7),
      rules,
      now: { day: state.clock.day, minute: state.clock.minute },
      source: 'test',
    },
  };
}

/** Effects are always parsed with the content schema first, as the game does. */
function run(state: WorldState, ctx: EffectContext, effects: unknown[]): CoreEvent[] {
  return applier.apply(
    state,
    effects.map((e) => Effect.parse(e)),
    ctx,
  );
}

const types = (events: CoreEvent[]): string[] => events.map((e) => e.type);

describe('flags', () => {
  it('sets and clears flags, emitting only on change', () => {
    const { state, ctx } = setup();
    expect(types(run(state, ctx, [{ setFlag: 'bridge-burned' }]))).toEqual(['state/flagSet']);
    expect(run(state, ctx, [{ setFlag: 'bridge-burned' }])).toEqual([]);
    expect(state.flags['bridge-burned']).toBe(true);
    expect(types(run(state, ctx, [{ clearFlag: 'bridge-burned' }]))).toEqual(['state/flagCleared']);
    expect(state.flags['bridge-burned']).toBeUndefined();
    expect(run(state, ctx, [{ clearFlag: 'bridge-burned' }])).toEqual([]);
  });

  it('rejects undeclared flags', () => {
    const { state, ctx } = setup();
    expect(() => run(state, ctx, [{ setFlag: 'not-declared' }])).toThrow(/undeclared flag/);
  });
});

describe('stats', () => {
  it('adds and sets with clamping to the declared range', () => {
    const { state, ctx } = setup();
    const events = run(state, ctx, [{ addStat: 'hysteria', value: 10 }]);
    expect(events).toEqual([event('state/statChanged', { stat: 'hysteria', from: 10, to: 20 })]);
    run(state, ctx, [{ addStat: 'hysteria', value: 500 }]);
    expect(getStat(state, fixtureDb, 'hysteria')).toBe(100);
    run(state, ctx, [{ setStat: 'hysteria', value: -3 }]);
    expect(getStat(state, fixtureDb, 'hysteria')).toBe(0);
  });

  it('handles villager-scoped stats', () => {
    const { state, ctx } = setup();
    run(state, ctx, [{ addStat: 'fear', villager: 'velika', value: 25 }]);
    expect(getStat(state, fixtureDb, 'fear', 'velika')).toBe(35);
    expect(getStat(state, fixtureDb, 'fear', 'todor')).toBe(10);
    expect(() => run(state, ctx, [{ addStat: 'fear', value: 1 }])).toThrow(RangeError);
    expect(() => run(state, ctx, [{ addStat: 'hysteria', villager: 'velika', value: 1 }])).toThrow(
      RangeError,
    );
  });

  it('emits nothing when a clamped value does not change', () => {
    const { state, ctx } = setup();
    run(state, ctx, [{ setStat: 'corruption', value: 0 }]);
    expect(run(state, ctx, [{ addStat: 'corruption', value: -5 }])).toEqual([]);
  });
});

describe('inventory, quests, mysteries, collectibles', () => {
  it('gives and takes items (taking never goes below zero)', () => {
    const { state, ctx } = setup();
    run(state, ctx, [{ giveItem: 'garlic', qty: 3 }]);
    expect(run(state, ctx, [{ takeItem: 'garlic', qty: 5 }])).toEqual([
      event('inventory/itemRemoved', { item: 'garlic', qty: 3 }),
    ]);
    expect(itemCount(state, 'garlic')).toBe(0);
    expect(run(state, ctx, [{ takeItem: 'garlic', qty: 1 }])).toEqual([]);
  });

  it('starts and fails quests', () => {
    const { state, ctx } = setup();
    expect(run(state, ctx, [{ startQuest: 'q1' }])).toEqual([
      event('quest/started', { quest: 'q1', stage: 's1' }),
    ]);
    expect(run(state, ctx, [{ startQuest: 'q1' }])).toEqual([]);
    expect(types(run(state, ctx, [{ failQuest: 'q1' }]))).toEqual(['quest/failed']);
    expect(state.quests['q1']?.status).toBe('failed');
  });

  it('starts mysteries and adds clues to their board', () => {
    const { state, ctx } = setup();
    expect(types(run(state, ctx, [{ startMystery: 'm1' }, { addClue: 'c-witness' }]))).toEqual([
      'mystery/started',
      'mystery/clueFound',
    ]);
    expect(state.mysteries['m1']?.clues).toEqual(['c-witness']);
    expect(run(state, ctx, [{ addClue: 'c-witness' }])).toEqual([]);
  });

  it('grants a collectible and applies what it grants', () => {
    const { state, ctx } = setup();
    expect(types(run(state, ctx, [{ grantCollectible: 'page' }]))).toEqual([
      'journal/collectibleGranted',
      'mystery/clueFound',
    ]);
    expect(state.mysteries['m1']?.clues).toEqual(['c-ledger']);
  });
});

describe('occult, villagers, world', () => {
  it('adds debt from a debt source and keeps the debt stat in sync', () => {
    const { state, ctx } = setup();
    run(state, ctx, [{ addDebt: 'devils-luck' }, { addDebt: 'devils-luck' }]);
    expect(state.debt.entries).toHaveLength(2);
    expect(state.debt.entries[0]).toMatchObject({
      source: 'devils-luck',
      amount: 2,
      creditor: 'horned-one',
    });
    expect(getStat(state, fixtureDb, 'debt')).toBe(4);
  });

  it('changes affinity, clamped to ±100, toward the guardian by default', () => {
    const { state, ctx } = setup();
    run(state, ctx, [{ changeAffinity: 'velika', with: 'todor', value: 50 }]);
    expect(state.villagers['velika']?.affinity['todor']).toBe(100);
    run(state, ctx, [{ changeAffinity: 'velika', value: -30 }]);
    expect(state.villagers['velika']?.affinity['guardian']).toBe(-30);
  });

  it('starts a hidden possession once per host and demon', () => {
    const { state, ctx } = setup();
    run(state, ctx, [{ startPossession: 'lesser-bes', host: 'velika' }]);
    expect(run(state, ctx, [{ startPossession: 'lesser-bes', host: 'velika' }])).toEqual([]);
    expect(state.possessions).toEqual([
      { demon: 'lesser-bes', host: 'velika', stage: 1, revealed: false },
    ]);
  });

  it('sets zone variants and rejects unknown ones', () => {
    const { state, ctx } = setup();
    run(state, ctx, [{ setZoneVariant: 'forest', variant: 'burned' }]);
    expect(state.zones['forest']?.variant).toBe('burned');
    expect(() => run(state, ctx, [{ setZoneVariant: 'forest', variant: 'frozen' }])).toThrow(
      EffectError,
    );
  });

  it('unlocks trees and recipes once', () => {
    const { state, ctx } = setup();
    expect(
      types(run(state, ctx, [{ unlockTree: 'pact-tree' }, { unlockRecipe: 'braid' }])),
    ).toEqual(['unlock/tree', 'unlock/recipe']);
    expect(run(state, ctx, [{ unlockTree: 'pact-tree' }])).toEqual([]);
  });

  it('records narration with the in-game time', () => {
    const { state, ctx } = setup();
    run(state, ctx, [{ narrate: 'event.knock.text' }]);
    expect(state.narrations).toEqual([{ key: 'event.knock.text', at: ctx.now }]);
  });
});

describe('composition', () => {
  it('branches with if / then / else on the current draft', () => {
    const { state, ctx } = setup();
    const branch = {
      if: { flag: 'a' },
      then: [{ setFlag: 'b' }],
      else: [{ setFlag: 'bridge-burned' }],
    };
    run(state, ctx, [branch]);
    expect(state.flags['bridge-burned']).toBe(true);
    run(state, ctx, [{ setFlag: 'a' }, branch]);
    expect(state.flags['b']).toBe(true);
  });

  it('triggers director events and their effects', () => {
    const { state, ctx } = setup();
    expect(types(run(state, ctx, [{ triggerEvent: 'knock' }]))).toEqual([
      'director/eventTriggered',
      'state/flagSet',
    ]);
  });

  it('stops infinite effect loops', () => {
    const { state, ctx } = setup();
    expect(() => run(state, ctx, [{ triggerEvent: 'loop' }])).toThrow(/deeper than/);
  });

  it('registers passive modifiers once per source and applies them to effective stats', () => {
    const { state, ctx } = setup();
    run(state, ctx, [{ modifier: { statBonus: 'sanity-max', value: 5 } }]);
    run(state, ctx, [{ modifier: { statBonus: 'sanity-max', value: 5 } }]);
    run(state, { ...ctx, source: 'other' }, [
      { modifier: { multiply: 'hysteria-gain-rate', factor: 0.7 } },
    ]);
    expect(state.modifiers).toHaveLength(2);
    expect(effectiveStat(state, fixtureDb, 'sanity-max')).toBe(81);
    expect(effectiveStat(state, fixtureDb, 'hysteria-gain-rate')).toBeCloseTo(0.7);
  });

  it('grants abilities keyed by source and position', () => {
    const { state, ctx } = setup();
    run(state, ctx, [{ ability: { uses: 2, per: 'night', effects: [{ setFlag: 'a' }] } }]);
    expect(state.abilities['test#0']).toMatchObject({ uses: 2, usesLeft: 2, per: 'night' });
  });

  it('invokes registered rules and reports unhandled ones', () => {
    const handler: RuleHandler = (draft, params) => {
      draft.flags['b'] = true;
      expect(params).toEqual({ chance: 0.5 });
    };
    const { state, ctx } = setup(new Map([['mark-lies', handler]]));
    const events = run(state, ctx, [{ rule: 'mark-lies', params: { chance: 0.5 } }]);
    expect(events[0]).toEqual(
      event('rule/invoked', { rule: 'mark-lies', params: { chance: 0.5 }, handled: true }),
    );
    expect(state.flags['b']).toBe(true);
    const unhandled = setup();
    expect(run(unhandled.state, unhandled.ctx, [{ rule: 'mark-lies' }])[0]).toMatchObject({
      payload: { handled: false },
    });
  });
});
