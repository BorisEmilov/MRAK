import { describe, expect, it } from 'vitest';
import { event } from '../events';
import { Game } from '../game';
import { fixtureDb } from '../test/fixture';
import { julianToJdn } from '../time/calendar';
import { AUTOSAVE_INTERVAL_MS, AutosavePolicy, canManualSave } from './autosave';
import { sha256Hex, utf8 } from './checksum';
import {
  openSealed,
  packExport,
  SaveCorruptError,
  sealSave,
  unpackExport,
  verifySealed,
} from './integrity';
import { migrateSave, SAVE_VERSION, SaveTooNewError, serializeSave } from './save';

const now = (): Date => new Date('2026-11-15T12:00:00.000Z');
const newGame = (): Game =>
  Game.newGame({ content: fixtureDb, seed: 1834, now }, { startZone: 'forest' });

describe('sha256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256Hex('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });

  it('hashes UTF-8 (Cyrillic, astral characters)', () => {
    expect(Array.from(utf8('Мрак'))).toEqual([208, 156, 209, 128, 208, 176, 208, 186]);
    expect(Array.from(utf8('😀'))).toEqual([240, 159, 152, 128]);
    expect(sha256Hex('Мрак')).not.toBe(sha256Hex('Mrak'));
  });
});

describe('sealed saves', () => {
  it('round-trips and detects any changed byte', () => {
    const sealed = sealSave(newGame().save());
    expect(verifySealed(sealed)).toBe(true);
    expect(openSealed(sealed).save.version).toBe(SAVE_VERSION);
    const flipped = { ...sealed, data: sealed.data.replace('"playtimeMs":0', '"playtimeMs":1') };
    expect(flipped.data).not.toBe(sealed.data);
    expect(() => openSealed(flipped)).toThrow(SaveCorruptError);
    expect(() => openSealed({ ...sealed, data: sealed.data.slice(0, -10) })).toThrow(
      SaveCorruptError,
    );
  });

  it('reports a valid checksum over invalid content as corrupt, newer versions as too new', () => {
    const garbage = '{"version":2,"nope":true}';
    expect(() => openSealed({ data: garbage, checksum: sha256Hex(garbage) })).toThrow(
      SaveCorruptError,
    );
    const future = '{"version":999}';
    expect(() => openSealed({ data: future, checksum: sha256Hex(future) })).toThrow(
      SaveTooNewError,
    );
  });
});

describe('export files', () => {
  it('export → import gives the same save', () => {
    const game = newGame();
    game.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'a' }] });
    const sealed = sealSave(game.save());
    const file = packExport(sealed, now());
    const { save, sealed: again, migratedFrom } = unpackExport(file);
    expect(migratedFrom).toBeNull();
    expect(again).toEqual(sealed);
    expect(Game.load(save, { content: fixtureDb, now }).snapshot()).toEqual(game.snapshot());
  });

  it('rejects tampered, foreign and oversized files', () => {
    const file = packExport(sealSave(newGame().save()), now());
    const envelope = JSON.parse(file) as { save: string };
    const tampered = JSON.stringify({
      ...envelope,
      save: envelope.save.replace('"flags":{}', '"flags":{"a":true}'),
    });
    expect(tampered).not.toBe(file);
    expect(() => unpackExport(tampered)).toThrow(SaveCorruptError);
    expect(() => unpackExport('{"hello":1}')).toThrow(/not a MRAK save file/);
    expect(() => unpackExport('not json')).toThrow(SaveCorruptError);
    expect(() => unpackExport(' '.repeat(5 * 1024 * 1024))).toThrow(/too large/);
  });
});

