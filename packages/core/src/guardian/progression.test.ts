import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { createRandom } from '../random';
import { effectiveStat, getStat } from '../state/stats';
import { fixtureDb } from '../test/fixture';
import { buildPool, readFaces, resolveCheck, successChance } from './checks';
import { collectionChance, inWindow, severityFor } from './debt';
import { requireProgressionRules } from './rules';
import { threshold } from './skills';
import { takeoverChance } from './virtue';
import { cloneState, type WorldState } from '../state/world-state';

const rules = requireProgressionRules(fixtureDb);
const db = fixtureDb;

function newGame(minute = 600, zone = 'village', seed = 6): Game {
  return Game.newGame(
    { content: db, seed },
    { start: { year: 1835, month: 1, day: 10 }, startMinute: minute, startZone: zone },
  );
}

function guardian(minute = 600, zone = 'village', seed = 6): Game {
  const g = newGame(minute, zone, seed);
  const r = g.dispatch({
    type: 'createGuardian',
    calling: 'acolyte',
    tree: 'exorcist',
    bonus: 'wits',
    virtue: 'mercy',
    sin: 'wrath',
  });
  if (!r.ok) throw new Error(r.reason);
  return g;
}

const give = (g: Game, effects: unknown[]) => g.dispatch({ type: 'applyEffects', effects });
const revelation = (g: Game, amount: number) => give(g, [{ addStat: 'revelation', value: amount }]);
const stat = (g: Game, id: string) => getStat(g.snapshot(), db, id);
const reason = (r: ReturnType<Game['dispatch']>) => (r.ok ? 'ok' : r.reason);

describe('creation (C1–C4)', () => {
  it('builds attributes, skills, tree, gear, ability and virtue from the calling', () => {
    const g = guardian();
    const s = g.snapshot().guardian;
    expect(s.callingId).toBe('acolyte');
    expect(s.attributes).toEqual({ vigor: 2, wits: 3, cunning: 2, resolve: 3, presence: 3 });
    expect(s.skills['faith']).toEqual({ rank: 1, cap: 2, practice: 0 });
    expect(s.skills['occultism']).toEqual({ rank: 0, cap: 1, practice: 0 });
    expect(s.unlockedTrees).toEqual(['exorcist']);
    expect(s.equipment).toEqual({ weapon: 'staff', amulet: 'cross', 'amulet-2': 'charm' });
    expect(s.pack.find((x) => x.item === 'garlic')?.qty).toBe(2);
    expect(Object.keys(g.snapshot().abilities)).toHaveLength(1);
    expect(stat(g, 'faith')).toBe(55);
    expect([s.virtue, s.sin]).toEqual(['mercy', 'wrath']);
    // Resolve 3 → Sanity max +8 (A2).
    expect(effectiveStat(g.snapshot(), db, 'sanity-max')).toBe(84);
  });

  it('rejects a second creation, a foreign tree and attributes above the creation max', () => {
    const g = guardian();
    expect(
      reason(
        g.dispatch({
          type: 'createGuardian',
          calling: 'acolyte',
          tree: 'exorcist',
          bonus: 'wits',
          virtue: 'mercy',
          sin: 'wrath',
        }),
      ),
    ).toBe('guardian already created');
    const h = newGame();
    expect(
      reason(
        h.dispatch({
          type: 'createGuardian',
          calling: 'acolyte',
          tree: 'folk',
          bonus: 'wits',
          virtue: 'mercy',
          sin: 'wrath',
        }),
      ),
    ).toBe('not a tree of this calling');
  });
});

