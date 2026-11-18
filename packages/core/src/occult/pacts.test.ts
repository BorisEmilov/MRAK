import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../events';
import { categoryShares } from '../fear/director';
import { Game } from '../game';
import { getStat } from '../state/stats';
import { fearDb as db } from '../test/fear-fixture';
import { corruptionAspect, trustFactor } from './pacts';

const rules = db.get('fear-rules', 'default');

function newGame(seed = 1): Game {
  const g = Game.newGame({ content: db, seed }, { startMinute: 12 * 60, startZone: 'village' });
  g.dispatch({
    type: 'createGuardian',
    calling: 'acolyte',
    tree: 'exorcist',
    bonus: 'wits',
    virtue: 'mercy',
    sin: 'wrath',
  });
  g.dispatch({
    type: 'applyEffects',
    effects: [
      { giveItem: 'bread', qty: 300, to: 'storage' },
      { giveItem: 'firewood', qty: 300, to: 'storage' },
    ],
  });
  return g;
}
const days = (g: Game, n: number): CoreEvent[] => {
  const out: CoreEvent[] = [];
  for (let i = 0; i < n; i++)
    out.push(...g.dispatch({ type: 'advanceTime', minutes: 1440 }).events);
  return out;
};

describe('pacts', () => {
  it('a hidden clause fires days later and is discovered (deferred trigger)', () => {
    const g = newGame();
    const max = getStat(g.snapshot(), db, 'sanity-max');
    const corruption = getStat(g.snapshot(), db, 'corruption');
    const r = g.dispatch({ type: 'signPact', pact: 'dark-deal' });
    expect(r.ok).toBe(true);
    const s = g.snapshot();
    // Signed in blood, debt to its source, the guardian's own sin reinforced.
    expect(getStat(s, db, 'sanity-max')).toBe(max - 5);
    expect(s.debt.entries.at(-1)?.source).toBe('pact-minor');
    expect(getStat(s, db, 'corruption')).toBe(corruption + 5);
    expect(s.pacts['dark-deal']?.clauses['late']).toEqual({
      dueDay: s.clock.day + 3,
      fired: false,
    });

    expect(days(g, 2).some((e) => e.type === 'pact/clauseTriggered')).toBe(false);
    expect(g.snapshot().flags['b']).toBeUndefined();
    const fired = days(g, 1).filter((e) => e.type === 'pact/clauseTriggered');
    expect(fired.map((e) => e.payload)).toEqual([{ pact: 'dark-deal', clause: 'late' }]);
    expect(g.snapshot().flags['b']).toBe(true);
    expect(g.snapshot().pacts['dark-deal']?.clauses['late']?.fired).toBe(true);
    expect(days(g, 3).some((e) => e.type === 'pact/clauseTriggered')).toBe(false);
  });
});

describe('factions', () => {
  it('reputation with one power angers its enemies', () => {
    const g = newGame();
    const r = g.dispatch({ type: 'signPact', pact: 'dark-deal' });
    const angered = r.ok
      ? r.events.filter((e) => e.type === 'faction/angered').map((e) => e.payload)
      : [];
    expect(angered).toEqual([
      { faction: 'forest-spirit', by: 'horned-one', from: 0, to: -10 },
      { faction: 'church', by: 'horned-one', from: 0, to: -10 },
    ]);
    g.dispatch({ type: 'applyEffects', effects: [{ addStat: 'rep-church', value: 10 }] });
    const s = g.snapshot();
    expect(getStat(s, db, 'rep-church')).toBe(0);
    expect(getStat(s, db, 'rep-horned-one')).toBe(10);
  });
});

describe('faith and corruption', () => {
  it('marks the guardian: less trust, more hallucinations', () => {
    const g = newGame();
    expect(corruptionAspect(g.snapshot(), db)).toBe(0);
    const before = categoryShares(g.snapshot(), db, rules).hallucination;
    expect(before).toBeCloseTo(0.2);
    g.dispatch({
      type: 'applyEffects',
      effects: [
        { setStat: 'corruption', value: 90 },
        { setStat: 'faith', value: 40 },
      ],
    });
    const s = g.snapshot();
    expect(corruptionAspect(s, db)).toBeCloseTo(0.5);
    expect(trustFactor(s, db)).toBeCloseTo(0.75);
    expect(categoryShares(s, db, rules).hallucination).toBeCloseTo(before + 0.15);
  });
});

describe('sacrifices', () => {
  it('the immured shadow: growing offerings, a doomed target, witnesses', () => {
    let witnessed = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = newGame(seed);
      g.dispatch({
        type: 'applyEffects',
        effects: [{ giveItem: 'red-thread', qty: 3, to: 'pack' }],
      });
      expect(g.dispatch({ type: 'makeSacrifice', sacrifice: 'immured-shadow' })).toMatchObject({
        ok: false,
      });
      const r = g.dispatch({ type: 'makeSacrifice', sacrifice: 'immured-shadow', target: 'todor' });
      expect(r.ok).toBe(true);
      if (r.events.some((e) => e.type === 'sacrifice/witnessed')) {
        witnessed++;
        expect(getStat(g.snapshot(), db, 'guardian-suspicion')).toBeGreaterThanOrEqual(20);
      }
      expect(getStat(g.snapshot(), db, 'village-corruption')).toBe(25);
      // The second offering costs more (1 → 2 threads); only 2 are left.
      expect(
        g.dispatch({ type: 'makeSacrifice', sacrifice: 'immured-shadow', target: 'velika' }).ok,
      ).toBe(true);
      expect(
        g.dispatch({ type: 'makeSacrifice', sacrifice: 'immured-shadow', target: 'velika' }).ok,
      ).toBe(false);
      const claimed = days(g, 6).filter((e) => e.type === 'sacrifice/shadowClaimed');
      expect(claimed.map((e) => e.payload)).toContainEqual({ villager: 'todor' });
      expect(g.snapshot().villagers['todor']?.death?.cause).toBe('shadow-claimed');
    }
    expect(witnessed).toBeGreaterThan(0);
  });
});

describe('sacrifice and pact guards', () => {
  const reason = (g: Game, cmd: Record<string, unknown>) => {
    const r = g.dispatch(cmd);
    return r.ok ? 'ok' : r.reason;
  };

  it('refuses unknown rites, the wrong place, unknown victims and missing offerings', () => {
    const g = newGame(9);
    expect(reason(g, { type: 'makeSacrifice', sacrifice: 'nope' })).toMatch(/no such sacrifice/);
    expect(
      reason(g, { type: 'makeSacrifice', sacrifice: 'immured-shadow', target: 'ghost' }),
    ).toMatch(/no such villager/);
    expect(
      reason(g, { type: 'makeSacrifice', sacrifice: 'immured-shadow', target: 'todor' }),
    ).toMatch(/missing offerings/);
    g.dispatch({ type: 'enterZone', zone: 'forest' });
    if (g.snapshot().currentZone !== 'village')
      expect(
        reason(g, { type: 'makeSacrifice', sacrifice: 'immured-shadow', target: 'todor' }),
      ).toMatch(/not here/);
  });

  it('an unknown pact is refused and leaves the guardian unmarked', () => {
    const g = newGame(10);
    expect(g.dispatch({ type: 'signPact', pact: 'no-such-pact' }).ok).toBe(false);
    expect(corruptionAspect(g.snapshot(), db)).toBe(0);
    expect(trustFactor(g.snapshot(), db)).toBe(1);
  });
});
