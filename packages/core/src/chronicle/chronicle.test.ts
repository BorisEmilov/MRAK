import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import type { CoreEvent } from '../events';
import { rollCollection } from '../guardian/debt';
import { requireProgressionRules } from '../guardian/rules';
import { cloneState, type WorldState } from '../state/world-state';
import { effectiveStat, getStat } from '../state/stats';
import { jdnToJulian } from '../time/calendar';
import { chronicleDb as db } from '../test/chronicle-fixture';
import { residents } from './common';
import { population, prosperityLevel } from './growth';
import { ageOf, heirCandidates } from './lineage';
import { awardLegacy, buyNode, emptyProfile, mergeProfiles, nodeBlocked } from './profile';

function create(g: Game, bloodline: string[] = []): void {
  const r = g.dispatch({
    type: 'createGuardian',
    calling: 'acolyte',
    tree: 'exorcist',
    bonus: 'wits',
    virtue: 'mercy',
    sin: 'wrath',
    bloodline,
  });
  if (!r.ok) throw new Error(r.reason);
}

function game(seed = 1, minute = 12 * 60, zone = 'village'): Game {
  const g = Game.newGame({ content: db, seed }, { startMinute: minute, startZone: zone });
  create(g);
  g.dispatch({
    type: 'applyEffects',
    effects: [
      { giveItem: 'bread', qty: 300, to: 'storage' },
      { giveItem: 'firewood', qty: 300, to: 'storage' },
      { giveItem: 'red-thread', qty: 5, to: 'storage' },
    ],
  });
  return g;
}

function ok(g: Game, cmd: Record<string, unknown>): CoreEvent[] {
  const r = g.dispatch(cmd);
  if (!r.ok) throw new Error(`${String(cmd['type'])}: ${r.reason}`);
  return [...r.events];
}

const types = (events: readonly CoreEvent[]): string[] => events.map((e) => e.type);

describe('festival chapters', () => {
  it('apply their rules while running and allow each rite once, decided by a check', () => {
    const g = game();
    if (g.snapshot().calendar.chapterId === null) ok(g, { type: 'advanceTime', minutes: 24 * 60 });
    const s = g.snapshot();
    expect(s.calendar.chapterId).toBe('unclean-days');
    expect(s.modifiers.some((m) => m.source === 'festival:unclean-days')).toBe(true);
    const events = ok(g, { type: 'performRite', rite: 'crosses', option: 'draw' });
    const done = events.find((e) => e.type === 'festival/ritePerformed');
    expect(done).toBeDefined();
    expect(types(events)).toContain('check/resolved');
    expect(g.dispatch({ type: 'performRite', rite: 'crosses', option: 'skip' }).ok).toBe(false);
  });

  it('end: the chapter rules lift and the end effects apply', () => {
    const g = game();
    ok(g, { type: 'advanceTime', minutes: 14 * 24 * 60 });
    const s = g.snapshot();
    expect(s.modifiers.some((m) => m.source === 'festival:unclean-days')).toBe(false);
    expect(s.lineage.deeds.chapters).toBeGreaterThanOrEqual(1);
  });
});

describe('village growth', () => {
  it('builds with materials and villager labour; levels add effects and prosperity', () => {
    const g = game();
    const before = g.snapshot().guardian.storage;
    ok(g, { type: 'build', building: 'hall' });
    expect(g.snapshot().village.projects).toEqual([
      { building: 'hall', level: 1, labour: 0, needed: 2 },
    ]);
    expect(g.snapshot().guardian.storage).not.toEqual(before);
    expect(g.dispatch({ type: 'build', building: 'hall' }).ok).toBe(false);
    ok(g, {
      type: 'applyEffects',
      effects: [{ rule: 'construction-labour', params: { days: 1 } }],
    });
    const built = ok(g, {
      type: 'applyEffects',
      effects: [{ rule: 'construction-labour', params: { days: 1 } }],
    });
    expect(types(built)).toContain('village/buildingBuilt');
    const s = g.snapshot();
    expect(s.village.buildings['hall']).toBe(1);
    expect(s.modifiers.some((m) => m.source === 'building:hall')).toBe(true);
    expect(getStat(s, db, 'prosperity-score')).toBe(90);
    expect(s.flags['seed-sown']).toBe(true);
  });

  it('a blood price walls in a villager shadow (they are doomed)', () => {
    const g = game();
    ok(g, { type: 'build', building: 'hall' });
    ok(g, {
      type: 'applyEffects',
      effects: [{ rule: 'construction-labour', params: { days: 2 } }],
    });
    expect(g.dispatch({ type: 'build', building: 'hall' }).ok).toBe(false);
    const victim = residents(g.snapshot(), db).find(
      (r) => !r.person && (ageOf(g.snapshot(), db, r.id) ?? 0) >= 14,
    );
    if (!victim) throw new Error('no adult villager');
    const events = ok(g, { type: 'build', building: 'hall', shadow: victim.id });
    expect(types(events)).toEqual(
      expect.arrayContaining(['sacrifice/made', 'village/buildingBuilt']),
    );
    expect(g.snapshot().sacrifices.at(-1)?.target).toBe(victim.id);
    expect(g.snapshot().flags['hall-blessed']).toBe(true);
  });

  it('prosperity levels follow the score thresholds', () => {
    expect([79, 80, 179, 180, 420].map((s) => prosperityLevel(s, [0, 80, 180, 300, 420]))).toEqual([
      1, 2, 2, 3, 5,
    ]);
  });
});