describe('attributes and skills (A1, S1–S4)', () => {
  it('raises attributes at 10 × new rating up to the cap', () => {
    const g = guardian();
    revelation(g, 1000);
    const costs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = g.dispatch({ type: 'raiseAttribute', attribute: 'vigor' });
      for (const e of r.events) if (e.type === 'attribute/raised') costs.push(e.payload.cost);
    }
    expect(costs).toEqual([30, 40, 50]);
    expect(reason(g.dispatch({ type: 'raiseAttribute', attribute: 'vigor' }))).toBe(
      'attribute at its maximum',
    );
  });

  it('allows 6 only with an attribute-max-6 talent', () => {
    const g = guardian();
    revelation(g, 1000);
    g.dispatch({ type: 'raiseAttribute', attribute: 'resolve' });
    g.dispatch({ type: 'raiseAttribute', attribute: 'resolve' });
    expect(reason(g.dispatch({ type: 'raiseAttribute', attribute: 'resolve' }))).toBe(
      'attribute at its maximum',
    );
    g.dispatch({ type: 'buyTalent', tree: 'exorcist', cell: 'A1' });
    g.dispatch({ type: 'buyTalent', tree: 'exorcist', cell: 'B2' });
    expect(reason(g.dispatch({ type: 'raiseAttribute', attribute: 'resolve' }))).toBe('ok');
    expect(g.snapshot().guardian.attributes['resolve']).toBe(6);
  });

  it('thresholds are 6, 24, 54, 96, 150', () => {
    expect([0, 1, 2, 3, 4].map((r) => threshold(rules, r))).toEqual([6, 24, 54, 96, 150]);
  });

  it('use raises a rank up to the cap, then waits ready to grow; raising the cap ranks up at once', () => {
    const g = guardian();
    // Herbalism: not a calling skill (cap 1, rank 0). Gathering-like uses are capped at 6 a day.
    const s = () => g.snapshot().guardian.skills['investigation'];
    // investigation starts rank 1, cap 2: 24 practice to rank 2 (1–2 per check).
    let n = 0;
    for (; n < 30 && s()?.rank === 1; n++)
      g.dispatch({
        type: 'rollCheck',
        skill: 'investigation',
        difficulty: 'easy',
        target: `t${String(n)}`,
      });
    expect(s()?.rank).toBe(2);
    expect(n).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < 60; i++)
      g.dispatch({
        type: 'rollCheck',
        skill: 'investigation',
        difficulty: 'easy',
        target: `u${String(i)}`,
      });
    expect(s()?.rank).toBe(2);
    expect(s()?.practice).toBe(54);
    revelation(g, 100);
    const r = g.dispatch({ type: 'raiseSkillCap', skill: 'investigation' });
    expect(r.events.map((e) => e.type)).toContain('skill/rankUp');
    expect(s()).toEqual({ rank: 3, cap: 3, practice: 0 });
  });

  it('cap costs: calling 5 × cap, other 5 × cap + 5', () => {
    const g = guardian();
    revelation(g, 100);
    const spent = (skill: string) =>
      g
        .dispatch({ type: 'raiseSkillCap', skill })
        .events.flatMap((e) => (e.type === 'skill/capRaised' ? [e.payload.cost] : []));
    expect(spent('faith')).toEqual([15]);
    expect(spent('occultism')).toEqual([15]); // cap 1 → 2: 5 × 2 + 5
    expect(spent('occultism')).toEqual([20]);
  });

  it('anti-grind: the same target within 10 minutes gives nothing', () => {
    const g = guardian();
    const practiced = () =>
      g
        .dispatch({ type: 'rollCheck', skill: 'faith', difficulty: 'easy', target: 'well' })
        .events.filter((e) => e.type === 'skill/practiced').length;
    expect(practiced()).toBe(1);
    expect(practiced()).toBe(0);
    g.dispatch({ type: 'advanceTime', minutes: 11 });
    expect(practiced()).toBe(1);
  });

  it('spending is refused at night', () => {
    const g = guardian(23 * 60);
    revelation(g, 100);
    expect(reason(g.dispatch({ type: 'raiseAttribute', attribute: 'vigor' }))).toBe('not at night');
  });
});

