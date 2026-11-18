import 'fake-indexeddb/auto';
import {
  ApiError,
  createAccountClient,
  type CloudSave,
  type CloudSaveInfo,
  type CloudSlot,
  type SavesClient,
} from '@mrak/api-client';
import { sha256Hex, type SealedSave } from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { emptyProfile } from '@mrak/core';
import { entriesOfProfile } from './account-sync';
import { HttpCloudSync, IdbSyncState, MemorySyncState } from './cloud-sync';
import { MemoryBackend, SaveStore, type SaveEntryInput, type SlotId } from './save-store';

/** An online-api double with the real semantics: versions, If-Match, 412 with `current`. */
function cloudServer() {
  const rows = new Map<CloudSlot, CloudSave>();
  const state = { online: true, signedIn: true, rateLimited: 0, calls: 0 };
  const info = ({ data: _d, ...rest }: CloudSave): CloudSaveInfo => rest;
  const client: SavesClient = {
    signedIn: () => state.signedIn,
    list: () => Promise.resolve([...rows.values()].map(info)),
    get: (slot) => {
      const r = rows.get(slot);
      return r ? Promise.resolve(r) : Promise.reject(new ApiError(404, 'not_found'));
    },
    put: (slot, save, base) => {
      state.calls += 1;
      if (!state.online) return Promise.reject(new ApiError(0, 'network'));
      if (state.rateLimited > 0) {
        state.rateLimited -= 1;
        return Promise.reject(new ApiError(429, 'too_many_requests', 42));
      }
      const current = rows.get(slot) ?? null;
      if ((current?.version ?? null) !== base)
        return Promise.reject(
          new ApiError(412, 'conflict', undefined, { current: current && info(current) }),
        );
      const row: CloudSave = {
        slot,
        version: (current?.version ?? 0) + 1,
        checksum: save.checksum,
        bytes: save.data.length,
        meta: save.meta,
        data: save.data,
        updatedAt: new Date().toISOString(),
      };
      rows.set(slot, row);
      return Promise.resolve(info(row));
    },
    remove: () => Promise.resolve(),
  };
  return { rows, state, client };
}

function sealed(n: number): SealedSave {
  const data = JSON.stringify({ format: 'mrak-save', version: 3, n });
  return { data, checksum: sha256Hex(data) };
}
const input = (slot: SlotId, minute: number): SaveEntryInput => ({
  slot,
  reason: slot === 'auto' ? 'dawn' : null,
  savedAt: new Date(2026, 10, 17, 12, minute).toISOString(),
  gameDate: { year: 1834, month: 12, day: 25, minute },
  zone: 'village',
  generation: 1,
  playtimeMs: minute * 60_000,
  contentVersion: 'demo',
  thumbnail: null,
});

/** A browser: its own IndexedDB-like store and sync state, signed in to the same account. */
async function device(
  client: SavesClient,
  schedule: (fn: () => void, ms: number) => unknown = () => 0,
) {
  const sync = new HttpCloudSync({
    client,
    state: new MemorySyncState(),
    userId: () => 'user-1',
    schedule,
    random: () => 0.5,
  });
  const store = await SaveStore.open(new MemoryBackend(), { cloud: sync });
  sync.attach(store);
  return { sync, store };
}

