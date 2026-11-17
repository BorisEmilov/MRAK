import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { getStat } from '../state/stats';
import { cloneState, type WorldState } from '../state/world-state';
import { fixtureDb } from '../test/fixture';
import { collectionChance, pactAvailable, remedies, rollCollection } from './debt';
import { blessingProblem, blessingSlots, equipGear, grantGear, slotsFor } from './gear';
import { directorWeight, heirCapacity, learn } from './journal';
import { awardMilestone, milestonesFor, targetOf } from './revelation';
import { requireProgressionRules } from './rules';
import { compareToPlan, powerIndex, simulate, type SimProfile } from './simulate';
import { affordableTalents, treeAccessCost } from './talents';
import { resetVirtue } from './virtue';
import { event } from '../events';

const db = fixtureDb;
const rules = requireProgressionRules(db);

function guardian(minute = 600, zone = 'village', seed = 3): Game {
  const g = Game.newGame(
    { content: db, seed },
    { start: { year: 1835, month: 1, day: 10 }, startMinute: minute, startZone: zone },
  );
  g.dispatch({
    type: 'createGuardian',
    calling: 'acolyte',
    tree: 'exorcist',
    bonus: 'vigor',
    virtue: 'mercy',
    sin: 'wrath',
  });
  return g;
}
const draftOf = (g: Game) => cloneState(g.snapshot()) as WorldState;

describe('gear (G1–G5)', () => {
  it('amulets fit either amulet slot; equipping moves, unequipping empties', () => {
    const g = guardian();
    expect(slotsFor(db.get('gear', 'cross'))).toEqual(['amulet', 'amulet-2']);
    expect(slotsFor(db.get('gear', 'lantern'))).toEqual([]);
    const d = draftOf(g);
    equipGear(d, db, rules, 'amulet-2', 'cross');
    expect(d.guardian.equipment).toEqual({ weapon: 'staff', 'amulet-2': 'cross' });
    equipGear(d, db, rules, 'weapon', null);
    expect(d.guardian.equipment).toEqual({ 'amulet-2': 'cross' });
    expect(() => equipGear(d, db, rules, 'weapon', 'cross')).toThrow('wrong slot');
    expect(() => equipGear(d, db, rules, 'weapon', 'lantern')).toThrow('not owned');
    // The charm was replaced; granting it again fills the free amulet slot.
    expect(grantGear(d, db, 'charm')).toEqual([
      event('gear/equipped', { slot: 'amulet', gear: 'charm' }),
    ]);
    expect(grantGear(d, db, 'cross')).toEqual([]);
  });

  it('changing gear at night is refused away from the village', () => {
    const g = guardian(23 * 60, 'forest');
    expect(g.dispatch({ type: 'equipGear', slot: 'weapon', gear: null })).toMatchObject({
      ok: false,
      reason: 'not safe here',
    });
  });

  it('blessing problems are explained', () => {
    const g = guardian();
    const s = draftOf(g);
    expect(blessingProblem(s, db, rules, 'staff', 'holy')).toBeNull();
    s.guardian.pack = [];
    expect(blessingProblem(s, db, rules, 'staff', 'holy')).toBe('missing materials');
    expect(blessingProblem(s, db, rules, 'cross', 'grave')).toBe('wrong gear');
    expect(blessingProblem(s, db, rules, 'charm', 'holy')).toBe('no free slot');
    expect(blessingProblem(s, db, rules, 'nope', 'holy')).toBe('unknown');
    expect(blessingSlots(s, db.get('gear', 'staff'))).toBe(1);
    expect(g.dispatch({ type: 'upgradeGear', gear: 'staff', upgrade: 'nope' })).toMatchObject({
      ok: false,
      reason: 'unknown upgrade',
    });
    expect(g.dispatch({ type: 'upgradeGear', gear: 'staff', upgrade: 'iron-tip' }).ok).toBe(true);
    expect(g.dispatch({ type: 'upgradeGear', gear: 'staff', upgrade: 'iron-tip' })).toMatchObject({
      ok: false,
      reason: 'already done',
    });
  });
});

describe('debt details', () => {
  it('remedies list what is owed; collections never happen twice a night', () => {
    const g = guardian();
    g.dispatch({ type: 'applyEffects', effects: [{ addDebt: 'favour' }] });
    const evaluate = () => false;
    expect(remedies(g.snapshot(), db, evaluate)).toEqual([
      { id: 'blood', creditor: 'horned-one', owed: 0, reduce: 3, ok: false },
      { id: 'gift', creditor: 'forest-spirit', owed: 6, reduce: 4, ok: false },
    ]);
    const d = draftOf(g);
    d.debt.entries = d.debt.entries.map((e) => ({ ...e, amount: 500 }));
    const sure = {
      next: () => 0,
      int: () => 100,
      pick: <T>(x: readonly T[]) => x[0] as T,
      getState: () => 0,
      setState: () => undefined,
    };
    const first = rollCollection(d, db, rules, sure, () => true);
    expect(first.events).toHaveLength(1);
    expect(rollCollection(d, db, rules, sure, () => true).events).toEqual([]);
    expect(collectionChance(d, db, rules)).toBe(0.6);
  });

  it('a dark talent shifts collections one tier down; pacts need place and hour', () => {
    const g = guardian(23 * 60 + 45, 'forest');
    expect(pactAvailable(g.snapshot(), db, 'bargain')).toBe('ok');
    g.dispatch({ type: 'signPact', pact: 'bargain' });
    expect(pactAvailable(g.snapshot(), db, 'bargain')).toBe('signed');
    g.dispatch({ type: 'advanceTime', minutes: 11 * 60 });
    g.dispatch({ type: 'applyEffects', effects: [{ addStat: 'revelation', value: 100 }] });
    g.dispatch({ type: 'buyTalent', tree: 'servant', cell: 'A1' });
    g.dispatch({ type: 'buyTalent', tree: 'servant', cell: 'A2' });
    const d = draftOf(g);
    d.debt.entries = [
      { source: 'pact-minor', amount: 100, creditor: 'horned-one', at: { day: 0, minute: 0 } },
    ];
    d.debt.lastNight = null;
    const sure = {
      next: () => 0,
      int: () => 100,
      pick: <T>(x: readonly T[]) => x[0] as T,
      getState: () => 0,
      setState: () => undefined,
    };
    // 100 + 100 = grave, shifted to major.
    const c = rollCollection(d, db, rules, sure, () => true);
    expect(c.events[0]?.payload).toMatchObject({ severity: 'major', collection: 'knock' });
  });
});