describe('revelation (R1–R4)', () => {
  it('first visit to a zone awards once per zone; dawn awards every night; ledger keeps reasons', () => {
    const g = guardian();
    g.dispatch({ type: 'enterZone', zone: 'forest' });
    g.dispatch({ type: 'enterZone', zone: 'village' });
    g.dispatch({ type: 'enterZone', zone: 'forest' });
    g.dispatch({ type: 'advanceTime', minutes: 2 * 1440 });
    const ledger = g.snapshot().guardian.revelation.ledger;
    expect(ledger.filter((l) => l.milestone === 'zone-discovered')).toHaveLength(2);
    expect(ledger.filter((l) => l.milestone === 'night-survived')).toHaveLength(2);
    expect(g.snapshot().guardian.revelation.lifetime).toBe(2 * 5 + 2 * 2);
    expect(stat(g, 'revelation')).toBe(14);
  });

  it('effect-granted milestones are idempotent per target', () => {
    const g = guardian();
    give(g, [{ milestone: 'truth' }]);
    give(g, [{ milestone: 'truth' }]);
    expect(g.snapshot().guardian.revelation.lifetime).toBe(10);
  });

  it('no milestone can be triggered by killing', () => {
    for (const m of db.all('milestones')) expect(m.on?.event ?? '').not.toMatch(/kill|died|slain/);
  });
});

describe('trees and talents (T1–T8)', () => {
  it('needs prerequisites (any of them), revelation and an owned tree', () => {
    const g = guardian();
    revelation(g, 100);
    expect(reason(g.dispatch({ type: 'buyTalent', tree: 'exorcist', cell: 'A2' }))).toBe(
      'prerequisite missing',
    );
    expect(reason(g.dispatch({ type: 'buyTalent', tree: 'exorcist', cell: 'B1' }))).toBe('ok');
    expect(reason(g.dispatch({ type: 'buyTalent', tree: 'exorcist', cell: 'B2' }))).toBe('ok'); // B1 is enough
    expect(reason(g.dispatch({ type: 'buyTalent', tree: 'confessor', cell: 'A1' }))).toBe(
      'tree not owned',
    );
    expect(stat(g, 'revelation')).toBe(100 - 5 - 10);
  });

  it('second native tree costs 20, foreign 30 and +5 per talent; ranked talents stack', () => {
    const g = guardian();
    revelation(g, 200);
    const cost = (r: ReturnType<Game['dispatch']>) =>
      r.events.flatMap((e) =>
        e.type === 'tree/bought' || e.type === 'talent/bought' ? [e.payload.cost] : [],
      );
    expect(cost(g.dispatch({ type: 'buyTree', tree: 'confessor' }))).toEqual([20]);
    expect(cost(g.dispatch({ type: 'buyTree', tree: 'folk' }))).toEqual([30]);
    expect(cost(g.dispatch({ type: 'buyTalent', tree: 'folk', cell: 'A1' }))).toEqual([10]);
    g.dispatch({ type: 'buyTalent', tree: 'exorcist', cell: 'A1' });
    g.dispatch({ type: 'buyTalent', tree: 'confessor', cell: 'A1' });
    // Grit twice: +5 sanity-max per rank, on top of Resolve 3 (84).
    expect(effectiveStat(g.snapshot(), db, 'sanity-max')).toBe(94);
    expect(reason(g.dispatch({ type: 'buyTree', tree: 'servant' }))).toBe('opened by a pact');
  });

  it('soft cap: past 600 lifetime Revelation costs rise 25%, rounded up', () => {
    const g = guardian();
    for (let i = 0; i < 7; i++) give(g, [{ milestone: 'big' }]);
    expect(g.previewTalent('exorcist', 'A1')?.cost).toBe(7);
  });

  it('preview tells the cost, the reason it is locked and the dark price', () => {
    const g = guardian();
    expect(g.previewTalent('exorcist', 'A1')).toMatchObject({
      status: 'locked',
      reason: 'revelation',
      cost: 5,
    });
    revelation(g, 5);
    expect(g.previewTalent('exorcist', 'A1')).toMatchObject({
      status: 'available',
      revelationAfter: 0,
    });
    expect(g.previewTalent('exorcist', 'A2')).toMatchObject({
      status: 'locked',
      reason: 'prerequisite',
    });
  });
});

