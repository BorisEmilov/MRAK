/**
 * Autosave policy (docs/systems/save-system.md): decides WHEN to autosave from core events and
 * playtime. Pure — the app layer performs the write.
 */
import type { CoreEvent } from '../events';
import type { WorldState } from '../state/world-state';
import { dayPhaseAt, jdnToJulian } from '../time/calendar';

export const AUTOSAVE_REASONS = [
  'dawn',
  'dusk',
  'zone',
  'decision',
  'ritual',
  'interval',
  'suspend',
] as const;
export type AutosaveReason = (typeof AUTOSAVE_REASONS)[number];

/** Autosave every this much playtime even if nothing else triggered one. */
export const AUTOSAVE_INTERVAL_MS = 5 * 60_000;

/** Higher wins when several triggers fire in the same tick (it labels the save). */
const PRIORITY: Readonly<Record<AutosaveReason, number>> = {
  interval: 0,
  zone: 1,
  decision: 2,
  dusk: 3,
  dawn: 4,
  ritual: 5,
  suspend: 6,
};

function reasonOf(event: CoreEvent): AutosaveReason | null {
  switch (event.type) {
    case 'time/dawn':
      return 'dawn';
    case 'time/duskReached':
      return 'dusk';
    case 'world/zoneEntered':
      return 'zone';
    case 'state/decisionRecorded':
      return 'decision';
    default:
      return null;
  }
}

export class AutosavePolicy {
  private lastSavedPlaytime: number;
  private pending: AutosaveReason | null = null;

  constructor(playtimeMs = 0) {
    this.lastSavedPlaytime = playtimeMs;
  }

  /** Feeds the events of one tick/command. Returns the pending reason, if any. */
  observe(events: readonly CoreEvent[], playtimeMs: number): AutosaveReason | null {
    for (const e of events) {
      const reason = reasonOf(e);
      if (reason) this.request(reason);
    }
    if (playtimeMs - this.lastSavedPlaytime >= AUTOSAVE_INTERVAL_MS) this.request('interval');
    return this.pending;
  }

  /** Explicit checkpoint (e.g. before a ritual or exorcism, or when the page is hidden). */
  request(reason: AutosaveReason): void {
    if (this.pending === null || PRIORITY[reason] > PRIORITY[this.pending]) this.pending = reason;
  }

  get pendingReason(): AutosaveReason | null {
    return this.pending;
  }

  /** Takes the pending reason (the caller is about to save). */
  take(playtimeMs: number): AutosaveReason | null {
    const reason = this.pending;
    this.pending = null;
    if (reason) this.lastSavedPlaytime = playtimeMs;
    return reason;
  }

  /** Any save (manual, quick) also resets the interval. */
  noteSaved(playtimeMs: number): void {
    this.lastSavedPlaytime = playtimeMs;
  }
}

/**
 * Manual and quick saves are allowed only by day (dawn and day phases): no save-scumming nights.
 * Autosaves are always allowed.
 */
export function canManualSave(state: Pick<WorldState, 'clock'>): boolean {
  const { month } = jdnToJulian(state.clock.day);
  const phase = dayPhaseAt(state.clock.minute, month);
  return phase === 'dawn' || phase === 'day';
}