describe('cloud saves, local first', () => {
  it('play in one browser, open another, sign in and continue', async () => {
    const server = cloudServer();
    const a = await device(server.client);
    const saved = await a.store.write(input('slot-1', 600), sealed(1));
    await a.sync.flush();
    expect(a.sync.status).toBe('synced');
    expect(server.rows.get('slot-1')?.checksum).toBe(saved.checksum);

    const b = await device(server.client);
    const remote = await b.sync.refreshRemote();
    expect(remote.map((r) => r.slot)).toEqual(['slot-1']);
    const r = await b.sync.download('slot-1');
    if (!('entry' in r)) throw new Error('expected a download');
    const loaded = await b.store.read(r.entry.id);
    expect(loaded.sealed).toEqual(sealed(1));
    expect(r.entry.gameDate).toEqual({ year: 1834, month: 12, day: 25, minute: 600 });
    // Continuing on B uploads on top of the same version, no conflict.
    await b.store.write(input('slot-1', 700), sealed(2));
    await b.sync.flush();
    expect(server.rows.get('slot-1')).toMatchObject({ version: 2, checksum: sealed(2).checksum });
  });

  it('works offline and syncs when the connection returns (queue survives a reload)', async () => {
    const server = cloudServer();
    server.state.online = false;
    const retries: { ms: number; fn: () => void }[] = [];
    const state = await IdbSyncState.open(`cloud-${String(Math.random())}`);
    const sync = new HttpCloudSync({
      client: server.client,
      state,
      userId: () => 'user-1',
      online: () => server.state.online,
      schedule: (fn, ms) => retries.push({ fn, ms }),
    });
    const store = await SaveStore.open(new MemoryBackend(), { cloud: sync });
    sync.attach(store);
    await store.write(input('auto', 100), sealed(1));
    await sync.flush();
    expect(sync.status).toBe('offline');
    expect(server.rows.size).toBe(0);
    expect((await state.pending()).map((p) => p.slot)).toEqual(['auto']);
    // The page reloads: a new engine over the same persistent queue.
    server.state.online = true;
    const after = new HttpCloudSync({ client: server.client, state, userId: () => 'user-1' });
    await after.flush();
    expect(server.rows.get('auto')?.checksum).toBe(sealed(1).checksum);
    expect(after.status).toBe('synced');
  });

  it('backs off with jitter on network errors and honours 429 Retry-After', async () => {
    const server = cloudServer();
    const retries: { ms: number; fn: () => void }[] = [];
    const d = await device(server.client, (fn, ms) => retries.push({ fn, ms }));
    server.state.rateLimited = 1;
    await d.store.write(input('slot-2', 1), sealed(1));
    await d.sync.flush();
    expect(retries.at(-1)?.ms).toBe(42_000);
    retries.at(-1)?.fn();
    await d.sync.flush();
    expect(server.rows.get('slot-2')).toBeDefined();

    server.state.online = false;
    await d.store.write(input('slot-2', 2), sealed(2));
    await d.sync.flush();
    // random() = 0.5 → factor 1.0 of the base backoff
    expect(retries.at(-1)?.ms).toBe(2000);
  });

  it('quick saves stay on the device', async () => {
    const server = cloudServer();
    const d = await device(server.client);
    await d.store.write(input('quick', 1), sealed(1));
    await d.sync.flush();
    expect(server.state.calls).toBe(0);
  });
});

describe('conflicts', () => {
  it('diverged saves are shown, nothing is overwritten until the player chooses', async () => {
    const server = cloudServer();
    const a = await device(server.client);
    const b = await device(server.client);
    await a.store.write(input('slot-3', 100), sealed(1));
    await a.sync.flush();
    await b.sync.download('slot-3');
    // Both continue from v1; B uploads first.
    await b.store.write(input('slot-3', 300), sealed(3));
    await b.sync.flush();
    const mine = await a.store.write(input('slot-3', 200), sealed(2));
    await a.sync.flush();
    expect(a.sync.status).toBe('conflict');
    const [conflict] = a.sync.snapshot().conflicts;
    expect(conflict?.local.checksum).toBe(mine.checksum);
    expect(conflict?.cloud?.meta.gameDate.minute).toBe(300);
    // Neither side changed.
    expect(server.rows.get('slot-3')?.checksum).toBe(sealed(3).checksum);
    expect((await a.store.read(mine.id)).sealed).toEqual(sealed(2));

    // Keep the cloud's: the local slot now holds B's save.
    const kept = await a.sync.resolve('slot-3', 'cloud');
    expect(kept && (await a.store.read(kept.id)).sealed).toEqual(sealed(3));
    expect(a.sync.status).toBe('synced');
  });

  it('keeping this device’s save replaces the cloud’s only after the choice', async () => {
    const server = cloudServer();
    const a = await device(server.client);
    const b = await device(server.client);
    await b.store.write(input('slot-1', 1), sealed(10));
    await b.sync.flush();
    await a.store.write(input('slot-1', 2), sealed(20));
    await a.sync.flush();
    expect(a.sync.status).toBe('conflict');
    await a.sync.resolve('slot-1', 'local');
    expect(server.rows.get('slot-1')).toMatchObject({ version: 2, checksum: sealed(20).checksum });
  });

  it('downloading into an occupied manual slot asks first', async () => {
    const server = cloudServer();
    const a = await device(server.client);
    const b = await device(server.client);
    await a.store.write(input('slot-2', 1), sealed(1));
    await a.sync.flush();
    const local = await b.store.write(input('slot-2', 9), sealed(9));
    const r = await b.sync.download('slot-2');
    expect('conflict' in r).toBe(true);
    expect((await b.store.read(local.id)).sealed).toEqual(sealed(9));
  });
});

