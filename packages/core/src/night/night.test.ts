import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../events';
import { Game } from '../game';
import { getStat } from '../state/stats';
import { fearDb as db } from '../test/fear-fixture';
import { lightBoundaries, jdnToJulian } from '../time/calendar';
import { newAgent, stepCreature, type CreatureAgent, type Senses } from './ai';

const imp = db.get('creatures', 'imp').ai; // fears the light
const walker = db.get('creatures', 'walker').ai; // does not
const dark: Senses = { guardian: { x: 10, y: 0 }, noise: 0, light: 0, flash: false };
const run = (a: CreatureAgent, ai: typeof imp, s: Senses, seconds: number): CreatureAgent => {
  let x = a;
  for (let t = 0; t < seconds; t += 0.1)
    x = stepCreature(x, ai, s, 0.1, [
      { x: -5, y: 0 },
      { x: 0, y: 0 },
    ]);
  return x;
};
const dist = (a: CreatureAgent, s: Senses) =>
  Math.hypot(a.pos.x - s.guardian.x, a.pos.y - s.guardian.y);

describe('creature AI', () => {
  it('patrols in silence and darkness', () => {
    const a = run(newAgent({ x: 0, y: 0 }), imp, dark, 2);
    expect(a.mode).toBe('patrol');
  });

  it('follows the noise', () => {
    const loud = { ...dark, noise: 10 };
    const a = stepCreature(newAgent({ x: 0, y: 0 }), imp, loud, 0.1, []);
    expect(a.mode).toBe('suspicious');
    expect(a.target).toEqual(loud.guardian);
    const later = run(a, imp, { ...dark, noise: 0 }, 1.5);
    expect(dist(later, loud)).toBeLessThan(dist(a, loud));
    // Too quiet to be heard from afar.
    expect(stepCreature(newAgent({ x: 0, y: 0 }), imp, { ...dark, noise: 2 }, 0.1, []).mode).toBe(
      'patrol',
    );
  });

  it('hunts what it sees, and gives up when it loses it', () => {
    const near = { ...dark, guardian: { x: 1, y: 0 } };
    const a = stepCreature(newAgent({ x: 0, y: 0 }), walker, near, 0.1, []);
    expect(a.mode).toBe('hunt');
    const lost = run(a, walker, { ...dark, guardian: { x: 100, y: 0 } }, walker.memory + 1);
    expect(lost.mode).not.toBe('hunt');
  });

  it('flees the light and the flash; the returned does not', () => {
    const lit = { ...dark, guardian: { x: 2, y: 0 }, light: 3 };
    const a = stepCreature(newAgent({ x: 0, y: 0 }), imp, lit, 0.1, []);
    expect(a.mode).toBe('flee');
    const away = run(a, imp, lit, 1);
    expect(dist(away, lit)).toBeGreaterThan(2);
    const flash = stepCreature(newAgent({ x: 0, y: 0 }), imp, { ...dark, flash: true }, 0.1, []);
    expect(flash.mode).toBe('flee');
    const unafraid = stepCreature(newAgent({ x: 0, y: 0 }), walker, lit, 0.1, []);
    expect(unafraid.mode).toBe('hunt');
  });
});

