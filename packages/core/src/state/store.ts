import type { CoreEvent } from '../events';
import { deepFreeze, type Snapshot, type WorldState } from './world-state';

export type StoreListener = (snapshot: Snapshot, events: readonly CoreEvent[]) => void;

/**
 * Holds the current immutable snapshot. Every change is a commit of a new state object
 * (structural sharing allowed); listeners are notified once per commit with its events.
 */
export class WorldStore {
  private current: Snapshot;
  private readonly listeners = new Set<StoreListener>();

  constructor(initial: WorldState) {
    this.current = deepFreeze<Snapshot>(initial);
  }

  get snapshot(): Snapshot {
    return this.current;
  }

  commit(next: WorldState | Snapshot, events: readonly CoreEvent[] = []): void {
    this.current = deepFreeze<Snapshot>(next);
    for (const listener of [...this.listeners]) listener(this.current, events);
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
