import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../events';
import { Game } from '../game';
import { createRandom } from '../random';
import { getStat } from '../state/stats';
import { fearDb as db } from '../test/fear-fixture';
import { tauntsFor } from './exorcism';
import { chooseHost, trueNameProgress } from './possession';

function newGame(seed = 1, minute = 12 * 60): Game {
  const g = Game.newGame({ content: db, seed }, { startMinute: minute, startZone: 'village' });
  // Fed and warm: the villagers must outlive the test.
  g.dispatch({
    type: 'applyEffects',
    effects: [
      { giveItem: 'bread', qty: 300, to: 'storage' },
      { giveItem: 'firewood', qty: 300, to: 'storage' },
    ],
  });
  return g;
}
function apply(g: Game, effects: unknown[]): CoreEvent[] {
  const r = g.dispatch({ type: 'applyEffects', source: 'test', effects });
  expect(r.ok).toBe(true);
  return [...r.events];
}
function guardian(g: Game): Game {
  const r = g.dispatch({
    type: 'createGuardian',
    calling: 'acolyte',
    tree: 'exorcist',
    bonus: 'wits',
    virtue: 'mercy',
    sin: 'wrath',
  });
  expect(r.ok).toBe(true);
  return g;
}
const possess = (g: Game, host = 'velika') => apply(g, [{ startPossession: 'lesser-bes', host }]);
const learnName = (g: Game) =>
  apply(g, [
    { nameFragment: 'lesser-bes', fragment: 'grave' },
    { nameFragment: 'lesser-bes', fragment: 'confession' },
  ]);

describe('possession', () => {
  it('symptoms advance with the days (acceptance)', () => {
    const g = newGame(3);
    possess(g);
    const seen: string[] = [];
    for (let day = 0; day < 10; day++) {
      const r = g.dispatch({ type: 'advanceTime', minutes: 1440 });
      for (const e of r.events)
        if (e.type === 'possession/symptomSeen' && e.payload.villager === 'velika')
          seen.push(e.payload.symptom);
    }
    expect(g.snapshot().possessions[0]?.stage).toBe(3);
    // Never better from one dawn to the next, and the worst by the end.
    const stages = seen.map((k) => Number(k.slice(-1)));
    expect(stages.every((v, i) => i === 0 || v >= (stages[i - 1] ?? 0))).toBe(true);
    expect(stages[0]).toBeLessThan(3);
    expect(seen.at(-1)).toBe('demon.lesser-bes.s3');
  });

  it('picks the most vulnerable host when none is given', () => {
    const g = newGame();
    apply(g, [
      { setStat: 'fear', villager: 'velika', value: 100 },
      { setStat: 'villager-faith', villager: 'velika', value: 0 },
      { setStat: 'fear', villager: 'todor', value: 0 },
      { setStat: 'villager-faith', villager: 'todor', value: 100 },
    ]);
    const rng = createRandom(9);
    let velika = 0;
    for (let i = 0; i < 200; i++) if (chooseHost(g.snapshot(), db, rng) === 'velika') velika++;
    expect(velika).toBeGreaterThan(140);
    const events = apply(g, [{ startPossession: 'lesser-bes' }]);
    expect(events[0]?.type).toBe('possession/began');
  });

  it('shows false symptoms in the unpossessed', () => {
    const g = newGame(5);
    let falseOnes = 0;
    for (let day = 0; day < 30; day++) {
      const r = g.dispatch({ type: 'advanceTime', minutes: 1440 });
      falseOnes += r.events.filter((e) => e.type === 'possession/symptomSeen').length;
    }
    expect(g.snapshot().possessions).toHaveLength(0);
    expect(falseOnes).toBeGreaterThan(0);
  });

  it('composes the true name from fragments in the journal', () => {
    const g = newGame();
    expect(trueNameProgress(g.snapshot(), db, 'lesser-bes')).toEqual({
      have: [],
      total: 2,
      known: false,
    });
    const events = learnName(g).map((e) => e.type);
    expect(events).toEqual([
      'journal/nameFragmentFound',
      'journal/nameFragmentFound',
      'journal/trueNameComposed',
    ]);
    expect(trueNameProgress(g.snapshot(), db, 'lesser-bes').known).toBe(true);
    expect(
      g.dispatch({
        type: 'applyEffects',
        effects: [{ nameFragment: 'lesser-bes', fragment: 'nope' }],
      }).ok,
    ).toBe(false);
  });
});

