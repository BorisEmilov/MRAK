import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { migrateSave, serializeSave, deserializeSave } from '../save/save';
import { getStat } from '../state/stats';
import { fearDb } from '../test/fear-fixture';
import { lightBoundaries, jdnToJulian } from '../time/calendar';
import { fearMoments, nightOf } from './common';
import { categoryShares, pacingAt } from './director';
import { createRandom } from '../random';
import { cloneState, type WorldState } from '../state/world-state';
import type { FearContext } from './common';
import { hysteriaAtDawn, hysteriaStage } from './hysteria';
import { perception } from './sanity';
import { simulateNights } from './simulate';

const rules = fearDb.get('fear-rules', 'default');
const db = fearDb;

function newGame(seed = 1, minute = 12 * 60): Game {
  return Game.newGame({ content: db, seed }, { startMinute: minute, startZone: 'village' });
}
function set(g: Game, effects: unknown[]): void {
  const r = g.dispatch({ type: 'applyEffects', source: 'test', effects });
  expect(r).toMatchObject({ ok: true });
}
/** Minutes from now until the next dawn start. */
function untilDawn(g: Game): number {
  const s = g.snapshot();
  const { dawnStart } = lightBoundaries(jdnToJulian(s.clock.day + 1).month);
  return (dawnStart - s.clock.minute + 1440) % 1440 || 1440;
}
function withGuardian(g: Game): Game {
  const r = g.dispatch({
    type: 'createGuardian',
    calling: 'acolyte',
    tree: 'exorcist',
    bonus: 'presence',
    virtue: 'mercy',
    sin: 'wrath',
  });
  expect(r.ok).toBe(true);
  return g;
}