describe('revelation, journal and virtue details', () => {
  it('targets come from the payload; milestones need a guardian', () => {
    expect(targetOf(event('time/chapterEnded', { chapter: 'c', day: 3 }))).toBe('c:3');
    expect(targetOf(event('world/zoneEntered', { zone: 'forest', firstVisit: true }))).toBe(
      'forest',
    );
    expect(targetOf(event('time/pausedChanged', { paused: true }))).toBeUndefined();
    const fresh = Game.newGame({ content: db, seed: 1 });
    const d = draftOf(fresh);
    expect(awardMilestone(d, db, 'truth')).toEqual([]);
    expect(milestonesFor(d, db, [event('time/dawn', { day: 1, minute: 0 })])).toEqual([]);
  });

  it('learning twice is once; notice weights the director; heir capacity is the journal pages', () => {
    const g = guardian();
    const d = draftOf(g);
    const demon = db.all('demons')[0]?.id ?? '';
    expect(learn(d, db, rules, 'demon', demon)).toHaveLength(2);
    expect(learn(d, db, rules, 'demon', demon)).toEqual([]);
    expect(directorWeight(d, db, rules)).toBeCloseTo(1 + 3 / 50);
    expect(heirCapacity(d, db)).toBe(2);
    expect(getStat(d, db, 'notice')).toBe(3);
  });

  it('a new chapter clears the Virtuous status', () => {
    const g = guardian();
    for (let i = 0; i < 3; i++)
      g.dispatch({
        type: 'recordDecision',
        id: `d${String(i)}`,
        choice: 'c',
        tags: ['virtue:mercy'],
      });
    const d = draftOf(g);
    expect(resetVirtue(d, rules)).toHaveLength(1);
    expect(d.flags['virtuous']).toBeUndefined();
    expect(d.modifiers.some((m) => m.source === 'virtuous')).toBe(false);
    expect(resetVirtue(d, rules)).toEqual([]);
  });

  it('tree access and affordable talents', () => {
    const g = guardian();
    expect(treeAccessCost(g.snapshot(), db, rules, 'exorcist')).toBeNull();
    expect(treeAccessCost(g.snapshot(), db, rules, 'servant')).toBeNull();
    expect(affordableTalents(g.snapshot(), db, rules)).toEqual([]);
    g.dispatch({ type: 'applyEffects', effects: [{ addStat: 'revelation', value: 5 }] });
    expect(affordableTalents(g.snapshot(), db, rules).map((p) => p.cell)).toEqual(['A1', 'B1']);
    expect(g.affordableTalents()).toHaveLength(2);
  });
});

describe('simulator (fixture content)', () => {
  const profile = (id: SimProfile['id'], dark: boolean): SimProfile => ({
    id,
    choices: { calling: 'acolyte', tree: 'exorcist', bonus: 'wits', virtue: 'mercy', sin: 'wrath' },
    perNight: { truth: 0.3 },
    checks: ['faith', 'investigation'],
    focusAttribute: 'resolve',
    attributeFirst: !dark,
    pact: dark ? { id: 'bargain', night: 2 } : null,
    favoursPerChapter: dark ? ['favour'] : [],
    payAbove: dark ? 5 : 0,
  });

  it('is deterministic with the seed and reports one sample per hour', () => {
    const a = simulate(db, {
      profile: profile('cautious', false),
      seed: 4,
      hours: 6,
      minutesPerNight: 30,
      nightsPerChapter: 4,
    });
    const b = simulate(db, {
      profile: profile('cautious', false),
      seed: 4,
      hours: 6,
      minutesPerNight: 30,
      nightsPerChapter: 4,
    });
    expect(a).toEqual(b);
    expect(a.map((s) => s.hour)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const [first, last] = [a[0], a[6]];
    expect(last?.revelation ?? 0).toBeGreaterThan(first?.revelation ?? 0);
    expect(last?.power ?? 0).toBeGreaterThanOrEqual(first?.power ?? 0);
  });

  it('the dark profile signs, takes favours, pays and carries debt', () => {
    const runs = [1, 2, 3].map((seed) =>
      simulate(db, {
        profile: profile('dark', true),
        seed,
        years: 1,
        minutesPerNight: 120,
        nightsPerChapter: 3,
      }),
    );
    expect(runs[0]?.some((s) => s.debt > 0)).toBe(true);
    const checks = compareToPlan('dark', runs);
    expect(checks.map((c) => `${String(c.hour)}:${c.metric}`)).toContain('1:debt');
    expect(compareToPlan('cautious', [[]])).toEqual([]);
  });

  it('power index sums attributes, ranks and half the talents', () => {
    const d = draftOf(guardian());
    d.guardian.talents = ['exorcist/A1', 'exorcist/B1'];
    expect(powerIndex(d)).toBe(13 + 3 + 1);
  });
});