describe('pacts and dark trees (D6, T5–T6)', () => {
  it('signing opens the dark tree and adds debt; dark talents add corruption, debt and notice', () => {
    const g = guardian(23 * 60 + 40, 'forest');
    const r = g.dispatch({ type: 'signPact', pact: 'bargain' });
    expect(reason(r)).toBe('ok');
    const s = g.snapshot();
    expect(s.guardian.unlockedTrees).toContain('servant');
    expect(s.debt.entries.map((e) => [e.source, e.amount])).toEqual([['pact-minor', 5]]);
    expect(stat(g, 'debt')).toBe(5);
    expect(s.guardian.revelation.ledger.map((l) => l.milestone)).toContain('pact-signed');
    expect(reason(g.dispatch({ type: 'signPact', pact: 'bargain' }))).toBe('already signed');
    g.dispatch({ type: 'advanceTime', minutes: 10 * 60 }); // day
    revelation(g, 50);
    expect(g.previewTalent('servant', 'A1')).toMatchObject({ corruption: 4, debt: 1, notice: 2 });
    g.dispatch({ type: 'buyTalent', tree: 'servant', cell: 'A1' });
    expect(stat(g, 'corruption')).toBe(4);
    expect(stat(g, 'debt')).toBe(6);
    expect(g.check({ flag: 'b' })).toBe(true); // the dark mark changes dialogue
    // Debt empowers it: +1 Fate per 5 debt (cap 3) on persuasion.
    const pool = g.checkPool({ skill: 'persuasion', difficulty: 'average' });
    expect(pool?.parts.find((p) => p.source.startsWith('debt:'))?.fate).toBe(1);
  });

  it('cannot sign outside the place or the hour', () => {
    expect(
      reason(guardian(23 * 60 + 40, 'village').dispatch({ type: 'signPact', pact: 'bargain' })),
    ).toBe('not here');
    expect(
      reason(guardian(12 * 60, 'forest').dispatch({ type: 'signPact', pact: 'bargain' })),
    ).toBe('not at this hour');
    expect(inWindow(30, { from: '23:30', to: '01:00' })).toBe(true);
    expect(inWindow(90, { from: '23:30', to: '01:00' })).toBe(false);
  });
});