describe('event director', () => {
  it('simulates 12 nights with peaks and valleys (acceptance)', () => {
    const { nights, samples } = simulateNights(db, { seed: 7, nights: 12 });
    expect(nights).toHaveLength(12);
    for (const n of nights) {
      // Each night builds to a real peak…
      expect(n.fired).toBeGreaterThan(0);
      expect(n.peak).toBeGreaterThanOrEqual(30);
      expect(['build', 'peak']).toContain(n.peakPhase);
      // …and then falls into a valley before dawn.
      expect(n.valleyAfterPeak).toBeLessThanOrEqual(n.peak - 15);
    }
    // The settle phase stays low; the peak phase is where tension is highest on average.
    const mean = (phase: string) => {
      const xs = samples.filter((s) => s.phase === phase).map((s) => s.tension);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(mean('peak')).toBeGreaterThan(mean('settle'));
    expect(mean('peak')).toBeGreaterThan(mean('release'));
  });

  it('is deterministic: same seed, same curve', () => {
    const a = simulateNights(db, { seed: 3, nights: 3 }).samples;
    const b = simulateNights(db, { seed: 3, nights: 3 }).samples;
    expect(a).toEqual(b);
    expect(simulateNights(db, { seed: 4, nights: 3 }).samples).not.toEqual(a);
  });

  it('keeps a quiet after every peak event', () => {
    const { samples } = simulateNights(db, { seed: 11, nights: 12 });
    const fired = samples.filter((s) => s.outcome === 'fired');
    for (let i = 1; i < fired.length; i++) {
      const prev = fired[i - 1];
      const cur = fired[i];
      if (!prev || !cur) continue;
      const cost = db.get('events', prev.event ?? '').tensionCost;
      if (cost >= rules.director.peakCost)
        expect(cur.at - prev.at).toBeGreaterThanOrEqual(rules.director.quiet.min);
    }
  });

  it('paces the night: settle, build, peak around 03:33, release', () => {
    const day = newGame().snapshot().clock.day;
    const { start } = nightOf(day * 1440 + 23 * 60);
    expect(pacingAt(start + 30, rules).phase).toBe('settle');
    expect(pacingAt(day * 1440 + 1440 + 213, rules)).toEqual({ phase: 'peak', target: 85 });
    expect(pacingAt(day * 1440 + 1440 + 5 * 60, rules).phase).toBe('release');
    const early = pacingAt(start + 200, rules);
    const late = pacingAt(day * 1440 + 1440 + 2 * 60, rules);
    expect(early.phase).toBe('build');
    expect(late.target).toBeGreaterThan(early.target);
  });

  it('shifts the mix toward hallucinations as Sanity falls', () => {
    const g = newGame();
    expect(categoryShares(g.snapshot(), db, rules).hallucination).toBeCloseTo(0.2);
    set(g, [{ setStat: 'sanity', value: 30 }]);
    expect(categoryShares(g.snapshot(), db, rules).hallucination).toBeCloseTo(0.4);
    set(g, [{ setStat: 'sanity', value: 0 }]);
    const shares = categoryShares(g.snapshot(), db, rules);
    expect(shares.hallucination).toBeCloseTo(0.6);
    expect(shares.noise + shares.seed + shares.hallucination).toBeCloseTo(1);
  });

  it('fires windowed events only at their minute (the bell at 03:33)', () => {
    const { samples } = simulateNights(db, { seed: 5, nights: 4 });
    const bells = samples.filter((s) => s.event === 'bell');
    expect(bells.length).toBe(1);
    expect((bells[0]?.at ?? 0) % 1440).toBe(213);
  });

  it('logs the reason of every choice', () => {
    const { samples } = simulateNights(db, { seed: 2, nights: 1 });
    const g = newGame(2, 20 * 60);
    g.dispatch({ type: 'advanceTime', minutes: 600 });
    const log = g.snapshot().director.log;
    expect(log.length).toBeGreaterThan(10);
    const fired = log.find((d) => d.outcome === 'fired');
    expect(fired?.factors).toMatchObject({ base: 10, notice: 1 });
    expect(typeof fired?.factors['season']).toBe('number');
    expect(Object.keys(fired?.shares ?? {})).toEqual(['noise', 'seed', 'hallucination']);
    expect(samples.length).toBeGreaterThan(0);
  });

  it('never puts the category in the fired event', () => {
    const g = newGame(9, 20 * 60);
    const r = g.dispatch({ type: 'advanceTime', minutes: 600 });
    const fired = r.events.filter((e) => e.type === 'director/eventFired');
    expect(fired.length).toBeGreaterThan(0);
    for (const e of fired)
      expect(Object.keys(e.payload).sort()).toEqual(['event', 'occurrence', 'zone']);
  });

  it('lists fear moments in order (ticks, the witching minute, hours, dawn)', () => {
    const m = fearMoments({ day: 10, minute: 3 * 60 + 20 }, { day: 10, minute: 4 * 60 });
    expect(m.map((x) => [x.at % 1440, x.kind])).toEqual([
      [210, 'tick'],
      [213, 'witching'],
      [240, 'hour'],
      [240, 'tick'],
    ]);
  });
});

describe('evidence', () => {
  function firedGame(seed: number): { g: Game; occurrence: number; hallucination: boolean } {
    const g = newGame(seed, 20 * 60);
    g.dispatch({ type: 'advanceTime', minutes: 300 });
    const occ = g.snapshot().director.occurrences.at(-1);
    if (!occ) throw new Error('nothing fired');
    return { g, occurrence: occ.id, hallucination: occ.hallucination };
  }

  it('needs the right tool, once per method, within the window', () => {
    const g = newGame(1, 20 * 60);
    g.dispatch({ type: 'advanceTime', minutes: 60 * 4 });
    const occ = g.snapshot().director.occurrences.at(-1);
    expect(occ).toBeDefined();
    const id = occ?.id ?? 0;
    expect(
      g.dispatch({ type: 'examineEvent', occurrence: id, method: 'photograph' }),
    ).toMatchObject({ ok: false });
    expect(
      g.dispatch({ type: 'examineEvent', occurrence: id, method: 'relic', item: 'garlic' }),
    ).toMatchObject({ ok: false });
    set(g, [{ giveItem: 'holy-water', qty: 2, to: 'pack' }]);
    const r = g.dispatch({
      type: 'examineEvent',
      occurrence: id,
      method: 'relic',
      item: 'holy-water',
    });
    if (g.snapshot().clock.day * 1440 + g.snapshot().clock.minute - (occ?.at ?? 0) <= 120) {
      expect(r.ok).toBe(true);
      const found = r.events.find((e) => e.type === 'director/evidenceFound');
      expect(found?.payload).toMatchObject({
        occurrence: id,
        method: 'relic',
      });
      expect(typeof (found?.payload as { presence?: unknown } | undefined)?.presence).toBe(
        'boolean',
      );
      expect(
        g.dispatch({ type: 'examineEvent', occurrence: id, method: 'relic', item: 'holy-water' }),
      ).toMatchObject({ ok: false });
    } else expect(r).toMatchObject({ ok: false, reason: 'too long ago to examine' });
    expect(
      g.dispatch({ type: 'examineEvent', occurrence: 999, method: 'witness', villager: 'todor' }),
    ).toMatchObject({ ok: false });
  });

  it('is probabilistic: real events show up far more often than hallucinations', () => {
    const tally = { real: [0, 0], hallucination: [0, 0] };
    for (let seed = 1; seed <= 120; seed++) {
      const { g, occurrence, hallucination } = firedGame(seed);
      const r = g.dispatch({
        type: 'examineEvent',
        occurrence,
        method: 'witness',
        villager: 'todor',
      });
      if (!r.ok) continue;
      const found = r.events.find((e) => e.type === 'director/evidenceFound');
      const bucket = hallucination ? tally.hallucination : tally.real;
      bucket[1] = (bucket[1] ?? 0) + 1;
      if (found?.type === 'director/evidenceFound' && found.payload.presence)
        bucket[0] = (bucket[0] ?? 0) + 1;
    }
    const rate = (b: number[]) => (b[0] ?? 0) / Math.max(1, b[1] ?? 0);
    expect(tally.real[1]).toBeGreaterThan(10);
    expect(tally.hallucination[1]).toBeGreaterThan(5);
    expect(rate(tally.real)).toBeGreaterThan(0.55);
    expect(rate(tally.hallucination)).toBeLessThan(0.35);
  });
});

describe('sanity', () => {
  it('maps Sanity to perception tiers', () => {
    const g = newGame();
    expect(perception(g.snapshot(), db)).toEqual({ tier: 0, effects: [], whisperKeys: [] });
    set(g, [{ setStat: 'sanity', value: 37 }]); // 0.49 of 76
    expect(perception(g.snapshot(), db)).toMatchObject({
      tier: 2,
      effects: ['filter', 'whispers'],
      whisperKeys: ['whisper.a'],
    });
    set(g, [{ setStat: 'sanity', value: 10 }]);
    expect(g.perception().effects).toContain('staring');
    expect(g.snapshot().sanity.tier).toBe(4);
  });

  it('emits tier changes and a single break at 0', () => {
    const g = newGame();
    const r = g.dispatch({ type: 'applyEffects', effects: [{ setStat: 'sanity', value: 0 }] });
    expect(r.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['sanity/tierChanged', 'sanity/broken']),
    );
    expect(g.snapshot().sanity).toMatchObject({ broken: true, breaks: 1 });
    // A break makes the village wary of the guardian.
    expect(getStat(g.snapshot(), db, 'guardian-suspicion')).toBe(10);
    const again = g.dispatch({ type: 'applyEffects', effects: [{ addStat: 'sanity', value: -5 }] });
    expect(again.events.some((e) => e.type === 'sanity/broken')).toBe(false);
  });

  it('drops with sacrifices (sanity-shock rule) and forbidden knowledge', () => {
    const g = newGame();
    set(g, [{ rule: 'sanity-shock', params: { cause: 'sacrifice' } }]);
    expect(getStat(g.snapshot(), db, 'sanity')).toBe(61);
    expect(
      g.dispatch({
        type: 'applyEffects',
        effects: [{ rule: 'sanity-shock', params: { cause: 'nope' } }],
      }),
    ).toMatchObject({ ok: false });
    set(g, [{ addStat: 'notice', value: 10 }]);
    expect(getStat(g.snapshot(), db, 'sanity')).toBe(56);
  });

  it('rises with dawn at home (plus faith), rest by day, and light at night', () => {
    const g = newGame(1, 20 * 60);
    set(g, [{ setStat: 'sanity', value: 20 }]);
    g.dispatch({ type: 'advanceTime', minutes: untilDawn(g) });
    // +20 at home, +2 for 40 faith; the director's hallucinations may have cost a little.
    const after = getStat(g.snapshot(), db, 'sanity');
    expect(after).toBeGreaterThan(30);
    expect(after).toBeLessThanOrEqual(42);

    const day = newGame(1, 10 * 60);
    set(day, [{ setStat: 'sanity', value: 20 }]);
    expect(day.dispatch({ type: 'rest', minutes: 120 })).toMatchObject({ ok: true });
    expect(getStat(day.snapshot(), db, 'sanity')).toBe(28);
    const night = newGame(1, 23 * 60);
    expect(night.dispatch({ type: 'rest', minutes: 60 })).toMatchObject({ ok: false });
    set(night, [{ setStat: 'sanity', value: 20 }]);
    night.dispatch({ type: 'equipLantern', gear: 'lantern' });
    night.dispatch({
      type: 'applyEffects',
      effects: [{ giveItem: 'lamp-oil', qty: 5, to: 'pack' }],
    });
    const lit = night.dispatch({ type: 'setLanternLit', lit: true });
    if (lit.ok) {
      const before = getStat(night.snapshot(), db, 'sanity');
      const r = night.dispatch({ type: 'advanceTime', minutes: 60 });
      const lightGain = r.events.filter(
        (e) =>
          e.type === 'state/statChanged' &&
          e.payload.stat === 'sanity' &&
          e.payload.to > e.payload.from,
      );
      expect(lightGain.length).toBeGreaterThan(0);
      expect(before).toBe(20);
    }
  });
});

