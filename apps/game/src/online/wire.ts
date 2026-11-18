/**
 * Online wiring (docs/systems/save-system.md → Cloud; ADR 0009): session state, background
 * sync triggers, the guest → account migration offer and the account invitations.
 */
import type { CoreEvent } from '@mrak/core';
import type { GameHost } from '../host/GameHost';
import type { OnlineServices } from '../state/context';
import type { UiStore } from '../state/ui-store';
import { entriesOfProfile } from '../storage/account-sync';

type KeyValue = Pick<Storage, 'getItem' | 'setItem'> | undefined;

const INVITE_KEY = 'mrak.account-invite.v1';
const migratedKey = (userId: string) => `mrak.migration.v1:${userId}`;

function read(storage: KeyValue, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(storage: KeyValue, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // storage blocked: the choice lasts this session
  }
}

/** "Don't show again" for the account invitation. */
export function neverInvite(storage: KeyValue): void {
  write(storage, INVITE_KEY, 'never');
}

/** Uploads this device's saves and progress to the signed-in account (nothing is lost). */
export async function migrateGuest(
  online: OnlineServices,
  host: GameHost,
  store: UiStore,
  storage: KeyValue,
): Promise<void> {
  const user = online.account.user();
  if (!user) return;
  await host.pullAccount(); // account → device first (union, earliest unlocks)
  await online.progress.record(entriesOfProfile(store.getState().profile, Date.now()));
  await online.saves.uploadLocal();
  write(storage, migratedKey(user.id), 'done');
  store.setState({ migrationOffer: false });
}

export function declineMigration(online: OnlineServices, store: UiStore, storage: KeyValue): void {
  const user = online.account.user();
  if (user) write(storage, migratedKey(user.id), 'declined');
  store.setState({ migrationOffer: false });
}

export function wireOnline(
  online: OnlineServices,
  host: GameHost,
  store: UiStore,
  storage: KeyValue,
): void {
  const { account, saves, progress } = online;
  saves.onChange((cloud) => {
    store.setState({ cloud });
  });

  account.onChange((user) => {
    const before = store.getState().account;
    store.setState({ account: user });
    if (!user) {
      saves.reset();
      return;
    }
    if (before?.id === user.id) return; // a token refresh, not a new sign-in
    void saves.flush();
    void progress.flush();
    void host.pullAccount();
    // Offer the upload once per account when this device has something to give.
    const hasLocal =
      store.getState().saves.length > 0 || store.getState().profile.achievements.length > 0;
    if (hasLocal && read(storage, migratedKey(user.id)) === null)
      store.setState({ migrationOffer: true, accountInvite: null });
  });

  const kick = (): void => {
    void saves.flush();
    void progress.flush();
  };
  window.addEventListener('online', kick);
  window.addEventListener('offline', kick);

  // Invitations: never while signed in, never after "don't show again", one at a time.
  host.subscribeEvents((events: readonly CoreEvent[]) => {
    if (store.getState().account || read(storage, INVITE_KEY) === 'never') return;
    if (store.getState().accountInvite) return;
    for (const e of events) {
      if (e.type === 'state/flagSet' && e.payload.flag === 'prologue-complete')
        store.setState({ accountInvite: 'prologue' });
      else if (
        e.type === 'achievement/unlocked' &&
        store.getState().profile.achievements.length === 1
      )
        store.setState({ accountInvite: 'achievement' });
    }
  });

  // Email links (/account/verify#token=…, /account/reset#token=…) open the account panel; the
  // token is removed from the address bar and history right away.
  const m = /^\/account\/(verify|reset)$/.exec(window.location.pathname);
  const token = /(?:^#|&)token=([\w-]{20,128})/.exec(window.location.hash)?.[1];
  if (m?.[1] && token) {
    store.setState({
      accountLink: { kind: m[1] as 'verify' | 'reset', token },
      menuPanel: 'account',
    });
    window.history.replaceState(null, '', '/');
  }

  store.setState({ cloud: saves.snapshot() });
  void account.resume().then(() => {
    kick();
  });
}