describe('exorcism', () => {
  it('taunts with real facts of the playthrough (acceptance)', () => {
    const g = guardian(newGame());
    const pact = db.all('pacts')[0];
    if (!pact) throw new Error('fixture has no pact');
    apply(g, [
      { killVillager: 'todor', cause: 'fever' },
      { addDebt: 'pact-minor' },
      { rule: 'sanity-shock', params: { cause: 'sacrifice' } },
    ]);
    const s = g.snapshot();
    const state = {
      ...s,
      pacts: { [pact.id]: { signedAt: { day: s.clock.day, minute: 0 }, clauses: {} } },
    };
    const taunts = tauntsFor(state, db, 'lesser-bes', 8);
    expect(taunts).toEqual(
      expect.arrayContaining([
        { key: 'demon.lesser-bes.taunt.pact', params: { pact: pact.nameKey } },
        { key: 'demon.lesser-bes.taunt.sacrifice', params: {} },
        {
          key: 'demon.lesser-bes.taunt.death',
          params: { name: db.get('villagers', 'todor').nameKey },
        },
        {
          key: 'demon.lesser-bes.taunt.debt',
          params: { debt: db.get('debt-sources', 'pact-minor').nameKey },
        },
      ]),
    );
    // Nothing that did not happen: no lynching taunt.
    expect(taunts.some((t) => t.key.endsWith('lynching'))).toBe(false);
    // A clean playthrough gives the demon nothing to say.
    expect(tauntsFor(newGame().snapshot(), db, 'lesser-bes', 8)).toEqual([]);

    possess(g);
    g.dispatch({ type: 'startExorcism', host: 'velika' });
    const r = g.dispatch({ type: 'confrontDemon' });
    expect(r.ok).toBe(true);
    const spoken = r.events.filter((e) => e.type === 'exorcism/taunted').map((e) => e.payload);
    expect(spoken).toContainEqual({
      key: 'demon.lesser-bes.taunt.death',
      params: { name: db.get('villagers', 'todor').nameKey },
    });
  });

  it('works with success and with failure (acceptance)', () => {
    let succeeded = 0;
    let failed = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const g = guardian(newGame(seed));
      possess(g);
      learnName(g);
      apply(g, [
        { giveItem: 'holy-water', qty: 1, to: 'pack' },
        { giveItem: 'garlic', qty: 1, to: 'pack' },
        { giveItem: 'red-thread', qty: 1, to: 'pack' },
      ]);
      expect(g.dispatch({ type: 'startExorcism', host: 'velika' }).ok).toBe(true);
      for (const item of ['holy-water', 'garlic', 'red-thread'])
        expect(g.dispatch({ type: 'prepareExorcism', item }).ok).toBe(true);
      g.dispatch({ type: 'confrontDemon' });
      if (g.snapshot().exorcism?.phase === 'naming')
        g.dispatch({ type: 'speakName', demon: 'lesser-bes' });
      for (let round = 0; g.snapshot().exorcism?.phase === 'expulsion' && round < 10; round++)
        g.dispatch({ type: 'expel', effort: seed % 2 === 0 ? 'press' : 'hold' });
      const s = g.snapshot();
      expect(s.exorcism).toBeNull();
      const host = s.possessions[0]?.host;
      if (s.possessions.length === 0) succeeded++;
      else {
        failed++;
        // The demon jumped: to the most frightened villager nearby, or to the guardian.
        expect(['todor', 'guardian']).toContain(host);
      }
    }
    expect(succeeded).toBeGreaterThan(0);
    expect(failed).toBeGreaterThan(0);
  });

  it('fails on the wrong host, the wrong phase, or an unknown name', () => {
    const g = guardian(newGame());
    expect(g.dispatch({ type: 'startExorcism', host: 'todor' }).ok).toBe(true);
    const empty = g.dispatch({ type: 'confrontDemon' });
    expect(empty.events.map((e) => e.type)).toContain('exorcism/empty');
    possess(g);
    g.dispatch({ type: 'startExorcism', host: 'velika' });
    expect(g.dispatch({ type: 'expel', effort: 'press' })).toMatchObject({ ok: false });
    expect(g.dispatch({ type: 'prepareExorcism', item: 'holy-water' })).toMatchObject({
      ok: false,
    });
    const abandoned = g.dispatch({ type: 'abandonExorcism' });
    expect(abandoned.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['exorcism/failed', 'exorcism/demonJumped']),
    );
  });

  it('binds the demon instead: the possession ends and the guardian owes', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = guardian(newGame(seed));
      possess(g);
      learnName(g);
      g.dispatch({ type: 'startExorcism', host: 'velika' });
      g.dispatch({ type: 'confrontDemon' });
      if (g.snapshot().exorcism?.phase !== 'naming') continue;
      const debt = getStat(g.snapshot(), db, 'debt');
      const r = g.dispatch({ type: 'speakName', demon: 'lesser-bes', bind: true });
      expect(r.events.map((e) => e.type)).toContain('exorcism/bound');
      expect(g.snapshot().possessions).toEqual([]);
      expect(g.snapshot().debt.entries.at(-1)?.source).toBe('pact-minor');
      expect(getStat(g.snapshot(), db, 'debt')).toBeGreaterThanOrEqual(debt);
      return;
    }
    throw new Error('no seed reached the naming phase');
  });
});