/** Ends the generation by retirement (skipping years until the guardian may retire). */
function retireGuardian(g: Game): void {
  while ((ageOf(g.snapshot(), db, g.snapshot().lineage.guardian ?? '') ?? 0) < 50)
    ok(g, { type: 'skipYears', years: 5 });
  ok(g, { type: 'retire' });
}

describe('lineage', () => {
  it("the father's pact is collected from the son as debt", () => {
    const g = game(3, 23 * 60 + 45, 'forest');
    ok(g, { type: 'signPact', pact: 'bargain' });
    const father = g.snapshot().lineage.guardian;
    retireGuardian(g);
    expect(g.snapshot().lineage.awaitingHeir).toBe(true);
    const heir = heirCandidates(g.snapshot(), db)[0];
    if (!heir) throw new Error('no heir');
    const events = ok(g, { type: 'chooseHeir', heir });
    expect(types(events)).toContain('debt/added');
    create(g);
    const s = g.snapshot();
    expect(s.lineage.guardian).toBe(heir);
    expect(s.lineage.guardian).not.toBe(father);
    expect(s.debt.entries.some((e) => e.source === 'inherited-pact')).toBe(true);
    // The creditor comes for the son.
    const d = cloneState(s) as WorldState;
    const sure = {
      next: () => 0,
      int: () => 100,
      pick: <T>(x: readonly T[]) => x[0] as T,
      getState: () => 0,
      setState: () => undefined,
    };
    const r = rollCollection(d, db, requireProgressionRules(db), sure, () => true);
    expect(r.events.map((e) => e.type)).toContain('debt/collected');
  });

  it('the heir starts stronger through the Bloodline Tree, without the father’s talents', () => {
    const g = game(4);
    ok(g, { type: 'applyEffects', effects: [{ addStat: 'revelation', value: 100 }] });
    ok(g, { type: 'buyTalent', tree: 'exorcist', cell: 'B1' });
    expect(g.snapshot().guardian.talents.length).toBeGreaterThan(0);
    const fatherMax = effectiveStat(g.snapshot(), db, 'sanity-max');
    retireGuardian(g);
    const past = g.snapshot().lineage.past.at(-1);
    expect(past?.cause).toBe('retired');
    expect(past?.legacy).toBeGreaterThan(0);
    const heir = heirCandidates(g.snapshot(), db)[0];
    if (!heir) throw new Error('no heir');
    ok(g, { type: 'chooseHeir', heir });
    expect(g.snapshot().guardian.callingId).toBeNull();
    // The account's Legacy bought two nodes; they shape the heir at creation.
    let profile = awardLegacy(emptyProfile(), `${past?.person ?? ''}@x`, 13);
    profile = buyNode(buyNode(profile, db, 'steady-blood'), db, 'family-tea');
    create(g, profile.nodes);
    const s = g.snapshot();
    expect(s.guardian.talents).toEqual([]);
    expect(s.guardian.unlockedTrees).toEqual(['exorcist']);
    expect(effectiveStat(s, db, 'sanity-max')).toBe(fatherMax + 5);
    expect(s.guardian.pack.some((st) => st.item === 'tea' && st.qty >= 2)).toBe(true);
    expect(s.lineage.bloodline).toEqual(['family-tea', 'steady-blood']);
    expect(getStat(s, db, 'generation')).toBe(2);
    expect(s.lineage.summary?.heir).toBe(heir);
  });

  it('a locked or inconsistent Bloodline is refused', () => {
    const g = Game.newGame({ content: db, seed: 1 }, { startZone: 'village' });
    const r = g.dispatch({
      type: 'createGuardian',
      calling: 'acolyte',
      tree: 'exorcist',
      bonus: 'wits',
      virtue: 'mercy',
      sin: 'wrath',
      bloodline: ['family-tea'],
    });
    expect(r.ok).toBe(false);
  });
});

