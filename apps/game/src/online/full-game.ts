/**
 * Full game on the web (docs/systems/store.md): the demo-end card, the download of the paid full
 * pack (signed URL from the API, SHA-256 and size checked, strict schema) and its local cache.
 * The pack is the player's purchase: it is kept on this device and dropped when the account no
 * longer holds the entitlement (refund, chargeback).
 */
import type { StoreClient } from '@mrak/api-client';
import { FullContentPack } from '@mrak/content-schema';
import type { CoreEvent } from '@mrak/core';
import { openDB } from 'idb';
import type { GameHost } from '../host/GameHost';
import type { UiStore } from '../state/ui-store';

const DB = 'mrak-full';
const STORE = 'pack';
const KEY = 'current';
/** Larger than the real pack with room to grow; anything bigger is refused. */
export const MAX_FULL_PACK_BYTES = 8 * 1024 * 1024;

const db = () =>
  openDB(DB, 1, {
    upgrade(d) {
      d.createObjectStore(STORE);
    },
  });

export async function loadCachedFullPack(): Promise<FullContentPack | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const parsed = FullContentPack.safeParse(await (await db()).get(STORE, KEY));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function forgetFullPack(): Promise<void> {
  try {
    await (await db()).delete(STORE, KEY);
  } catch {
    // nothing cached
  }
}

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Downloads, verifies and caches the full pack. Throws when anything does not match. */
export async function downloadFullPack(
  client: StoreClient,
  fetchFn: typeof fetch = fetch,
): Promise<FullContentPack> {
  const ticket = await client.fullPack();
  if (ticket.bytes > MAX_FULL_PACK_BYTES) throw new Error('full pack too large');
  const res = await fetchFn(ticket.url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`full pack download failed (${String(res.status)})`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== ticket.bytes) throw new Error('full pack size mismatch');
  if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== ticket.sha256)
    throw new Error('full pack hash mismatch');
  const pack = FullContentPack.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (typeof indexedDB !== 'undefined') await (await db()).put(STORE, pack, KEY);
  return pack;
}

/**
 * Shows the demo-end card once the demo's last night is survived (progression-rules `demo`),
 * unless the full pack is loaded.
 */
export function wireDemoEnd(host: GameHost, store: UiStore, nights: number | null): void {
  if (nights === null || store.getState().fullGame) return;
  host.subscribeEvents((events: readonly CoreEvent[]) => {
    for (const e of events)
      if (
        e.type === 'state/statChanged' &&
        e.payload.stat === 'nights-survived' &&
        e.payload.villager === undefined &&
        e.payload.to >= nights &&
        e.payload.from < nights
      ) {
        void host.checkpoint('dawn');
        store.setState({ demoEnd: true });
      }
  });
}

/** Signed in without the full-game entitlement: the cached pack goes (refund or chargeback). */
export async function checkFullGameEntitlement(client: StoreClient): Promise<boolean> {
  // Both skus (full-game, collector) include the full game.
  const owns = (await client.entitlements()).some((e) => e.status === 'active');
  if (!owns) await forgetFullPack();
  return owns;
}
