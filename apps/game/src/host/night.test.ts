/**
 * Acceptance (docs/systems/night-exploration.md) with the real content: a full night — leave
 * the village, find where the evil comes from, come back.
 */
import { Game, jdnToJulian, lightBoundaries } from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from './content';

const content = loadContentDatabase();

describe('a full night out', () => {
  it('leave, find the origin, return', () => {
    const g = Game.newGame({ content, seed: 11 }, { startMinute: 12 * 60, startZone: 'village' });
    const created = g.dispatch({
      type: 'createGuardian',
      calling: 'znaharka',
      tree: 'folk-healer',
      bonus: 'cunning',
      virtue: 'compassion',
      sin: 'wrath',
    });
    expect(created.ok).toBe(true);
    const s = g.snapshot();
    const { nightStart } = lightBoundaries(jdnToJulian(s.clock.day).month);
    g.dispatch({ type: 'advanceTime', minutes: nightStart - s.clock.minute + 5 });
    const night = g.snapshot().night;
    expect(night.candidates.length).toBeGreaterThanOrEqual(2);
    expect(night.origin).not.toBeNull();

    for (const place of night.candidates) {
      const [zone = '', poi = ''] = place.split('/');
      expect(g.dispatch({ type: 'enterZone', zone }).ok).toBe(true);
      g.dispatch({ type: 'discoverPoi', zone, poi });
      g.dispatch({ type: 'interactPoi', zone, poi });
      if (g.snapshot().night.found) break;
    }
    expect(g.snapshot().night.found).toBe(true);
    const home = g.dispatch({ type: 'enterZone', zone: 'village' });
    expect(home.ok && home.events.map((e) => e.type)).toContain('night/completed');
  });
});
