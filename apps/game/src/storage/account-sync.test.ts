import 'fake-indexeddb/auto';
import { ApiError, type OnlineClient, type ProgressEntry } from '@mrak/api-client';
import { describe, expect, it } from 'vitest';
import { TypedEventBus } from '../events/EventBus';
import { GameHost } from '../host/GameHost';
import { loadContentDatabase } from '../host/content';
import { createUiStore } from '../state/ui-store';
import { AccountSync, IdbOutbox, MemoryOutbox, profileFromProgress } from './account-sync';
import { MemoryBackend, SaveStore } from './save-store';

const content = loadContentDatabase();

/** A fake online-api: idempotent like the real one; can be taken offline. */
function server() {
  const rows = new Map<string, ProgressEntry>();
  const state = { online: false, calls: 0 };
  const client: OnlineClient = {
    signedIn: () => true,
    recordProgress: (entries) => {
      state.calls += 1;
      if (!state.online) return Promise.reject(new TypeError('Failed to fetch'));
      for (const e of entries) rows.set(`${e.kind}:${e.key}`, e);
      return Promise.resolve({ recorded: [], rejected: [] });
    },
    listProgress: () => Promise.resolve([...rows.values()]),
  };
  return { rows, state, client };
}

describe('account progress sync (docs/systems/achievements.md)', () => {
  it('an achievement unlocked offline reaches the account on reconnecting', async () => {
    const api = server();
    const retries: (() => void)[] = [];
    const sync = new AccountSync({
      outbox: await IdbOutbox.open(`test-${String(Math.random())}`),
      client: api.client,
      schedule: (fn) => retries.push(fn),
    });
    await sync.record([{ kind: 'achievement', key: 'prologue', at: 1 }]);
    expect(api.rows.size).toBe(0);
    expect(retries).toHaveLength(1); // backoff scheduled, entry still in the outbox
    api.state.online = true;
    retries[0]?.();
    await sync.flush();
    expect([...api.rows.keys()]).toEqual(['achievement:prologue']);
    // Sending again (another flush, a duplicate record) never duplicates it.
    await sync.record([{ kind: 'achievement', key: 'prologue', at: 1 }]);
    expect(api.rows.size).toBe(1);
    const pulled = await sync.pull(content);
    expect(pulled?.achievements).toEqual([{ id: 'prologue', at: 1 }]);
  });

  it('keeps entries while signed out and drops a refused batch instead of blocking', async () => {
    const outbox = new MemoryOutbox();
    const signedOut = new AccountSync({ outbox, client: null });
    await signedOut.record([{ kind: 'stat', key: 'nights', value: 3, at: 1 }]);
    expect(await outbox.all()).toHaveLength(1);
    const refusing = new AccountSync({
      outbox,
      client: { ...server().client, recordProgress: () => Promise.reject(new ApiError(400)) },
    });
    await refusing.flush();
    expect(await outbox.all()).toEqual([]);
  });

  it('rebuilds Legacy from awards minus Bloodline costs', () => {
    const node = content.all('bloodline-nodes')[0];
    const p = profileFromProgress(
      [
        { kind: 'legacy', key: 'a@1', value: 20, at: 1 },
        { kind: 'node', key: node?.id ?? '', at: 2 },
      ],
      content,
    );
    expect(p.legacy).toEqual({ lifetime: 20, available: 20 - (node?.cost ?? 0) });
  });

  it('unlocking is account-level: deleting the save keeps the achievement', async () => {
    const store = createUiStore();
    const outbox = new MemoryOutbox();
    const saves = await SaveStore.open(new MemoryBackend());
    const host = new GameHost({
      content,
      saves,
      store,
      bus: new TypedEventBus(),
      seed: () => 1834,
      account: new AccountSync({ outbox, client: null }),
    });
    host.newGame();
    host.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'prologue-complete' }] });
    host.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'prologue-complete' }] });
    expect(store.getState().profile.achievements.map((a) => a.id)).toEqual(['prologue']);
    expect(await outbox.all()).toContainEqual(
      expect.objectContaining({ kind: 'achievement', key: 'prologue' }),
    );
    expect((await host.saveManual('slot-1')).ok).toBe(true);
    await saves.remove('slot-1');
    host.quitToMenu();
    expect(store.getState().profile.achievements.map((a) => a.id)).toEqual(['prologue']);
  });
});
