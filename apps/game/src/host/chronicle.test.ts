/**
 * Acceptance (docs/systems/village-growth.md, lineage.md) with the real content: thirty years of
 * Mrak — the village ages and stays coherent, a festival rite is performed, guardians retire and
 * heirs take the lantern with the Bloodline Tree but without their forebear's talents.
 */
import { Game, heirCandidates, jdnToJulian, population, residents, ageOf } from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from './content';

const content = loadContentDatabase();
const guardian = {
  type: 'createGuardian',
  calling: 'znaharka',
  tree: 'folk-healer',
  bonus: 'cunning',
  virtue: 'compassion',
  sin: 'wrath',
} as const;

describe('thirty years of Mrak', () => {
  it('festival rites, growth and generations stay coherent', () => {
    const g = Game.newGame({ content, seed: 5 }, { startMinute: 12 * 60, startZone: 'village' });
    expect(g.dispatch(guardian).ok).toBe(true);
    // The Unclean Days are running at the start: one rite, once.
    expect(g.snapshot().calendar.chapterId).toBe('unclean-days');
    expect(
      g.dispatch({ type: 'performRite', rite: 'tar-crosses', option: 'draw-crosses' }).ok,
    ).toBe(true);
    expect(
      g.dispatch({ type: 'performRite', rite: 'tar-crosses', option: 'draw-crosses' }).ok,
    ).toBe(false);
    g.dispatch({
      type: 'applyEffects',
      effects: [
        { giveItem: 'firewood', qty: 200, to: 'storage' },
        { giveItem: 'beeswax', qty: 20, to: 'storage' },
      ],
    });
    expect(g.dispatch({ type: 'build', building: 'chapel' }).ok).toBe(true);

    const start = jdnToJulian(g.snapshot().clock.day).year;
    let heirs = 0;
    for (let y = 1; y <= 30; y++) {
      const s0 = g.snapshot();
      const me = s0.lineage.guardian;
      if (me && s0.village.partners[me] === undefined) {
        const spouse = residents(s0, content).find(
          (r) =>
            r.id !== me &&
            s0.village.partners[r.id] === undefined &&
            (ageOf(s0, content, r.id) ?? 0) >= 18,
        );
        if (spouse) g.dispatch({ type: 'marry', person: spouse.id });
      }
      if (me && (ageOf(s0, content, me) ?? 0) >= 50)
        expect(g.dispatch({ type: 'retire' }).ok).toBe(true);
      expect(g.dispatch({ type: 'skipYears', years: 1 }).ok).toBe(true);
      const s1 = g.snapshot();
      if (s1.lineage.awaitingHeir) {
        const heir = heirCandidates(s1, content)[0];
        if (heir) {
          expect(g.dispatch({ type: 'chooseHeir', heir }).ok).toBe(true);
          expect(g.snapshot().guardian.talents).toEqual([]);
          expect(g.dispatch(guardian).ok).toBe(true);
          heirs += 1;
        }
      }
      const s = g.snapshot();
      expect(jdnToJulian(s.clock.day).year).toBe(start + y);
      expect(s.village.log.at(-1)?.population).toBe(population(s, content));
    }
    const s = g.snapshot();
    expect(s.village.buildings['chapel']).toBe(1);
    expect(s.village.log).toHaveLength(30);
    expect(heirs).toBeGreaterThanOrEqual(1);
    expect(s.lineage.summary).not.toBeNull();
  });
});

describe('the Endless Chronicle with the real content', () => {
  it('the bot plays 100 years; every generated mystery passes the content validator', () => {
    const g0 = Game.newGame({ content, seed: 21 }, { startMinute: 12 * 60, startZone: 'village' });
    expect(g0.dispatch(guardian).ok).toBe(true);
    const save = g0.save();
    save.state.endless.unlocked = true; // a route ending, as the route quests grant it
    const g = Game.load(save, { content });
    expect(g.dispatch({ type: 'startEndless', darkness: 1 }).ok).toBe(true);
    const generated = new Map<string, unknown>();
    const newcomers = new Map<string, unknown>();
    for (let y = 1; y <= 100; y++) {
      const s0 = g.snapshot();
      const me = s0.lineage.guardian;
      if (me && s0.village.partners[me] === undefined) {
        const spouse = residents(s0, content).find(
          (r) =>
            r.id !== me &&
            s0.village.partners[r.id] === undefined &&
            (ageOf(s0, content, r.id) ?? 0) >= 18,
        );
        if (spouse) g.dispatch({ type: 'marry', person: spouse.id });
      }
      if (me && (ageOf(s0, content, me) ?? 0) >= 50) g.dispatch({ type: 'retire' });
      if (y % 10 === 0)
        g.dispatch({ type: 'setDarkness', level: Math.min(10, s0.endless.best + 1) });
      expect(g.dispatch({ type: 'skipYears', years: 1 }).ok).toBe(true);
      const s1 = g.snapshot();
      if (s1.lineage.awaitingHeir && !s1.lineage.ended) {
        const heir = heirCandidates(s1, content)[0];
        if (heir) {
          expect(g.dispatch({ type: 'chooseHeir', heir }).ok).toBe(true);
          expect(g.dispatch(guardian).ok).toBe(true);
        }
      }
      for (const m of g.snapshot().endless.generated) generated.set(m.id, m);
      for (const v of g.snapshot().endless.villagers) newcomers.set(v.id, v);
    }
    const s = g.snapshot();
    expect(s.endless.years).toBe(100);
    expect(s.endless.best).toBe(10);
    expect(generated.size).toBeGreaterThan(50);
    const checked = loadContentDatabase([
      {
        packId: 'generated',
        version: '0.0.0',
        collections: { mysteries: [...generated.values()], villagers: [...newcomers.values()] },
        locales: { en: {} },
      },
    ]);
    for (const id of generated.keys()) expect(checked.has('mysteries', id)).toBe(true);
  });
});