describe('hysteria', () => {
  it('changes stage exactly at 40, 60 and 80', () => {
    expect([39, 40, 59, 60, 79, 80].map((v) => hysteriaStage(v, rules))).toEqual([
      'calm',
      'rumours',
      'rumours',
      'accusations',
      'accusations',
      'mob',
    ]);
  });

  it('decays at dawn without incidents, not after one', () => {
    const g = newGame();
    set(g, [{ setStat: 'hysteria', value: 30 }]);
    const ctx: FearContext = { db, rules, apply: () => [], random: () => createRandom(1) };
    const dawn = { day: g.snapshot().clock.day + 1, minute: 360 };
    const quiet = cloneState(g.snapshot()) as WorldState;
    quiet.hysteria.incident = false;
    hysteriaAtDawn(quiet, ctx, dawn);
    expect(getStat(quiet, db, 'hysteria')).toBe(27);
    expect(quiet.hysteria.incident).toBe(false);

    // Raising it (here: the setup itself) is an incident: no decay that dawn.
    const stirred = cloneState(g.snapshot()) as WorldState;
    expect(stirred.hysteria.incident).toBe(true);
    hysteriaAtDawn(stirred, ctx, dawn);
    expect(getStat(stirred, db, 'hysteria')).toBe(30);
  });

  it('spreads rumours, then accusations, against the odd ones', () => {
    const g = newGame(1, 4 * 60);
    set(g, [{ setStat: 'hysteria', value: 45 }]);
    const r = g.dispatch({ type: 'advanceTime', minutes: untilDawn(g) });
    expect(r.events.some((e) => e.type === 'hysteria/rumourSpread')).toBe(true);
    set(g, [{ setStat: 'hysteria', value: 65 }]);
    const r2 = g.dispatch({ type: 'advanceTime', minutes: untilDawn(g) });
    const acc = r2.events.find((e) => e.type === 'hysteria/accusationMade');
    expect(acc).toBeDefined();
    expect(g.snapshot().hysteria.accusations).toHaveLength(1);
  });

  it('lynching an innocent raises the world Corruption (acceptance)', () => {
    const g = newGame(1, 4 * 60);
    set(g, [
      { setStat: 'hysteria', value: 95 },
      { setStat: 'suspicion', villager: 'velika', value: 60 },
    ]);
    const formed = g.dispatch({ type: 'advanceTime', minutes: untilDawn(g) });
    expect(formed.events.find((e) => e.type === 'hysteria/mobFormed')?.payload).toMatchObject({
      target: 'velika',
    });
    expect(getStat(g.snapshot(), db, 'village-corruption')).toBe(0);
    set(g, [{ setStat: 'hysteria', value: 95 }]);
    const trial = g.dispatch({ type: 'advanceTime', minutes: 1440 });
    const lynching = trial.events.find((e) => e.type === 'hysteria/lynching');
    expect(lynching?.payload).toEqual({ victim: 'velika', innocent: true });
    const s = g.snapshot();
    expect(s.villagers['velika']?.alive).toBe(false);
    expect(s.villagers['velika']?.death?.cause).toBe('lynching');
    expect(getStat(s, db, 'village-corruption')).toBe(15);
    expect(getStat(s, db, 'creature-strength-rate')).toBeCloseTo(1.1);
    expect(s.flags['innocent-lynched']).toBe(true);
    expect(s.hysteria.trials.at(-1)).toMatchObject({
      target: 'velika',
      verdict: 'lynched',
      innocent: true,
    });
  });

  it('a possessed victim is not innocent: the demon moves to a new host', () => {
    const g = newGame(1, 4 * 60);
    set(g, [
      { startPossession: 'lesser-bes', host: 'velika' },
      { setStat: 'hysteria', value: 95 },
      { setStat: 'suspicion', villager: 'velika', value: 60 },
    ]);
    g.dispatch({ type: 'advanceTime', minutes: untilDawn(g) });
    set(g, [{ setStat: 'hysteria', value: 95 }]);
    const trial = g.dispatch({ type: 'advanceTime', minutes: 1440 });
    expect(trial.events.find((e) => e.type === 'hysteria/lynching')?.payload).toEqual({
      victim: 'velika',
      innocent: false,
    });
    expect(getStat(g.snapshot(), db, 'village-corruption')).toBe(0);
    expect(g.snapshot().possessions).toEqual([
      { demon: 'lesser-bes', host: 'todor', stage: 1, revealed: false },
    ]);
  });

  it('can target the guardian, who is beaten but never killed', () => {
    const g = newGame(1, 4 * 60);
    set(g, [
      { setStat: 'hysteria', value: 90 },
      { setStat: 'guardian-suspicion', value: 80 },
    ]);
    const formed = g.dispatch({ type: 'advanceTime', minutes: untilDawn(g) });
    expect(formed.events.find((e) => e.type === 'hysteria/mobFormed')?.payload).toMatchObject({
      target: 'guardian',
    });
    expect(g.dispatch({ type: 'confrontMob', approach: 'exploit' })).toMatchObject({ ok: false });
    set(g, [{ setStat: 'hysteria', value: 90 }]);
    const sanity = getStat(g.snapshot(), db, 'sanity');
    g.dispatch({ type: 'advanceTime', minutes: 1440 });
    expect(g.snapshot().hysteria.trials.at(-1)).toMatchObject({
      target: 'guardian',
      verdict: 'lynched',
    });
    expect(getStat(g.snapshot(), db, 'sanity')).toBeLessThan(sanity);
    expect(getStat(g.snapshot(), db, 'guardian-suspicion')).toBeLessThan(80);
  });

  it('lets the guardian exploit the mob, at the price of complicity', () => {
    const g = newGame(1, 4 * 60);
    set(g, [
      { setStat: 'hysteria', value: 95 },
      { setStat: 'suspicion', villager: 'velika', value: 60 },
      { setStat: 'guardian-suspicion', value: 40 },
    ]);
    g.dispatch({ type: 'advanceTime', minutes: untilDawn(g) });
    const r = g.dispatch({ type: 'confrontMob', approach: 'exploit' });
    expect(r.ok).toBe(true);
    const s = g.snapshot();
    expect(s.villagers['velika']?.alive).toBe(false);
    expect(getStat(s, db, 'corruption')).toBe(15); // exploit 5 + complicit 10
    expect(getStat(s, db, 'guardian-suspicion')).toBe(20);
    expect(s.hysteria.mob).toBeNull();
  });

  it('calms or steers the mob with a check (once per mob)', () => {
    let calmed = 0;
    let steered = 0;
    for (let seed = 1; seed <= 20; seed++) {
      for (const approach of ['calm', 'steer'] as const) {
        const g = withGuardian(newGame(seed, 4 * 60));
        set(g, [
          { setStat: 'hysteria', value: 85 },
          { setStat: 'suspicion', villager: 'velika', value: 60 },
        ]);
        g.dispatch({ type: 'advanceTime', minutes: untilDawn(g) });
        expect(g.snapshot().hysteria.mob?.target).toBe('velika');
        const r = g.dispatch({
          type: 'confrontMob',
          approach,
          ...(approach === 'steer' ? { target: 'todor' } : {}),
        });
        expect(r.ok).toBe(true);
        expect(r.events.some((e) => e.type === 'check/resolved')).toBe(true);
        const mob = g.snapshot().hysteria.mob;
        if (approach === 'calm' && mob === null) calmed++;
        if (approach === 'steer' && mob?.target === 'todor') {
          steered++;
          expect(mob.complicit).toBe(true);
        }
        if (mob)
          expect(g.dispatch({ type: 'confrontMob', approach: 'calm' })).toMatchObject({
            ok: false,
          });
      }
    }
    expect(calmed).toBeGreaterThan(0);
    expect(steered).toBeGreaterThan(0);
  });

  it('disperses when the target dies before dawn', () => {
    const g = newGame(1, 4 * 60);
    set(g, [
      { setStat: 'hysteria', value: 95 },
      { setStat: 'suspicion', villager: 'velika', value: 60 },
    ]);
    g.dispatch({ type: 'advanceTime', minutes: untilDawn(g) });
    const r = g.dispatch({
      type: 'applyEffects',
      effects: [{ killVillager: 'velika', cause: 'fever' }],
    });
    expect(r.events.find((e) => e.type === 'hysteria/mobDispersed')?.payload).toEqual({
      target: 'velika',
      reason: 'target-died',
    });
    expect(g.snapshot().hysteria.mob).toBeNull();
  });
});

describe('saves', () => {
  it('round-trips the fear state and migrates v7 saves', () => {
    const g = newGame(1, 20 * 60);
    g.dispatch({ type: 'advanceTime', minutes: 300 });
    const text = serializeSave(g.save());
    const back = deserializeSave(text).save;
    expect(back.state.director).toEqual(g.snapshot().director);
    const v7 = JSON.parse(text) as { version: number; state: Record<string, unknown> };
    v7.version = 7;
    delete v7.state['director'];
    delete v7.state['hysteria'];
    delete v7.state['sanity'];
    const { save, migratedFrom } = migrateSave(v7);
    expect(migratedFrom).toBe(7);
    expect(save.state.hysteria).toEqual({
      mob: null,
      accusations: [],
      trials: [],
      incident: false,
    });
  });
});
