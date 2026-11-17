import { Mystery } from '@mrak/content-schema';
import { describe, expect, it } from 'vitest';
import { ContentDatabase } from '../content/database';
import { Game } from '../game';
import { createRandom } from '../random';
import { cloneState, type WorldState } from '../state/world-state';
import { effectiveStat, getStat } from '../state/stats';
import { jdnToJulian } from '../time/calendar';
import { chronicleDb, chroniclePack } from '../test/chronicle-fixture';
import { residents, type ChronicleContext } from './common';
import { generateMystery } from './endless';
import { ageOf, heirCandidates } from './lineage';
import { seasonalActive } from './seasonal';

const db = chronicleDb;
const guardian = {
  type: 'createGuardian',
  calling: 'acolyte',
  tree: 'exorcist',
  bonus: 'wits',
  virtue: 'mercy',
  sin: 'wrath',
} as const;

function ok(g: Game, cmd: Record<string, unknown>) {
  const r = g.dispatch(cmd);
  if (!r.ok) throw new Error(`${String(cmd['type'])}: ${r.reason}`);
  return r.events;
}

function game(seed = 1): Game {
  const g = Game.newGame({ content: db, seed }, { startMinute: 12 * 60, startZone: 'village' });
  ok(g, guardian);
  ok(g, { type: 'applyEffects', effects: [{ giveItem: 'bread', qty: 300, to: 'storage' }] });
  return g;
}

/** A game whose route is finished (the Endless Chronicle is unlocked). */
function unlocked(seed = 1): Game {
  const g = game(seed);
  ok(g, { type: 'applyEffects', effects: [{ startQuest: 'ally' }, { setFlag: 'b' }] });
  ok(g, { type: 'applyEffects', effects: [{ setFlag: 'ev-fired' }] });
  return g;
}