describe('Bloodline profile', () => {
  it('awards each generation once, buys nodes in order, merges commutatively', () => {
    const a = awardLegacy(awardLegacy(emptyProfile(), 'p-1@10', 9), 'p-1@10', 9);
    expect(a.legacy).toEqual({ available: 9, lifetime: 9 });
    expect(nodeBlocked(a, db, 'family-tea')).toBe('requires');
    const b = buyNode(a, db, 'steady-blood');
    expect(b.legacy.available).toBe(4);
    const other = awardLegacy(emptyProfile(), 'p-7@99', 20);
    expect(mergeProfiles(b, other)).toEqual(mergeProfiles(other, b));
    expect(mergeProfiles(b, b)).toEqual(mergeProfiles(b, mergeProfiles(b, b)));
  });
});

describe('thirty years', () => {
  it('the village lives, ages and stays coherent; guardians pass the burden on', () => {
    const g = game(7);
    const start = jdnToJulian(g.snapshot().clock.day).year;
    let generations = 1;
    for (let y = 1; y <= 30; y++) {
      if (y === 3) ok(g, { type: 'build', building: 'hall' });
      const s0 = g.snapshot();
      const me = s0.lineage.guardian;
      if (me !== null && !s0.lineage.awaitingHeir && s0.village.partners[me] === undefined) {
        const spouse = residents(s0, db).find(
          (r) =>
            r.id !== me &&
            s0.village.partners[r.id] === undefined &&
            (ageOf(s0, db, r.id) ?? 0) >= 18,
        );
        if (spouse) g.dispatch({ type: 'marry', person: spouse.id });
      }
      if (me !== null && (ageOf(s0, db, me) ?? 0) >= 50) ok(g, { type: 'retire' });
      ok(g, { type: 'skipYears', years: 1 });
      const s1 = g.snapshot();
      if (s1.lineage.awaitingHeir && !s1.lineage.ended) {
        const heir = heirCandidates(s1, db)[0];
        if (heir) {
          ok(g, { type: 'chooseHeir', heir });
          create(g);
          generations += 1;
        }
      }
      // Coherence, every year.
      const s = g.snapshot();
      const year = jdnToJulian(s.clock.day).year;
      expect(year).toBe(start + y);
      expect(s.village.year).toBe(year);
      const ids = s.village.people.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const p of s.village.people) {
        expect(year - p.born).toBeGreaterThanOrEqual(0);
        expect(year - p.born).toBeLessThanOrEqual(92);
        expect(p.alive ? p.died : p.died !== null).toBe(p.alive ? null : true);
        for (const parent of p.parents)
          expect(ids.includes(parent) || db.has('villagers', parent)).toBe(true);
      }
      for (const [a, b] of Object.entries(s.village.partners))
        expect(s.village.partners[b]).toBe(a);
      expect(s.village.log.at(-1)).toMatchObject({ year, population: population(s, db) });
      const score = getStat(s, db, 'prosperity-score');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(500);
      if (!s.lineage.awaitingHeir) {
        const me2 = s.village.people.find((p) => p.id === s.lineage.guardian);
        expect(me2?.alive).toBe(true);
        expect(me2?.role).toBe('guardian');
      }
    }
    const s = g.snapshot();
    expect(s.village.log).toHaveLength(30);
    expect(s.village.buildings['hall']).toBe(1);
    expect(s.village.people.some((p) => p.origin === 'born')).toBe(true);
    expect(s.village.people.some((p) => p.origin === 'outsider' && p.secret !== null)).toBe(true);
    expect(s.village.log.reduce((a, l) => a + l.deaths, 0)).toBeGreaterThan(0);
    expect(generations).toBeGreaterThanOrEqual(2);
    expect(s.lineage.past.length).toBe(generations - 1);
  });
});