describe('debt (D2–D5)', () => {
  it('chance table: 0 → 0, 10 → 6%, 200 → 60% cap; severity boundaries', () => {
    const g = guardian();
    const at = (total: number) => {
      const s = cloneState(g.snapshot()) as WorldState;
      s.debt.entries = total
        ? [
            {
              source: 'favour',
              amount: total,
              creditor: 'forest-spirit',
              at: { day: 0, minute: 0 },
            },
          ]
        : [];
      return collectionChance(s, db, rules);
    };
    expect(at(0)).toBe(0);
    expect(at(10)).toBeCloseTo(0.06);
    expect(at(200)).toBe(0.6);
    expect(severityFor(rules, 69, 0, 0)).toBe('minor');
    expect(severityFor(rules, 70, 0, 0)).toBe('major');
    expect(severityFor(rules, 100, 19, 0)).toBe('major');
    expect(severityFor(rules, 100, 20, 0)).toBe('grave');
    expect(severityFor(rules, 100, 20, -1)).toBe('major');
  });

  it('collects at dusk, at most once a night, with an event of the same creditor', () => {
    let collections = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const g = guardian(12 * 60, 'village', seed);
      give(g, [
        { addDebt: 'favour' },
        { addDebt: 'favour' },
        { addDebt: 'favour' },
        { addDebt: 'favour' },
      ]);
      for (let d = 0; d < 5; d++) {
        const events = g
          .dispatch({ type: 'advanceTime', minutes: 1440 })
          .events.filter((e) => e.type === 'debt/collected');
        expect(events.length).toBeLessThanOrEqual(1);
        for (const e of events) {
          expect(e.payload).toMatchObject({ creditor: 'forest-spirit', collection: 'lost' });
          collections += 1;
        }
      }
    }
    // 24 debt → 14.4% a night: about 22 of 150 nights.
    expect(collections).toBeGreaterThan(8);
    expect(collections).toBeLessThan(40);
  });

  it('remedies reduce the creditor’s debt at their price, when their condition holds', () => {
    const g = guardian();
    give(g, [{ addDebt: 'favour' }, { addDebt: 'devils-luck' }]);
    expect(reason(g.dispatch({ type: 'payDebt', remedy: 'gift' }))).toBe('cannot pay now');
    give(g, [{ giveItem: 'garlic', qty: 5 }]);
    expect(reason(g.dispatch({ type: 'payDebt', remedy: 'gift' }))).toBe('ok');
    expect(stat(g, 'debt')).toBe(2 + 2);
    const sanity = stat(g, 'sanity');
    g.dispatch({ type: 'payDebt', remedy: 'blood' });
    expect(stat(g, 'debt')).toBe(2);
    expect(stat(g, 'sanity')).toBe(sanity - 15);
  });
});

