import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { fixtureDb } from '../test/fixture';
import { julianToJdn } from '../time/calendar';
import { deserializeSave, migrateSave, SAVE_VERSION, SaveError, serializeSave } from './save';

const now = (): Date => new Date('2026-11-15T12:00:00.000Z');

function playedGame(): Game {
  const game = Game.newGame({ content: fixtureDb, seed: 1834, now }, { startZone: 'forest' });
  game.dispatch({
    type: 'applyEffects',
    effects: [{ setFlag: 'a' }, { addStat: 'hysteria', value: 7 }],
  });
  game.dispatch({
    type: 'applyEffects',
    effects: [{ addStat: 'fear', villager: 'velika', value: 30 }],
  });
  game.dispatch({
    type: 'applyEffects',
    effects: [{ giveItem: 'garlic', qty: 2 }, { addDebt: 'devils-luck' }],
  });
  game.dispatch({
    type: 'applyEffects',
    source: 'kyrie',
    effects: [{ ability: { uses: 1, per: 'night', effects: [{ setFlag: 'b' }] } }],
  });
  game.dispatch({
    type: 'recordDecision',
    id: 'spare-the-miller',
    choice: 'spared',
    context: { mercy: true },
  });
  game.dispatch({ type: 'enterZone', zone: 'forest' });
  game.random.get('checks').next();
  game.random.get('director').int(1, 6);
  game.tick(60_000); // one tick is capped at 60 s of real time
  game.tick(30_500); // 90.5 in-world minutes in total: leaves a sub-minute fraction
  return game;
}

describe('save round-trip', () => {
  it('serialize → deserialize → identical state', () => {
    const game = playedGame();
    const text = serializeSave(game.save());
    const loaded = Game.load(text, { content: fixtureDb, now });
    expect(loaded.snapshot()).toEqual(game.snapshot());
    expect(loaded.warnings).toEqual([]);
    expect(serializeSave(loaded.save())).toBe(text);
  });

  it('restores RNG streams so both games continue identically', () => {
    const game = playedGame();
    const loaded = Game.load(serializeSave(game.save()), { content: fixtureDb, now });
    for (const stream of ['checks', 'director', 'night'] as const) {
      const a = Array.from({ length: 5 }, () => game.random.get(stream).next());
      const b = Array.from({ length: 5 }, () => loaded.random.get(stream).next());
      expect(b).toEqual(a);
    }
    game.tick(10 * 60 * 60_000);
    loaded.tick(10 * 60 * 60_000);
    expect(loaded.snapshot()).toEqual(game.snapshot());
  });

  it('stores metadata: in-game date, zone, playtime, content version, seed', () => {
    const save = playedGame().save();
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.savedAt).toBe('2026-11-15T12:00:00.000Z');
    expect(save.meta).toMatchObject({
      gameDate: { year: 1834, month: 12, day: 25, minute: 8 * 60 + 90 },
      zone: 'forest',
      playtimeMs: 90_500,
      contentVersion: '0.1.0',
      contentHash: 'test',
    });
    expect(save.rng.seed).toBe(1834);
  });
});

describe('migrations', () => {
  const v1 = {
    version: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    seed: 77,
    rngState: 123456,
    contentVersion: '0.0.9',
    world: {
      day: julianToJdn({ year: 1835, month: 1, day: 2 }),
      minute: 1300,
      flags: ['a', 'witch-allied'],
      stats: { hysteria: 42 },
      inventory: { garlic: 3 },
      villagers: { velika: { alive: false, affinity: { guardian: -20 } } },
      zone: 'forest',
      playtimeSeconds: 3600,
    },
  };

  it('upgrades a version-1 save to the current format', () => {
    const { save, migratedFrom } = migrateSave(structuredClone(v1));
    expect(migratedFrom).toBe(1);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.state.flags).toEqual({ a: true, 'witch-allied': true });
    expect(save.state.guardian.storage).toEqual([{ item: 'garlic', qty: 3 }]);
    expect(save.state.collection.found).toEqual(['garlic']);
    expect(save.state.playtimeMs).toBe(3_600_000);
    expect(save.state.decisions).toEqual([]);
    expect(save.rng).toEqual({ seed: 77, streams: { director: 123456 } });
    expect(save.meta.gameDate).toEqual({ year: 1835, month: 1, day: 2, minute: 1300 });
  });

  it('loads a migrated save into a playable game, reconciled with current content', () => {
    const game = Game.load(JSON.stringify(v1), { content: fixtureDb, now });
    const s = game.snapshot();
    expect(s.villagers['velika']?.alive).toBe(false);
    expect(s.villagers['todor']?.alive).toBe(true); // added by reconciliation
    expect(s.zones['forest']).toBeDefined();
    expect(game.zoneVariant('forest')).toBe('hostile'); // derived from the witch-allied flag
    expect(game.warnings).toEqual([
      'save migrated from version 1',
      'content version changed: save 0.0.9, game 0.1.0',
    ]);
    expect(game.random.get('director').getState()).toBe(123456);
  });

  it('rejects saves from the future, broken saves and garbage', () => {
    expect(() => migrateSave({ ...v1, version: SAVE_VERSION + 1 })).toThrow(/newer/);
    expect(() => migrateSave({ ...v1, world: { ...v1.world, minute: 5000 } })).toThrow(SaveError);
    expect(() => migrateSave({ hello: 'world' })).toThrow(/no version/);
    expect(() => deserializeSave('{not json')).toThrow(/not valid JSON/);
  });
});
