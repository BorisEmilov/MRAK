/**
 * React-facing store (Zustand). Updated by the GameHost at a limited rate (snapshots, batched core
 * events) and by discrete UI signals — never once per frame.
 */
import type { Hint } from '@mrak/content-schema';
import {
  emptyProfile,
  type AutosaveReason,
  type CheckResult,
  type CoreEvent,
  type Profile,
  type Snapshot,
} from '@mrak/core';
import type { Interaction } from '../events/EventBus';
import type { MapSketch } from '../game/world/zone-map';
import type { Notice } from '../ui/hud/notices';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PersistenceState } from '../storage/persistence';
import type { SaveEntry } from '../storage/save-store';
import type { AccountUser } from '@mrak/api-client';
import type { CloudSnapshot } from '../storage/cloud-sync';
import { DEFAULT_OPTIONS, type Options } from '../storage/options';

export type Screen = 'booting' | 'loading' | 'menu' | 'playing' | 'error';
export type MenuPanel =
  'main' | 'new-game' | 'load' | 'options' | 'achievements' | 'account' | 'credits';
export type ErrorKind = 'webgl' | 'load' | 'content' | 'crash';
/** Tabs of the belongings panel (docs/systems/inventory.md, collection.md). */
export type BelongingsTab = 'pack' | 'store' | 'mortar' | 'cabinet' | 'collection' | 'album';
/** Tabs of the character panel (docs/systems/progression.md, UI 13–14). */
export type CharacterTab = 'sheet' | 'talents' | 'gear' | 'debt';
/** Tabs of the journal (docs/systems/progression.md J1). */
export type JournalTab =
  'clues' | 'demons' | 'bestiary' | 'recipes' | 'people' | 'quests' | 'revelation' | 'notes';

export interface UiState {
  screen: Screen;
  menuPanel: MenuPanel;
  loadProgress: number;
  error: { kind: ErrorKind; detail?: string } | null;
  /** Latest core snapshot (throttled). */
  snapshot: Snapshot | null;
  /** Last core events (newest last), for HUD notices and the debug console. */
  recentEvents: readonly CoreEvent[];
  paused: boolean;
  pauseMenuOpen: boolean;
  audioLocked: boolean;
  zoneLoading: boolean;
  /** Saves shown on the load screen, newest first. */
  saves: readonly SaveEntry[];
  /** False when saves live only in memory (no IndexedDB). */
  savesPersistent: boolean;
  /** Whether the browser promised not to evict our storage. */
  storagePersistence: PersistenceState;
  /** Last save write, for the save indicator (null autosave reason = manual/quick). */
  saveActivity: {
    state: 'saving' | 'saved' | 'failed' | 'refused';
    reason: AutosaveReason | null;
  } | null;
  options: Options;
  debugOpen: boolean;
  /** Glossary modal (any screen); `term` scrolls to an entry. */
  glossary: { open: boolean; term?: string | undefined };
  /** Hint currently shown (onboarding). */
  hint: Hint | null;
  /** Village notices for the HUD (newest last). */
  notices: readonly Notice[];
  /** What the guardian can interact with right now. */
  interaction: Interaction | null;
  /** Bumped by the show-HUD key: wakes a faded HUD. */
  hudWake: number;
  /** Frames per second measured by Phaser (debug console only). */
  fps: number;
  /** Player map (M). */
  mapOpen: boolean;
  /** Village management panel (V). */
  villageOpen: boolean;
  /** Belongings panel and its tab (I, J, the house door), or null when closed. */
  belongings: BelongingsTab | null;
  /** Character panel and its tab (C, the HUD button), or null when closed. */
  character: CharacterTab | null;
  /** Journal and its tab (J), or null when closed. */
  journal: JournalTab | null;
  /** Villager the guardian is talking to (tone choice), or null. */
  talking: string | null;
  /** Mystery whose deduction board is open, or null. */
  board: string | null;
  /** Pact offered at a crossroads, or null. */
  pact: string | null;
  /** Ink conversation open: its story and the villager speaking (null: a place). */
  dialogue: { story: string; villager: string | null } | null;
  /** Last check rolled, shown by the check result overlay until dismissed. */
  lastCheck: CheckResult | null;
  /** Terrain and POI positions of the current zone, published by the World scene on load. */
  mapSketch: MapSketch | null;
  /** Guardian position in tiles (updated while the map is open). */
  mapGuardian: { x: number; y: number } | null;
  /** Debug console: extra lights added around the guardian (60 fps check). */
  debugLights: number;
  /** Bloodline Tree progress (account level, outside the save). */
  profile: Profile;
  /** Signed-in account (null: guest). */
  account: AccountUser | null;
  /** Cloud save sync (docs/systems/save-system.md → Cloud). */
  cloud: CloudSnapshot;
  /** Account invitation card (end of the prologue, first achievement). */
  accountInvite: 'prologue' | 'achievement' | null;
  /** The demo-end card (docs/systems/store.md). */
  demoEnd: boolean;
  /** The paid full pack is loaded (bundled demo + downloaded full content). */
  fullGame: boolean;
  /** After signing in with local progress: offer to upload it. */
  migrationOffer: boolean;
  /** The save conflict dialog. */
  conflictOpen: boolean;
  /** Email link opened in the game (verify / reset), handled by the account panel. */
  accountLink: { kind: 'verify' | 'reset'; token: string } | null;
}

export type UiStore = StoreApi<UiState>;

export const RECENT_EVENTS_LIMIT = 50;

export function createUiStore(options: Options = DEFAULT_OPTIONS): UiStore {
  return createStore<UiState>()(() => ({
    screen: 'booting',
    menuPanel: 'main',
    loadProgress: 0,
    error: null,
    snapshot: null,
    recentEvents: [],
    paused: false,
    pauseMenuOpen: false,
    audioLocked: true,
    zoneLoading: false,
    saves: [],
    savesPersistent: true,
    storagePersistence: 'unknown',
    saveActivity: null,
    options,
    debugOpen: false,
    glossary: { open: false },
    hint: null,
    notices: [],
    interaction: null,
    hudWake: 0,
    fps: 0,
    mapOpen: false,
    villageOpen: false,
    belongings: null,
    character: null,
    journal: null,
    board: null,
    talking: null,
    pact: null,
    lastCheck: null,
    dialogue: null,
    mapSketch: null,
    mapGuardian: null,
    debugLights: 0,
    profile: emptyProfile(),
    account: null,
    cloud: { status: 'disabled', conflicts: [], remote: [] },
    accountInvite: null,
    demoEnd: false,
    fullGame: false,
    migrationOffer: false,
    conflictOpen: false,
    accountLink: null,
  }));
}

/** A panel or dialog over the world is open (the world waits, menus take the gamepad). */
export function panelOpen(s: UiState): boolean {
  return (
    s.pauseMenuOpen ||
    s.mapOpen ||
    s.villageOpen ||
    s.belongings !== null ||
    s.character !== null ||
    s.journal !== null ||
    s.board !== null ||
    s.talking !== null ||
    s.dialogue !== null ||
    s.pact !== null
  );
}