describe('migration v2 → v3', () => {
  it('adds the generation from the saved stats', () => {
    const v3 = newGame().save();
    const { generation: _drop, ...metaV2 } = v3.meta;
    const v2 = {
      ...v3,
      version: 2,
      meta: metaV2,
      state: { ...v3.state, stats: { ...v3.state.stats, generation: 3 } },
    };
    const { save, migratedFrom } = migrateSave(JSON.parse(JSON.stringify(v2)));
    expect(migratedFrom).toBe(2);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.meta.generation).toBe(3);
    const noStat = { ...v2, state: v3.state };
    expect(migrateSave(JSON.parse(JSON.stringify(noStat))).save.meta.generation).toBe(1);
  });

  it('v3 → v4 adds the lantern, noise and per-zone exploration', () => {
    const v4 = newGame().save();
    const { light: _l, explorer: _e, ...stateV3 } = v4.state;
    const zones = Object.fromEntries(
      Object.entries(v4.state.zones).map(([id, z]) => [
        id,
        { variant: z.variant, discovered: z.discovered, visits: z.visits },
      ]),
    );
    const v3 = { ...v4, version: 3, state: { ...stateV3, zones } };
    const { save, migratedFrom } = migrateSave(JSON.parse(JSON.stringify(v3)));
    expect(migratedFrom).toBe(3);
    expect(save.state.light).toEqual({
      lantern: null,
      lit: false,
      fuel: 0,
      inDarkness: false,
      darkMinutes: 0,
    });
    expect(save.state.explorer).toEqual({ noise: 0 });
    for (const zone of Object.values(save.state.zones))
      expect(zone).toMatchObject({ explored: '', pois: [], used: [] });
  });

  it('new saves carry the generation and stay byte-stable', () => {
    const save = newGame().save();
    expect(save.meta.generation).toBe(1);
    expect(serializeSave(migrateSave(JSON.parse(serializeSave(save))).save)).toBe(
      serializeSave(save),
    );
  });
});

describe('autosave policy', () => {
  const at = { day: 1, minute: 0 };

  it('triggers on dawn, dusk, zone change and decisions', () => {
    for (const [e, reason] of [
      [event('time/dawn', at), 'dawn'],
      [event('time/duskReached', at), 'dusk'],
      [event('world/zoneEntered', { zone: 'forest', firstVisit: false }), 'zone'],
      [event('state/decisionRecorded', { id: 'x', choice: 'y', at }), 'decision'],
    ] as const) {
      const policy = new AutosavePolicy();
      expect(policy.observe([e], 0)).toBe(reason);
      expect(policy.take(0)).toBe(reason);
      expect(policy.take(0)).toBeNull();
    }
    expect(new AutosavePolicy().observe([event('state/flagSet', { flag: 'a' })], 0)).toBeNull();
  });

  it('coalesces triggers of one tick into the most important reason', () => {
    const policy = new AutosavePolicy();
    policy.request('ritual');
    policy.observe(
      [event('world/zoneEntered', { zone: 'forest', firstVisit: true }), event('time/dawn', at)],
      0,
    );
    expect(policy.take(0)).toBe('ritual');
  });

  it('saves every 5 minutes of playtime, counted from the last save of any kind', () => {
    const policy = new AutosavePolicy(1000);
    expect(policy.observe([], 1000 + AUTOSAVE_INTERVAL_MS - 1)).toBeNull();
    expect(policy.observe([], 1000 + AUTOSAVE_INTERVAL_MS)).toBe('interval');
    policy.take(1000 + AUTOSAVE_INTERVAL_MS);
    policy.noteSaved(1000 + AUTOSAVE_INTERVAL_MS + 60_000);
    expect(policy.observe([], 1000 + 2 * AUTOSAVE_INTERVAL_MS)).toBeNull();
    expect(policy.observe([], 1000 + 2 * AUTOSAVE_INTERVAL_MS + 60_000)).toBe('interval');
  });

  it('allows manual saves by day only', () => {
    const day = julianToJdn({ year: 1834, month: 12, day: 25 });
    expect(
      canManualSave({ clock: { day, minute: 12 * 60, subMinute: 0, speed: 1, paused: false } }),
    ).toBe(true);
    expect(
      canManualSave({ clock: { day, minute: 23 * 60, subMinute: 0, speed: 1, paused: false } }),
    ).toBe(false);
    expect(
      canManualSave({ clock: { day, minute: 2 * 60, subMinute: 0, speed: 1, paused: false } }),
    ).toBe(false);
  });
});
