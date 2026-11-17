/**
 * Acceptance (docs/systems/seasonal-events.md → Implementation): a signed live pack loads into an
 * existing save without breaking it; tampered packs are refused; the server's published seasons
 * activate the right event only when the client's content agrees with the date.
 */
import { Game } from '@mrak/core';
import type { ContentPackFile } from '@mrak/content-schema';
import { describe, expect, it } from 'vitest';
import { TypedEventBus } from '../events/EventBus';
import { createUiStore } from '../state/ui-store';
import { MemoryBackend, SaveStore } from '../storage/save-store';
import { loadContentDatabase } from './content';
import { GameHost } from './GameHost';
import { fetchPacks, verifyPack } from './packs';

const base = loadContentDatabase();

const pack: ContentPackFile = {
  packId: 'winter-tales',
  version: '1.0.0',
  collections: {
    mysteries: [
      {
        id: 'frozen-well',
        tier: 'demo',
        nameKey: 'pack.frozen-well.name',
        questionKey: 'pack.frozen-well.question',
        chapter: 'unclean-days',
        deadlineNight: 12,
        suspects: [
          { villager: 'krastyo', whyGuiltyKey: 'pack.frozen-well.guilty' },
          {
            villager: 'todor',
            whyGuiltyKey: 'pack.frozen-well.guilty',
            whyInnocentKey: 'pack.frozen-well.guilty',
          },
        ],
        causes: [{ id: 'frost-spirit', nameKey: 'pack.frozen-well.cause' }],
        remedies: [{ id: 'confront', nameKey: 'pack.frozen-well.remedy', action: 'confront' }],
        clues: [
          {
            id: 'frozen-well-tracks',
            nameKey: 'pack.frozen-well.clue',
            descKey: 'pack.frozen-well.clue',
            reliability: 'solid',
            sources: [{ kind: 'villager', ref: 'todor' }],
            supports: ['culprit:krastyo'],
          },
          {
            id: 'frozen-well-bucket',
            nameKey: 'pack.frozen-well.clue',
            descKey: 'pack.frozen-well.clue',
            reliability: 'solid',
            sources: [{ kind: 'zone', ref: 'village', poi: 'well' }],
            supports: ['culprit:krastyo', 'cause:frost-spirit'],
          },
          {
            id: 'frozen-well-alibi',
            nameKey: 'pack.frozen-well.clue',
            descKey: 'pack.frozen-well.clue',
            reliability: 'solid',
            sources: [{ kind: 'villager', ref: 'krastyo' }],
            refutes: ['culprit:todor'],
          },
        ],
        solution: { culprit: 'krastyo', cause: 'frost-spirit', remedy: 'confront' },
        outcomes: [
          {
            culprit: 'krastyo',
            descKey: 'pack.frozen-well.outcome',
            effects: [{ addStat: 'hysteria', value: -5 }],
          },
          {
            culprit: 'todor',
            descKey: 'pack.frozen-well.outcome',
            effects: [{ addStat: 'hysteria', value: 5 }],
          },
        ],
        unsolved: {
          descKey: 'pack.frozen-well.outcome',
          effects: [{ addStat: 'hysteria', value: 5 }],
        },
      },
    ],
    events: [
      {
        id: 'ice-cracks',
        tier: 'demo',
        nameKey: 'pack.ice-cracks.name',
        textKey: 'pack.ice-cracks.text',
        category: 'noise',
        weight: 10,
        cooldownMinutes: 60,
        tensionCost: 2,
      },
    ],
    talents: [
      {
        id: 'frost-sense',
        tier: 'demo',
        nameKey: 'pack.frost-sense.name',
        descKey: 'pack.frost-sense.desc',
        effects: [{ modifier: { fateDice: 1, skill: 'survival' } }],
      },
    ],
  },
  locales: {
    en: {
      'pack.frozen-well.name': 'The frozen well',
      'pack.frozen-well.question': 'Who froze the well?',
      'pack.frozen-well.guilty': 'They were seen at the well at night.',
      'pack.frozen-well.cause': 'A frost spirit',
      'pack.frozen-well.remedy': 'Confront them',
      'pack.frozen-well.clue': 'Tracks in the frost',
      'pack.frozen-well.outcome': 'The ice melts, or it does not.',
      'pack.ice-cracks.name': 'Ice cracks',
      'pack.ice-cracks.text': 'Somewhere under the snow, ice cracks like a bone.',
      'pack.frost-sense.name': 'Frost Sense',
      'pack.frost-sense.desc': 'One die more on Survival.',
    },
  },
};

