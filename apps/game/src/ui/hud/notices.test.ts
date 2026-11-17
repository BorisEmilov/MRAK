import { event } from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from '../../host/content';
import { MAX_NOTICES, mergeNotices, NOTICE_TTL_MS, noticesFrom } from './notices';

const content = loadContentDatabase();

describe('village notices', () => {
  it('announces big hysteria jumps, debt and possession; ignores small changes', () => {
    const n = noticesFrom(
      [
        event('state/statChanged', { stat: 'hysteria', from: 10, to: 18 }),
        event('state/statChanged', { stat: 'hysteria', from: 18, to: 19 }),
        event('debt/added', { source: 'pact-minor', amount: 2, total: 2 }),
        event('possession/began', { demon: 'mamnik', host: 'velika' }),
      ],
      content,
      (k) => k,
      0,
    );
    expect(n.map((x) => x.key)).toEqual(['notice.hysteria-up', 'notice.debt', 'notice.possession']);
  });

  it('expires and caps notices', () => {
    const make = (at: number) =>
      noticesFrom(
        [event('possession/began', { demon: 'mamnik', host: 'velika' })],
        content,
        (k) => k,
        at,
      );
    const many = mergeNotices([], [...make(0), ...make(0), ...make(0), ...make(0)], 0);
    expect(many).toHaveLength(MAX_NOTICES);
    expect(mergeNotices(many, [], NOTICE_TTL_MS + 1)).toEqual([]);
  });
});