describe('Endless Chronicle', () => {
  it('unlocks with a route ending; Darkness rises one level at a time', () => {
    const g = game();
    expect(g.dispatch({ type: 'startEndless', darkness: 0 }).ok).toBe(false);
    const u = unlocked();
    expect(u.snapshot().endless.unlocked).toBe(true);
    expect(u.dispatch({ type: 'startEndless', darkness: 2 }).ok).toBe(false);
    ok(u, { type: 'startEndless', darkness: 1 });
    expect(u.dispatch({ type: 'setDarkness', level: 3 }).ok).toBe(false);
    const events = ok(u, { type: 'setDarkness', level: 2 });
    expect(events.map((e) => e.type)).toContain('endless/relicUnlocked');
    expect(effectiveStat(u.snapshot(), db, 'creature-cunning-rate')).toBeCloseTo(1.2);
    // Lower again: the effects of level 2 are replaced, never stacked.
    ok(u, { type: 'setDarkness', level: 1 });
    expect(effectiveStat(u.snapshot(), db, 'creature-cunning-rate')).toBeCloseTo(1.1);
  });

  it('a relic talent replaces its cell (horizontal), never adds', () => {
    const u = unlocked();
    ok(u, { type: 'startEndless', darkness: 1 });
    expect(u.dispatch({ type: 'chooseRelic', relic: 'calm-relic', on: true }).ok).toBe(false);
    ok(u, { type: 'setDarkness', level: 2 });
    ok(u, { type: 'chooseRelic', relic: 'calm-relic', on: true });
    ok(u, { type: 'applyEffects', effects: [{ addStat: 'revelation', value: 100 }] });
    const bought = ok(u, { type: 'buyTalent', tree: 'exorcist', cell: 'B1' });
    expect(bought.find((e) => e.type === 'talent/bought')?.payload).toMatchObject({
      talent: 't-strong',
    });
    expect(u.snapshot().guardian.talents).toEqual(['exorcist/B1']);
  });

  it('generated mysteries pass the content schema with solid clues for the culprit', () => {
    const base = game().snapshot();
    for (let seed = 1; seed <= 200; seed++) {
      const draft = cloneState(base) as WorldState;
      const ctx: ChronicleContext = {
        db,
        apply: () => [],
        rng: createRandom(seed),
        checks: createRandom(seed),
        fear: null,
      };
      const m = generateMystery(draft, ctx);
      if (!m) throw new Error('no mystery');
      expect(Mystery.safeParse(m).success).toBe(true);
      const culprit = `culprit:${m.solution.culprit}`;
      expect(
        m.clues.filter((c) => c.reliability === 'solid' && c.supports.includes(culprit)).length,
      ).toBeGreaterThanOrEqual(2);
      for (const s of m.suspects.filter((x) => x.villager !== m.solution.culprit))
        expect(m.clues.some((c) => c.refutes.includes(`culprit:${s.villager}`))).toBe(true);
    }
  });

  it('the bot plays 100 years: no blocks, no impossible states', () => {
    const g = unlocked(9);
    ok(g, { type: 'startEndless', darkness: 1 });
    const start = jdnToJulian(g.snapshot().clock.day).year;
    for (let y = 1; y <= 100; y++) {
      const s0 = g.snapshot();
      const me = s0.lineage.guardian;
      if (me && s0.village.partners[me] === undefined) {
        const spouse = residents(s0, db).find(
          (r) =>
            r.id !== me &&
            s0.village.partners[r.id] === undefined &&
            (ageOf(s0, db, r.id) ?? 0) >= 18,
        );
        if (spouse) g.dispatch({ type: 'marry', person: spouse.id });
      }
      if (me && (ageOf(s0, db, me) ?? 0) >= 50) ok(g, { type: 'retire' });
      if (y % 25 === 0 && s0.endless.darkness < 3)
        ok(g, { type: 'setDarkness', level: s0.endless.darkness + 1 });
      // The bot solves this year's case when it can (it reads the answer: it is a bot).
      const open = s0.endless.generated.find((m) => s0.mysteries[m.id]?.status === 'active');
      if (open && y % 2 === 0)
        g.dispatch({
          type: 'concludeMystery',
          mystery: open.id,
          culprit: open.solution.culprit,
          cause: open.solution.cause,
          remedy: open.solution.remedy,
        });
      ok(g, { type: 'skipYears', years: 1 });
      const s1 = g.snapshot();
      if (s1.lineage.awaitingHeir && !s1.lineage.ended) {
        const heir = heirCandidates(s1, db)[0];
        if (heir) {
          ok(g, { type: 'chooseHeir', heir });
          ok(g, guardian);
        } else ok(g, { type: 'skipYears', years: 1 });
      }
      const s = g.snapshot();
      expect(jdnToJulian(s.clock.day).year).toBeGreaterThanOrEqual(start + y);
      expect(s.endless.generated.length).toBeLessThanOrEqual(50);
      for (const [id, m] of Object.entries(s.mysteries))
        expect(db.has('mysteries', id) || m.status !== 'active').toBe(true);
      for (const p of s.possessions) expect(db.has('villagers', p.host)).toBe(true);
      expect(getStat(s, db, 'prosperity-score')).toBeLessThanOrEqual(500);
      if (!s.lineage.awaitingHeir) expect(s.guardian.callingId).not.toBeNull();
    }
    const s = g.snapshot();
    expect(s.endless.years).toBeGreaterThanOrEqual(100);
    expect(s.endless.harvests.length).toBeGreaterThan(50);
    expect(Object.values(s.mysteries).some((m) => m.conclusion?.correct === true)).toBe(true);
    expect(s.endless.goals).toContain('ten-years');
    // The save round-trips with its generated mysteries.
    const reloaded = Game.load(g.save(), { content: new ContentDatabase(chroniclePack, db.info) });
    expect(reloaded.snapshot()).toEqual(s);
  });
});

describe('seasonal events by real date', () => {
  it('the date decides which event is active (windows may wrap the new year)', () => {
    expect(seasonalActive(db, '2026-02-14').map((e) => e.id)).toEqual(['kukeri-bells']);
    expect(seasonalActive(db, '2026-12-31').map((e) => e.id)).toEqual(['unclean-nights']);
    expect(seasonalActive(db, '2027-01-03').map((e) => e.id)).toEqual(['unclean-nights']);
    expect(seasonalActive(db, '2026-07-01')).toEqual([]);
  });

  it('activates once per season, only in its window, with its Legacy', () => {
    const g = game();
    expect(
      g.dispatch({ type: 'activateSeasonal', event: 'kukeri-bells', date: '2026-07-01' }).ok,
    ).toBe(false);
    const events = ok(g, { type: 'activateSeasonal', event: 'kukeri-bells', date: '2026-02-14' });
    expect(events.find((e) => e.type === 'seasonal/activated')?.payload).toEqual({
      event: 'kukeri-bells',
      year: 2026,
      legacy: 3,
    });
    expect(
      g.dispatch({ type: 'activateSeasonal', event: 'kukeri-bells', date: '2026-02-20' }).ok,
    ).toBe(false);
    ok(g, { type: 'activateSeasonal', event: 'unclean-nights', date: '2027-01-02' });
    expect(
      g.dispatch({ type: 'activateSeasonal', event: 'unclean-nights', date: '2026-12-26' }).ok,
    ).toBe(false);
  });
});