async function signed(file: ContentPackFile) {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const bytes = new TextEncoder().encode(JSON.stringify(file)).buffer;
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, bytes));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  return {
    bytes,
    publicKey: b64(pub),
    entry: {
      packId: file.packId,
      version: file.version,
      path: 'packs/winter-tales-1.0.0.json',
      size: bytes.byteLength,
      sha256: [...hash].map((b) => b.toString(16).padStart(2, '0')).join(''),
      signature: b64(sig),
    },
  };
}

describe('live content packs', () => {
  it('a signed pack loads into an existing save without breaking it', async () => {
    // A chronicle played with the bundled content, then saved.
    const g = Game.newGame(
      { content: base, seed: 3 },
      { startMinute: 12 * 60, startZone: 'village' },
    );
    g.dispatch({ type: 'advanceTime', minutes: 6 * 60 });
    const save = g.save();

    const s = await signed(pack);
    const fetchFn = (url: string) =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () =>
          Promise.resolve(
            url.endsWith('index.json')
              ? new TextEncoder().encode(JSON.stringify([s.entry])).buffer
              : s.bytes,
          ),
      });
    const packs = await fetchPacks('https://cdn.example', s.publicKey, fetchFn);
    expect(packs.map((p) => p.packId)).toEqual(['winter-tales']);
    const content = loadContentDatabase(packs);
    expect(content.has('mysteries', 'frozen-well')).toBe(true);
    expect(content.info.version).toContain('winter-tales@1.0.0');

    const loaded = Game.load(save, { content });
    expect(loaded.snapshot().clock).toEqual(g.snapshot().clock);
    expect(
      loaded.dispatch({ type: 'applyEffects', effects: [{ startMystery: 'frozen-well' }] }).ok,
    ).toBe(true);
    expect(loaded.dispatch({ type: 'triggerEvent', event: 'ice-cracks' }).ok).toBe(true);
    expect(loaded.dispatch({ type: 'advanceTime', minutes: 24 * 60 }).ok).toBe(true);
    expect(loaded.snapshot().mysteries['frozen-well']?.status).toBe('active');
    // And the save made with the pack loads again.
    expect(Game.load(loaded.save(), { content }).snapshot()).toEqual(loaded.snapshot());
  });

  it('refuses a tampered pack, a wrong key, or a pack that overwrites the game', async () => {
    const s = await signed(pack);
    const key = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(s.publicKey), (c) => c.charCodeAt(0)),
      'Ed25519',
      false,
      ['verify'],
    );
    expect(await verifyPack(s.bytes, s.entry, key)).not.toBeNull();
    const tampered = new Uint8Array(s.bytes.slice(0));
    tampered[10] = (tampered[10] ?? 0) ^ 1;
    expect(await verifyPack(tampered.buffer, s.entry, key)).toBeNull();
    const other = await signed(pack);
    expect(
      await verifyPack(s.bytes, { ...s.entry, signature: other.entry.signature }, key),
    ).toBeNull();
    // A pack redefining an existing locale key (or id) is dropped: the game stays as shipped.
    const hostile = { ...pack, locales: { en: { 'village.title': 'Owned' } } };
    expect(loadContentDatabase([hostile]).text('village.title')).not.toBe('Owned');
  });
});

describe('live seasons', () => {
  async function host(reply: unknown) {
    const store = createUiStore();
    const h = new GameHost({
      content: base,
      saves: await SaveStore.open(new MemoryBackend()),
      store,
      bus: new TypedEventBus(),
      seed: () => 7,
      seasons: () => Promise.resolve(reply),
    });
    h.newGame({ startMinute: 12 * 60 });
    await h.syncSeasons();
    return { h, store };
  }

  it('the server date activates the right event, once, with its rewards', async () => {
    const { h, store } = await host({ date: '2026-02-14', active: ['kukeri-season'] });
    expect(h.snapshot()?.seasonal.activated).toEqual(['kukeri-season@2026']);
    expect(store.getState().profile.legacy.available).toBe(5);
    expect(store.getState().profile.titles).toEqual(['seasonal-event.kukeri-season.title']);
    await h.syncSeasons();
    expect(store.getState().profile.legacy.available).toBe(5);
  });

  it('moving the server date to winter activates the Unclean Days instead', async () => {
    const { h } = await host({ date: '2026-12-28', active: ['unclean-days-watch'] });
    expect(h.snapshot()?.seasonal.activated).toEqual(['unclean-days-watch@2026']);
  });

  it('the client refuses what its content does not place on that date', async () => {
    const { h } = await host({ date: '2026-02-14', active: ['zadushnitsa-candles', 'no-such'] });
    expect(h.snapshot()?.seasonal.activated).toEqual([]);
  });
});