describe('checks and omens (O1–O7)', () => {
  it('pool: attribute + rank + gear + state, Fate clamped to 8', () => {
    const g = guardian();
    const pool = g.checkPool({ skill: 'faith', difficulty: 'hard', context: 'vs-demon' });
    expect(pool?.parts).toEqual([
      { source: 'attribute:resolve', fate: 3, shadow: 0 },
      { source: 'skill:faith', fate: 1, shadow: 0 },
      { source: 'difficulty:hard', fate: 0, shadow: 3 },
      { source: 'gear:cross', fate: 0, shadow: -1 },
    ]);
    expect([pool?.fate, pool?.shadow]).toEqual([4, 2]);
    give(g, [{ setStat: 'sanity', value: 20 }]);
    expect(g.checkPool({ skill: 'faith', difficulty: 'easy' })?.parts).toContainEqual({
      source: 'state:very-low-sanity',
      fate: 0,
      shadow: 2,
    });
  });

  it('3 Fate vs 2 Shadow succeeds 50% (enumeration)', () => {
    expect(successChance(3, 2)).toBeCloseTo(0.5, 5);
    expect(successChance(1, 0)).toBe(0.5);
  });

  it('Faith ≥ 60 cancels one ☾; Corruption ≥ 50 turns one ☼; talents convert first', () => {
    const r = readFaces({ conversions: [] }, [3], [3, 3], 60, 0, rules);
    expect([r.good, r.bad, r.adjustments]).toEqual([1, 1, ['faith']]);
    const c = readFaces({ conversions: ['bad-to-none'] }, [6, 3], [3], 0, 50, rules);
    expect(c.adjustments).toEqual(['talent:bad-to-none', 'corruption']);
    expect([c.good, c.bad]).toEqual([1, 1]);
    expect(readFaces({ conversions: [] }, [3, 3, 6], [], 0, 0, rules).omen).toBe('great');
    expect(readFaces({ conversions: [] }, [], [3, 3, 6], 0, 0, rules).omen).toBe('dire');
  });

  it('same seed ⇒ same faces and outcome', () => {
    const roll = () => {
      const g = guardian(600, 'village', 42);
      return g
        .dispatch({ type: 'rollCheck', skill: 'investigation', difficulty: 'average' })
        .events.find((e) => e.type === 'check/resolved');
    };
    const a = roll();
    const b = roll();
    expect(a).toEqual(b);
    expect(a?.payload).toHaveProperty('outcomeKey');
  });

  it('the omen table applies its effects; the virtue boon is a one-day +1 Fate', () => {
    const g = guardian();
    g.dispatch({ type: 'recordDecision', id: 'x', choice: 'spare', tags: ['virtue:mercy'] });
    expect(g.snapshot().guardian.boonReady).toBe(true);
    expect(g.checkPool({ skill: 'faith', difficulty: 'easy' })?.parts).toContainEqual({
      source: 'virtue:boon',
      fate: 1,
      shadow: 0,
    });
    g.dispatch({ type: 'rollCheck', skill: 'faith', difficulty: 'easy' });
    expect(g.snapshot().guardian.boonReady).toBe(false);
    g.dispatch({ type: 'recordDecision', id: 'y', choice: 'spare', tags: ['virtue:mercy'] });
    expect(g.snapshot().guardian.boonReady).toBe(false); // once per day
  });

  it('blessings: check, conflict holy/dark, uses spent by checks, nights at dawn', () => {
    const g = guardian();
    give(g, [{ giveItem: 'garlic', qty: 10 }]);
    let blessed = false;
    for (let i = 0; i < 10 && !blessed; i++)
      blessed = g
        .dispatch({ type: 'blessGear', gear: 'staff', blessing: 'holy' })
        .events.some((e) => e.type === 'gear/blessed');
    expect(blessed).toBe(true);
    const holy = () => g.snapshot().guardian.blessings['staff']?.find((b) => b.blessing === 'holy');
    const uses = holy()?.usesLeft ?? 0;
    g.dispatch({ type: 'rollCheck', skill: 'faith', difficulty: 'easy', context: 'vs-demon' });
    expect(holy()?.usesLeft).toBe(uses - 1);
    let dark = false;
    for (let i = 0; i < 10 && !dark; i++)
      dark = g
        .dispatch({ type: 'blessGear', gear: 'staff', blessing: 'grave' })
        .events.some((e) => e.type === 'gear/blessed');
    expect(dark).toBe(true);
    expect(holy()).toBeUndefined();
    const nights = g.snapshot().guardian.blessings['staff']?.[0]?.nightsLeft ?? 0;
    g.dispatch({ type: 'advanceTime', minutes: 1440 * nights });
    expect(g.snapshot().guardian.blessings['staff']).toEqual([]);
  });

  it('workshop upgrades add blessing slots and effects', () => {
    const g = guardian();
    give(g, [{ giveItem: 'garlic', qty: 1 }]);
    expect(reason(g.dispatch({ type: 'upgradeGear', gear: 'staff', upgrade: 'iron-tip' }))).toBe(
      'ok',
    );
    expect(g.checkPool({ skill: 'craft', difficulty: 'easy' })?.parts).toContainEqual({
      source: 'upgrade:staff/iron-tip',
      fate: 1,
      shadow: 0,
    });
  });

  it('occult checks raise Notice ("seen by demons")', () => {
    const g = guardian();
    const draft = cloneState(g.snapshot()) as WorldState;
    resolveCheck(draft, db, rules, { skill: 'occultism', difficulty: 'easy' }, createRandom(1));
    expect(getStat(draft, db, 'notice')).toBe(1);
    expect(buildPool(draft, db, rules, { skill: 'occultism', difficulty: 'easy' }).fate).toBe(2);
  });
});

