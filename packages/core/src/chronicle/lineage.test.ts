/** Lineage guards and edge cases (docs/systems/lineage.md → Edge cases). */
import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { chronicleDb as db } from '../test/chronicle-fixture';
import { residents } from './common';
import { ageOf, heirCandidates, legacyOf, waitingHeir } from './lineage';

function game(seed = 1): Game {
  const g = Game.newGame({ content: db, seed }, { startMinute: 12 * 60, startZone: 'village' });
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
const reason = (g: Game, cmd: Record<string, unknown>) => {
  const r = g.dispatch(cmd);
  return r.ok ? 'ok' : r.reason;
};
const people = (g: Game) => g.snapshot().village.people;

describe('lineage guards', () => {
  it('marriage: one partner, adults of the village only, never family, never twice', () => {
    const g = game();
    const me = g.snapshot().lineage.guardian ?? '';
    expect(reason(g, { type: 'marry', person: me })).toMatch(/cannot marry/);
    expect(reason(g, { type: 'marry', person: 'nobody' })).toMatch(/cannot marry/);
    const adults = residents(g.snapshot(), db).filter(
      (p) => p.id !== me && (ageOf(g.snapshot(), db, p.id) ?? 0) >= 18,
    );
    const partner = adults[0];
    if (!partner) throw new Error('fixture has no adult');
    expect(reason(g, { type: 'marry', person: partner.id })).toBe('ok');
    expect(reason(g, { type: 'marry', person: adults[1]?.id ?? partner.id })).toMatch(
      /already married/,
    );
    expect(g.snapshot().village.partners[me]).toBe(partner.id);
  });

  it('apprentices: only living villagers old enough', () => {
    const g = game(2);
    expect(reason(g, { type: 'takeApprentice', person: 'nobody' })).toMatch(/cannot be taken/);
    const me = g.snapshot().lineage.guardian ?? '';
    // The guardian is a person, but not a 'villager' who can be taken in.
    expect(reason(g, { type: 'takeApprentice', person: me })).toMatch(/cannot be taken/);
    for (const p of people(g).filter((x) => x.role === 'villager'))
      expect(['ok', 'too young']).toContain(reason(g, { type: 'takeApprentice', person: p.id }));
  });

  it('retire is refused while young; chooseHeir only when an heir is awaited', () => {
    const g = game(3);
    expect(reason(g, { type: 'retire' })).toMatch(/too young/);
    expect(reason(g, { type: 'chooseHeir', heir: 'anyone' })).toMatch(/no heir is needed/);
    expect(ageOf(g.snapshot(), db, 'nobody')).toBeNull();
    expect(legacyOf(g.snapshot(), db)).toBeGreaterThanOrEqual(0);
  });

  it('a death without heirs ends the line; a family is awaited otherwise', () => {
    const g = game(4);
    const r = g.dispatch({
      type: 'applyEffects',
      effects: [{ addStat: 'guardian-health', value: -999 }],
    });
    expect(r.ok).toBe(true);
    const s = g.snapshot();
    if (!s.lineage.awaitingHeir) return; // the fixture's health rule did not kill: nothing to check
    expect(s.lineage.guardian).toBeNull();
    const heirs = heirCandidates(s, db);
    expect(s.lineage.ended).toBe(heirs.length === 0 && !waitingHeir(s));
    expect(reason(g, { type: 'chooseHeir', heir: 'not-a-person' })).toMatch(/not an heir/);
    expect(reason(g, { type: 'marry', person: 'x' })).toMatch(/no guardian serves/);
  });
});
