import type { Hint } from '@mrak/content-schema';
import { event } from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { HintQueue, triggersOf } from './hints';

const hint = (id: string, on: Hint['on'], priority: number, when?: Hint['when']): Hint => ({
  id,
  tier: 'demo',
  titleKey: `hint.${id}.title`,
  textKey: `hint.${id}.text`,
  phase: 'first-night',
  on,
  priority,
  glossary: [],
  ...(when ? { when } : {}),
});

describe('hint queue', () => {
  const hints = [
    hint('a', 'night-started', 10),
    hint('b', 'night-started', 90),
    hint('c', 'dawn', 50, { flag: 'x' }),
  ];

  it('shows one hint at a time by priority, once', () => {
    const q = new HintQueue(hints, []);
    expect(q.trigger('night-started', () => true)?.id).toBe('b');
    expect(q.dismiss()?.id).toBe('a');
    expect(q.dismiss()).toBeNull();
    expect(q.trigger('night-started', () => true)).toBeNull(); // already seen
    expect(q.seenIds.sort()).toEqual(['a', 'b']);
  });

  it('picks the most important hint among triggers of the same moment', () => {
    const q = new HintQueue(hints, []);
    q.enqueue('night-started', () => true);
    expect(q.current).toBeNull();
    expect(q.next()?.id).toBe('b');
  });

  it('respects conditions and previously seen hints', () => {
    expect(new HintQueue(hints, []).trigger('dawn', () => false)).toBeNull();
    expect(new HintQueue(hints, ['c']).trigger('dawn', () => true)).toBeNull();
    expect(new HintQueue(hints, []).trigger('dawn', () => true)?.id).toBe('c');
  });

  it('maps core events to triggers, low sanity only when crossing the line', () => {
    const at = { day: 1, minute: 0 };
    const t = triggersOf(
      [
        event('time/nightStarted', { ...at, nightIndex: 1 }),
        event('state/statChanged', { stat: 'sanity', from: 40, to: 20 }),
      ],
      () => 76,
    );
    expect([...t].sort()).toEqual(['low-sanity', 'night-started', 'stat-changed']);
    expect(
      triggersOf([event('state/statChanged', { stat: 'sanity', from: 20, to: 10 })], () => 76).has(
        'low-sanity',
      ),
    ).toBe(false);
  });
});
