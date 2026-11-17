/**
 * Acceptance (docs/systems/mysteries.md) with the real content: "The Girl Without a Shadow" is
 * found clue by clue, a lying witness is exposed, and it can be solved right or wrong — with
 * different consequences.
 */
import { Game, getStat } from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from './content';

const content = loadContentDatabase();
const M = 'girl-without-a-shadow';

function opened(): Game {
  const g = Game.newGame({ content, seed: 7 }, { startMinute: 10 * 60, startZone: 'village' });
  expect(g.dispatch({ type: 'triggerEvent', event: M }).ok).toBe(true);
  return g;
}
const found = (g: Game) => g.snapshot().mysteries[M]?.clues ?? [];
const conclude = (g: Game, culprit: string, cause: string, remedy: string) =>
  g.dispatch({ type: 'concludeMystery', mystery: M, culprit, cause, remedy });

describe('The Girl Without a Shadow', () => {
  it('opens with Mara casting no shadow', () => {
    const s = opened().snapshot();
    expect(s.flags['mara-shadow-gone']).toBe(true);
    expect(s.mysteries[M]?.status).toBe('active');
  });

  it('clues come from their sources; the lying priest is exposed by his secret', () => {
    const g = opened();
    g.dispatch({ type: 'talkTo', villager: 'radka' });
    expect(found(g)).toEqual(expect.arrayContaining(['g-no-shadow', 'g-measured']));
    g.dispatch({ type: 'interactPoi', zone: 'village', poi: 'mill' });
    expect(found(g)).toContain('g-fresh-mortar');
    g.dispatch({ type: 'talkTo', villager: 'pop-stoyan' });
    expect(found(g)).toContain('g-priest-saw');
    expect(
      g.dispatch({
        type: 'linkClue',
        mystery: M,
        clue: 'g-priest-saw',
        proposition: 'culprit:todor',
        linked: true,
      }).ok,
    ).toBe(true);
    g.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'stoyan-confessed' }] });
    const r = g.dispatch({ type: 'advanceTime', minutes: 60 });
    expect(r.events.some((e) => e.type === 'mystery/clueRetracted')).toBe(true);
    const state = g.snapshot().mysteries[M];
    expect(state?.retracted).toEqual(['g-priest-saw']);
    expect(state?.links).toEqual([]);
  });

  it('the board never judges a thread', () => {
    const g = opened();
    g.dispatch({ type: 'talkTo', villager: 'radka' });
    const r = g.dispatch({
      type: 'linkClue',
      mystery: M,
      clue: 'g-no-shadow',
      proposition: 'cause:samodiva-theft',
      linked: true,
    });
    expect(r.ok && r.events.map((e) => e.payload)).toEqual([
      { mystery: M, clue: 'g-no-shadow', proposition: 'cause:samodiva-theft', linked: true },
    ]);
    expect(
      g.dispatch({
        type: 'linkClue',
        mystery: M,
        clue: 'g-ballad',
        proposition: 'cause:x',
        linked: true,
      }).ok,
    ).toBe(false);
  });

  it('solved right: Mara is saved', () => {
    const g = opened();
    const r = conclude(g, 'krastyo', 'immured-shadow', 'exhume-the-thread');
    expect(r.ok).toBe(true);
    const done = r.ok ? r.events.find((e) => e.type === 'mystery/concluded') : undefined;
    expect(done?.payload).toMatchObject({ action: 'exhume', correct: true });
    expect(g.snapshot().flags['mara-saved']).toBe(true);
    expect(g.snapshot().flags['mara-died']).toBeUndefined();
  });

  it('solved wrong: an innocent pays and Mara dies', () => {
    const g = opened();
    const hysteria = getStat(g.snapshot(), content, 'hysteria');
    expect(conclude(g, 'baba-neda', 'immured-shadow', 'burn-the-charms').ok).toBe(true);
    const s = g.snapshot();
    expect(s.flags['mara-died']).toBe(true);
    expect(getStat(s, content, 'suspicion', 'baba-neda')).toBe(100);
    expect(getStat(s, content, 'hysteria')).toBeGreaterThan(hysteria);
    expect(s.mysteries[M]?.conclusion).toMatchObject({ culprit: 'baba-neda', correct: false });
  });

  it('half right: the culprit confesses but the thread stays in the wall', () => {
    const g = opened();
    expect(conclude(g, 'krastyo', 'immured-shadow', 'confront-the-miller').ok).toBe(true);
    expect(g.snapshot().flags['mara-died']).toBe(true);
    expect(g.snapshot().flags['mara-saved']).toBeUndefined();
  });

  it('abandoned: the unsolved outcome', () => {
    const g = opened();
    expect(g.dispatch({ type: 'abandonMystery', mystery: M }).ok).toBe(true);
    expect(g.snapshot().mysteries[M]?.status).toBe('unsolved');
    expect(g.snapshot().flags['mara-died']).toBe(true);
    expect(conclude(g, 'krastyo', 'immured-shadow', 'exhume-the-thread').ok).toBe(false);
  });
});
