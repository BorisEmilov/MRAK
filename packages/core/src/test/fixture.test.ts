import { describe, expect, it } from 'vitest';
import { fixtureDb } from './fixture';

describe('test fixture', () => {
  it('passes the real content validator and indexes by id', () => {
    expect(fixtureDb.get('villagers', 'velika').id).toBe('velika');
    expect(fixtureDb.mysteryOfClue('c-alibi')).toBe('m1');
    expect(fixtureDb.statDecl('fear').scope).toBe('villager');
    expect(() => fixtureDb.get('items', 'nope')).toThrow(/unknown items "nope"/);
  });
});
