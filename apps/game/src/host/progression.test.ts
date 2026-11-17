/**
 * Acceptance of guardian progression (docs/systems/progression.md) with the real content:
 * a new guardian chooses a calling, earns Revelation from milestones and buys talents; use raises
 * skills up to their cap; signing the pact opens its dark tree and adds debt, which is collected
 * some night by an event of the same creditor; checks are reproducible with the seed; the
 * simulator stays inside the plan's bands.
 */
import { compareToPlan, Game, PROFILES, simulate, type HourSample } from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from './content';

const content = loadContentDatabase();

function guardian(seed = 1834, minute = 10 * 60, zone = 'village'): Game {
  const g = Game.newGame(
    { content, seed },
    { start: { year: 1835, month: 1, day: 10 }, startMinute: minute, startZone: zone },
  );
  const r = g.dispatch({
    type: 'createGuardian',
    calling: 'znaharka',
    tree: 'folk-healer',
    bonus: 'cunning',
    virtue: 'compassion',
    sin: 'wrath',
  });
  if (!r.ok) throw new Error(r.reason);
  return g;
}

describe('a new guardian', () => {
  it('chooses a calling, earns Revelation by milestones and buys a talent', () => {
    const g = guardian();
    const s = g.snapshot().guardian;
    expect(s.attributes).toMatchObject({ wits: 3, cunning: 4 });
    expect(s.skills['herbalism']).toEqual({ rank: 1, cap: 2, practice: 0 });
    expect(s.equipment).toMatchObject({ weapon: 'knife', clothing: 'sheepskin-coat' });
    g.dispatch({ type: 'enterZone', zone: 'samodivi-forest' });
    g.dispatch({ type: 'advanceTime', minutes: 1440 });
    g.dispatch({ type: 'enterZone', zone: 'village' });
    const ledger = g.snapshot().guardian.revelation.ledger.map((l) => l.milestone);
    expect(ledger).toEqual(expect.arrayContaining(['zone-discovered', 'night-survived']));
    const before = g.snapshot().stats['revelation'] ?? 0;
    expect(before).toBeGreaterThanOrEqual(5);
    const r = g.dispatch({ type: 'buyTalent', tree: 'folk-healer', cell: 'A1' });
    expect(r.ok).toBe(true);
    expect(g.snapshot().guardian.talents).toEqual(['folk-healer/A1']);
    expect(g.snapshot().stats['revelation']).toBe(before - 5);
  });

  it('talking is practice (6 a day at most); checks raise the rank up to the cap', () => {
    const g = guardian();
    const skill = () => g.snapshot().guardian.skills['persuasion'];
    for (const v of content.all('villagers'))
      g.dispatch({ type: 'talkTo', villager: v.id, tone: 'plain' });
    expect(skill()).toEqual({ rank: 1, cap: 2, practice: 0 }); // 6 uses: rank 0 → 1, then capped
    let ready = false;
    for (let i = 0; i < 80; i++) {
      const r = g.dispatch({
        type: 'rollCheck',
        skill: 'persuasion',
        difficulty: 'average',
        target: `v${String(i)}`,
      });
      ready ||= r.events.some((e) => e.type === 'skill/readyToGrow');
    }
    expect(skill()?.rank).toBe(2); // calling skill: cap 2
    expect(ready).toBe(true);
  });
});

describe('pacts and debt', () => {
  it('signing at the crossroads at midnight opens the dark tree and adds debt', () => {
    const g = guardian(7, 0, 'samodivi-forest');
    expect(g.pactStatus('crossroads-bargain')).toBe('ok');
    const r = g.dispatch({ type: 'signPact', pact: 'crossroads-bargain' });
    expect(r.ok).toBe(true);
    const s = g.snapshot();
    expect(s.guardian.unlockedTrees).toContain('servant-of-the-horned-one');
    expect(s.stats['debt']).toBe(5);
    expect(s.debt.entries[0]).toMatchObject({ source: 'pact-minor', creditor: 'horned-one' });
  });

  it('the debt is collected some night by an event of the same creditor', () => {
    let collected = 0;
    for (let seed = 1; seed <= 12 && collected === 0; seed++) {
      const g = guardian(seed, 0, 'samodivi-forest');
      g.dispatch({ type: 'signPact', pact: 'crossroads-bargain' });
      g.dispatch({
        type: 'applyEffects',
        effects: [{ addDebt: 'horned-crown' }, { addDebt: 'horned-crown' }],
      });
      for (let night = 0; night < 10; night++) {
        const events = g.dispatch({ type: 'advanceTime', minutes: 1440 }).events;
        for (const e of events)
          if (e.type === 'debt/collected') {
            collected += 1;
            expect(e.payload.creditor).toBe('horned-one');
            expect(content.get('debt-collections', e.payload.collection).creditor).toBe(
              'horned-one',
            );
          }
      }
      expect(g.snapshot().debt.history.length).toBe(collected);
    }
    expect(collected).toBeGreaterThan(0);
  });
});

describe('checks with omens', () => {
  it('are reproducible with the seed', () => {
    const roll = (seed: number) =>
      guardian(seed)
        .dispatch({
          type: 'rollCheck',
          skill: 'herbalism',
          difficulty: 'hard',
          context: 'herbalism',
        })
        .events.find((e) => e.type === 'check/resolved');
    expect(roll(99)).toEqual(roll(99));
    expect(roll(99)?.payload).toHaveProperty('outcomeKey');
  });
});

describe('balance simulator', () => {
  it.each(Object.keys(PROFILES) as (keyof typeof PROFILES)[])(
    'the %s profile stays inside the plan bands (progression-economy §10)',
    (id) => {
      const runs: HourSample[][] = [];
      for (let seed = 1; seed <= 8; seed++)
        runs.push(simulate(content, { profile: PROFILES[id], seed, hours: 8 }));
      const failed = compareToPlan(id, runs).filter((c) => !c.ok);
      expect(failed).toEqual([]);
    },
  );
});