function guardianGame(seed = 1): Game {
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
/** Into the night: a few minutes after nightfall. */
function atNight(g: Game): CoreEvent[] {
  const s = g.snapshot();
  const { nightStart } = lightBoundaries(jdnToJulian(s.clock.day).month);
  const r = g.dispatch({ type: 'advanceTime', minutes: nightStart - s.clock.minute + 5 });
  return r.ok ? [...r.events] : [];
}
function inForestWithEncounter(seed: number): { g: Game; id: number } | null {
  const g = guardianGame(seed);
  atNight(g);
  g.dispatch({ type: 'enterZone', zone: 'forest' });
  for (let i = 0; i < 12; i++) {
    const enc = g
      .snapshot()
      .night.encounters.find((e) => e.state === 'active' && e.zone === 'forest');
    if (enc) return { g, id: enc.id };
    g.dispatch({ type: 'advanceTime', minutes: 30 });
  }
  return null;
}

describe('a night out', () => {
  it('leave, find the origin, come back (a full night)', () => {
    const g = guardianGame();
    const start = atNight(g);
    expect(start.some((e) => e.type === 'night/started')).toBe(true);
    const night = g.snapshot().night;
    expect(night.candidates).toHaveLength(2);
    expect(night.candidates).toContain(night.origin);

    g.dispatch({ type: 'enterZone', zone: 'forest' });
    const outcomes: string[] = [];
    for (const place of night.candidates) {
      const poi = place.split('/')[1] ?? '';
      g.dispatch({ type: 'discoverPoi', zone: 'forest', poi });
      const r = g.dispatch({ type: 'interactPoi', zone: 'forest', poi });
      expect(r.ok).toBe(true);
      outcomes.push(
        ...r.events.filter((e) => e.type.startsWith('night/origin')).map((e) => e.type),
      );
      if (g.snapshot().night.found) break;
    }
    expect(outcomes.at(-1)).toBe('night/originFound');
    expect(outcomes.filter((o) => o === 'night/originFound')).toHaveLength(1);

    const back = g.dispatch({ type: 'enterZone', zone: 'village' });
    expect(back.ok && back.events.map((e) => e.type)).toContain('night/completed');
    expect(g.snapshot().night.completed).toBe(true);
  });

  it('the director places encounters on the spawn points of the guardian’s zone', () => {
    const found = inForestWithEncounter(1);
    expect(found).not.toBeNull();
    const enc = found?.g.snapshot().night.encounters[0];
    expect(enc).toMatchObject({ creature: 'imp', zone: 'forest', poi: 'meadow', state: 'active' });
  });

  it('flash (oil), rituals with the right item, strikes, stealth — all by checks', () => {
    let banished = 0;
    let evaded = 0;
    let hit = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const f = inForestWithEncounter(seed);
      if (!f) continue;
      const { g, id } = f;
      expect(g.dispatch({ type: 'nightAction', encounter: id, action: 'flash' }).ok).toBe(false);
      g.dispatch({
        type: 'applyEffects',
        effects: [{ giveItem: 'holy-water', qty: 1, to: 'pack' }],
      });
      const action = seed % 3 === 0 ? 'ritual' : seed % 3 === 1 ? 'sneak' : 'strike';
      const r = g.dispatch({
        type: 'nightAction',
        encounter: id,
        action,
        ...(action === 'ritual' ? { item: 'holy-water' } : {}),
      });
      expect(r.ok).toBe(true);
      expect(r.events.some((e) => e.type === 'check/resolved')).toBe(true);
      const enc = g.snapshot().night.encounters.find((e) => e.id === id);
      if (enc?.state === 'banished') banished++;
      if (enc?.state === 'evaded') evaded++;
      if (enc && enc.health < 20) hit++;
    }
    expect(banished + evaded + hit).toBeGreaterThan(0);
  });

  it('a dodge takes the next blow; the Last Breath or death hands over to the lineage', () => {
    let died = 0;
    let survived = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const f = inForestWithEncounter(seed);
      if (!f) continue;
      const { g, id } = f;
      // The imp strikes for 60: the first blow hurts, the second brings the Last Breath.
      g.dispatch({ type: 'applyEffects', effects: [{ setStat: 'guardian-health', value: 70 }] });
      const hurt = g.dispatch({ type: 'creatureStrikes', encounter: id });
      expect(getStat(g.snapshot(), db, 'guardian-health')).toBe(10);
      if (!hurt.ok) continue;
      const r = g.dispatch({ type: 'creatureStrikes', encounter: id });
      const types = r.ok ? r.events.map((e) => e.type) : [];
      if (types.includes('guardian/died')) {
        died++;
        expect(g.snapshot().lineage.awaitingHeir).toBe(true);
        expect(types).toContain('lineage/heirNeeded');
      } else if (types.includes('guardian/lastBreath')) {
        survived++;
        expect(g.snapshot().currentZone).toBe('village');
        expect(getStat(g.snapshot(), db, 'guardian-health')).toBe(30);
      }
    }
    expect(died + survived).toBeGreaterThan(0);

    const d = inForestWithEncounter(2);
    if (!d) throw new Error('no encounter');
    for (
      let i = 0;
      i < 6 && !d.g.snapshot().night.encounters.find((e) => e.id === d.id)?.dodge;
      i++
    )
      d.g.dispatch({ type: 'nightAction', encounter: d.id, action: 'dodge' });
    if (d.g.snapshot().night.encounters.find((e) => e.id === d.id)?.dodge) {
      const r = d.g.dispatch({ type: 'creatureStrikes', encounter: d.id });
      expect(r.ok && r.events.map((e) => e.type)).toEqual(['night/dodged']);
    }
  });

  it('the village calls while the guardian is away', () => {
    const g = guardianGame();
    atNight(g);
    g.dispatch({ type: 'enterZone', zone: 'forest' });
    const r = g.dispatch({
      type: 'applyEffects',
      effects: [{ killVillager: 'todor', cause: 'fever' }],
    });
    expect(r.ok && r.events.find((e) => e.type === 'village/alert')?.payload).toEqual({
      reason: 'death',
    });
  });
});