describe('guest → account', () => {
  it('uploads every local slot; slots the account already has differently become choices', async () => {
    const server = cloudServer();
    server.state.signedIn = false;
    const guest = await device(server.client);
    await guest.store.write(input('slot-1', 1), sealed(1));
    await guest.store.write(input('slot-2', 2), sealed(2));
    await guest.store.write(input('auto', 3), sealed(3));
    await guest.sync.flush();
    expect(guest.sync.status).toBe('signed-out');
    expect(server.rows.size).toBe(0);

    // The account already holds another slot-2 from a different device.
    server.state.signedIn = true;
    const other = await device(server.client);
    await other.store.write(input('slot-2', 50), sealed(50));
    await other.sync.flush();

    expect(await guest.sync.uploadLocal()).toBe(3);
    expect(server.rows.get('slot-1')?.checksum).toBe(sealed(1).checksum);
    expect(server.rows.get('auto')?.checksum).toBe(sealed(3).checksum);
    expect(server.rows.get('slot-2')?.checksum).toBe(sealed(50).checksum);
    expect(guest.sync.snapshot().conflicts.map((c) => c.slot)).toEqual(['slot-2']);
  });

  it('turns the guest profile into idempotent account entries', () => {
    const profile = {
      ...emptyProfile(),
      achievements: [{ id: 'prologue', at: 5 }],
      nodes: ['light-keepers'],
      stats: { nights: 3, exorcisms: 0, routes: ['r'], endings: [] },
    };
    expect(entriesOfProfile(profile, 9)).toEqual([
      { kind: 'achievement', key: 'prologue', at: 5 },
      { kind: 'node', key: 'light-keepers', at: 9 },
      { kind: 'route', key: 'r', at: 9 },
      { kind: 'stat', key: 'nights', value: 3, at: 9 },
    ]);
  });
});

describe('shared HTTP client', () => {
  function fakeApi() {
    const calls: string[] = [];
    let token = 'a1';
    let refreshOk = true;
    const issued = (t: string) =>
      new Response(
        JSON.stringify({
          accessToken: t,
          expiresIn: 600,
          user: { id: 'u', email: 'e', emailVerified: true, displayName: null, createdAt: '' },
        }),
        { status: 200 },
      );
    const fetch = ((url: string, init?: RequestInit) => {
      const path = url.replace('https://api', '');
      calls.push(path);
      if (path === '/v1/auth/refresh') {
        if (!refreshOk) return Promise.resolve(new Response('{}', { status: 401 }));
        token = `a${String(calls.length)}`;
        return new Promise<Response>((r) =>
          setTimeout(() => {
            r(issued(token));
          }, 5),
        );
      }
      const auth = (init?.headers as Record<string, string>)['Authorization'];
      return Promise.resolve(
        auth === `Bearer ${token}`
          ? new Response(JSON.stringify({ saves: [] }), { status: 200 })
          : new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
      );
    }) as typeof globalThis.fetch;
    return {
      calls,
      fetch,
      expire: () => {
        token = 'rotated';
      },
      breakRefresh: () => {
        refreshOk = false;
      },
    };
  }

  it('one refresh in flight for concurrent 401s, one retry each, clean sign-out if refresh fails', async () => {
    const api = fakeApi();
    const client = createAccountClient({ baseUrl: 'https://api', fetch: api.fetch });
    const changes: (string | null)[] = [];
    client.onChange((u) => changes.push(u?.id ?? null));
    await client.resume();
    expect(client.signedIn()).toBe(true);
    api.expire();
    api.calls.length = 0;
    await Promise.all([
      client.request('/v1/saves'),
      client.request('/v1/saves'),
      client.request('/v1/saves'),
    ]);
    expect(api.calls.filter((c) => c === '/v1/auth/refresh')).toHaveLength(1);
    expect(api.calls.filter((c) => c === '/v1/saves')).toHaveLength(6);

    api.expire();
    api.breakRefresh();
    await expect(client.request('/v1/saves')).rejects.toMatchObject({ status: 401 });
    expect(client.signedIn()).toBe(false);
    expect(client.accessToken()).toBeNull();
    expect(changes.at(-1)).toBeNull();
  });

  it('reports a network failure as status 0 (offline), not as a sign-out', async () => {
    const client = createAccountClient({
      baseUrl: 'https://api',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(client.login({ email: 'e', password: 'p' })).rejects.toMatchObject({
      status: 0,
      code: 'network',
    });
  });
});