describe('virtue and sin (V1–V5)', () => {
  it('three acts by the virtue in a chapter make the guardian virtuous', () => {
    const g = guardian();
    for (let i = 0; i < 3; i++)
      g.dispatch({
        type: 'recordDecision',
        id: `d${String(i)}`,
        choice: 'c',
        tags: ['virtue:mercy'],
      });
    expect(g.check({ flag: 'virtuous' })).toBe(true);
    expect(stat(g, 'faith')).toBe(55 + 6);
    expect(g.checkPool({ skill: 'faith', difficulty: 'easy' })?.parts).toContainEqual({
      source: 'virtuous',
      fate: 1,
      shadow: 0,
    });
  });

  it('acting by the sin adds corruption; takeover chance is (corruption − faith) %, max 50%', () => {
    const g = guardian();
    g.dispatch({ type: 'recordDecision', id: 'x', choice: 'c', tags: ['sin:wrath'] });
    expect(stat(g, 'corruption')).toBe(2);
    give(g, [
      { setStat: 'corruption', value: 70 },
      { setStat: 'faith', value: 30 },
    ]);
    expect(takeoverChance(g.snapshot(), db, rules)).toBeCloseTo(0.4);
    give(g, [
      { setStat: 'corruption', value: 30 },
      { setStat: 'faith', value: 70 },
    ]);
    expect(takeoverChance(g.snapshot(), db, rules)).toBe(0);
  });

  it('high corruption blocks the virtues the sin forbids; the sin sometimes speaks instead', () => {
    const g = guardian();
    give(g, [
      { setStat: 'corruption', value: 90 },
      { setStat: 'faith', value: 0 },
    ]);
    const options = g.toneOptions();
    expect(options.find((o) => o.tone.id === 'listen')?.blockedBy).toBe('wrath');
    expect(options.find((o) => o.tone.id === 'press')?.sin).toBe(true);
    expect(options.some((o) => o.tone.id === 'marked')).toBe(false);
    expect(reason(g.dispatch({ type: 'talkTo', villager: 'velika', tone: 'listen' }))).toBe(
      'your sin will not allow it',
    );
    let took = 0;
    let vowTaken = 0;
    for (let i = 0; i < 40; i++) {
      give(g, [
        { setStat: 'corruption', value: 90 },
        { setStat: 'faith', value: 0 },
      ]);
      const r = g.dispatch({ type: 'talkTo', villager: 'velika', tone: 'comfort' });
      if (r.events.some((e) => e.type === 'sin/tookOver')) took += 1;
      const v = g.dispatch({ type: 'talkTo', villager: 'velika', tone: 'vow' });
      if (v.events.some((e) => e.type === 'sin/tookOver')) vowTaken += 1;
    }
    expect(took).toBeGreaterThan(8);
    expect(took).toBeLessThan(32);
    expect(vowTaken).toBe(0); // noSinTakeover
  });
});

describe('journal and abilities', () => {
  it('notes are capped, heir marks respect journal pages, demons learned raise notice', () => {
    const g = guardian();
    for (let i = 0; i < 3; i++) g.dispatch({ type: 'writeNote', text: `note ${String(i)}` });
    expect(reason(g.dispatch({ type: 'writeNote', text: 'one too many' }))).toBe('journal full');
    g.dispatch({ type: 'markForHeir', entry: 'note:1', heir: true });
    g.dispatch({ type: 'markForHeir', entry: 'note:2', heir: true });
    expect(reason(g.dispatch({ type: 'markForHeir', entry: 'note:3', heir: true }))).toBe(
      'journal full',
    );
    g.dispatch({ type: 'removeNote', id: 1 });
    expect(g.snapshot().journal.heir).toEqual(['note:2']);
    const demon = db.all('demons')[0]?.id ?? '';
    give(g, [{ learnDemon: demon }]);
    expect(g.snapshot().journal.learned).toEqual([`demon:${demon}`]);
    expect(stat(g, 'notice')).toBe(3);
  });

  it('active abilities pay their cost and respect their cooldown', () => {
    const g = guardian();
    const id = Object.keys(g.snapshot().abilities)[0] ?? '';
    const sanity = stat(g, 'sanity');
    expect(reason(g.dispatch({ type: 'useAbility', ability: id }))).toBe('ok');
    expect(stat(g, 'sanity')).toBe(sanity - 5);
    expect(g.snapshot().abilities[id]?.readyAt).toBeDefined();
  });
});
