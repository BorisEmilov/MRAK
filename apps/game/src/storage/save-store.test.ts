import 'fake-indexeddb/auto';
import { sealSave, type SealedSave } from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { absorbEmergency, EMERGENCY_KEY, readEmergency, writeEmergency } from './emergency';
import { requestPersistence } from './persistence';
import {
  IdbBackend,
  MemoryBackend,
  SaveCorruptEntryError,
  SaveStore,
  type SaveBackend,
  type SaveEntryInput,
  type SlotId,
} from './save-store';

let dbCounter = 0;
let idCounter = 0;
const newId = (): string => `id-${String(++idCounter)}`;

function sealed(text: string): SealedSave {
  // Any text works for the store: it only checks the checksum.
  const fake = { format: 'test', text } as unknown as Parameters<typeof sealSave>[0];
  return sealSave(fake);
}

function input(slot: SlotId, minute: number, savedAt: string): SaveEntryInput {
  return {
    slot,
    reason: slot === 'auto' ? 'dawn' : null,
    savedAt,
    gameDate: { year: 1834, month: 12, day: 25, minute },
    zone: 'village',
    generation: 1,
    playtimeMs: minute * 1000,
    contentVersion: '0.1.0',
    thumbnail: null,
  };
}

const at = (n: number): string => `2026-11-16T10:${String(n).padStart(2, '0')}:00.000Z`;

const backends: [
  string,
  () => Promise<{ backend: SaveBackend; reopen: () => Promise<SaveBackend> }>,
][] = [
  [
    'memory',
    () => {
      const backend = new MemoryBackend();
      return Promise.resolve({ backend, reopen: () => Promise.resolve(backend) });
    },
  ],
  [
    'indexeddb',
    async () => {
      const name = `mrak-saves-test-${String(++dbCounter)}`;
      const backend = await IdbBackend.open(name);
      return {
        backend,
        reopen: async () => {
          backend.close();
          return IdbBackend.open(name);
        },
      };
    },
  ],
];

describe.each(backends)('SaveStore (%s)', (_name, make) => {
  it('writes, lists and reads with a verified checksum', async () => {
    const { backend } = await make();
    const store = await SaveStore.open(backend, { newId });
    const s = sealed('one');
    const entry = await store.write(input('slot-1', 10, at(1)), s);
    expect(entry.checksum).toBe(s.checksum);
    expect((await store.list()).map((e) => e.id)).toEqual([entry.id]);
    expect((await store.read(entry.id)).sealed).toEqual(s);
  });

  it('atomic write: a staged but uncommitted version is invisible and cleaned up on open', async () => {
    const { backend, reopen } = await make();
    const store = await SaveStore.open(backend, { newId });
    const committed = await store.write(input('slot-1', 10, at(1)), sealed('old'));
    // The tab closes between stage and commit.
    const staged = await store.stage(input('slot-1', 20, at(2)), sealed('new'));
    expect((await store.list()).map((e) => e.id)).toEqual([committed.id]);
    expect((await store.read(committed.id)).sealed.data).toContain('old');

    const again = await SaveStore.open(await reopen(), { newId });
    expect((await again.list()).map((e) => e.id)).toEqual([committed.id]);
    expect(await again.entry(staged.id)).toBeNull();
    // Committing afterwards makes the new version current and keeps the old one as backup.
    const next = await again.write(input('slot-1', 30, at(3)), sealed('newer'));
    expect((await again.list()).map((e) => e.id)).toEqual([next.id]);
    expect(await again.entry(committed.id)).not.toBeNull();
  });

  it('keeps the 3 latest autosaves and one backup per manual slot', async () => {
    const { backend } = await make();
    const store = await SaveStore.open(backend, { newId });
    const autos = [];
    for (let i = 0; i < 5; i++)
      autos.push(await store.write(input('auto', i, at(i)), sealed(`a${String(i)}`)));
    const manual = [];
    for (let i = 0; i < 3; i++)
      manual.push(await store.write(input('slot-2', i, at(10 + i)), sealed(`m${String(i)}`)));
    const listed = (await store.list()).map((e) => e.id);
    expect(listed).toEqual([manual[2]?.id, autos[4]?.id, autos[3]?.id, autos[2]?.id]);
    expect(await store.entry(autos[1]?.id ?? '')).toBeNull();
    expect(await store.entry(manual[1]?.id ?? '')).not.toBeNull(); // backup
    expect(await store.entry(manual[0]?.id ?? '')).toBeNull();
    expect((await store.latest())?.id).toBe(manual[2]?.id);
  });

  it('detects corruption and offers the newest intact fallback', async () => {
    const { backend } = await make();
    const store = await SaveStore.open(backend, { newId });
    const older = await store.write(input('auto', 1, at(1)), sealed('older'));
    const newer = await store.write(input('auto', 2, at(2)), sealed('newer'));
    // Flip the stored bytes of the newest autosave behind the store's back.
    await backend.stage({ ...newer }, 'garbage');
    await expect(store.read(newer.id)).rejects.toThrow(SaveCorruptEntryError);
    expect((await store.fallbackFor(newer.id))?.id).toBe(older.id);
    // Manual slot: its own backup comes first.
    const m1 = await store.write(input('slot-3', 3, at(3)), sealed('m1'));
    const m2 = await store.write(input('slot-3', 4, at(4)), sealed('m2'));
    await backend.stage({ ...m2 }, 'garbage');
    expect((await store.fallbackFor(m2.id))?.id).toBe(m1.id);
    // Nothing intact left.
    await backend.stage({ ...older }, 'garbage');
    await backend.stage({ ...m1 }, 'garbage');
    expect(await store.fallbackFor(newer.id)).toBeNull();
  });

  it('removes a slot with all its versions', async () => {
    const { backend } = await make();
    const store = await SaveStore.open(backend, { newId });
    const a = await store.write(input('quick', 1, at(1)), sealed('q1'));
    await store.write(input('quick', 2, at(2)), sealed('q2'));
    await store.remove('quick');
    expect(await store.list()).toEqual([]);
    expect(await store.entry(a.id)).toBeNull();
  });
});

function fakeLocalStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    length: 0,
    clear: () => {
      map.clear();
    },
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe('emergency backup', () => {
  it('is absorbed into the autosave rotation when newer than every save', async () => {
    const local = fakeLocalStorage();
    const store = await SaveStore.open(new MemoryBackend(), { newId });
    await store.write(input('auto', 1, at(1)), sealed('before'));
    const backup = sealed('closing');
    expect(writeEmergency(local, input('auto', 99, at(5)), backup)).toBe(true);
    expect(await absorbEmergency(local, store)).toBe(true);
    const latest = await store.latest();
    expect(latest).toMatchObject({ slot: 'auto', reason: 'suspend', savedAt: at(5) });
    expect((await store.read(latest?.id ?? '')).sealed).toEqual(backup);
    expect(local.map.has(EMERGENCY_KEY)).toBe(false);
  });

  it('is discarded when older than the stored saves, or damaged', async () => {
    const local = fakeLocalStorage();
    const store = await SaveStore.open(new MemoryBackend(), { newId });
    await store.write(input('slot-1', 1, at(9)), sealed('later manual save'));
    writeEmergency(local, input('auto', 2, at(5)), sealed('stale'));
    expect(await absorbEmergency(local, store)).toBe(false);
    expect(local.map.has(EMERGENCY_KEY)).toBe(false);

    const bad = sealed('x');
    writeEmergency(local, input('auto', 3, at(30)), { ...bad, data: 'y' });
    expect(await absorbEmergency(local, store)).toBe(false);
    local.map.set(EMERGENCY_KEY, '{oops');
    expect(readEmergency(local)).toBeNull();
    expect((await store.list()).length).toBe(1);
  });

  it('never throws when storage is full or missing', () => {
    const full = fakeLocalStorage();
    full.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    expect(writeEmergency(full, input('auto', 1, at(1)), sealed('a'))).toBe(false);
    expect(writeEmergency(undefined, input('auto', 1, at(1)), sealed('a'))).toBe(false);
  });
});

describe('persistent storage', () => {
  it('reports granted, denied and unsupported', async () => {
    const api = (persisted: boolean, persist: boolean) => ({
      persisted: () => Promise.resolve(persisted),
      persist: () => Promise.resolve(persist),
    });
    expect(await requestPersistence(api(true, false))).toBe('granted');
    expect(await requestPersistence(api(false, true))).toBe('granted');
    expect(await requestPersistence(api(false, false))).toBe('denied');
    expect(await requestPersistence(undefined)).toBe('unsupported');
  });
});
