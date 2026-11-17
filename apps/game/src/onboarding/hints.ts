/**
 * Onboarding hints (docs/systems/onboarding.md): maps core events to triggers and keeps the queue.
 * Pure: the controller feeds it and stores the result.
 */
import type { Condition, Hint, HintTrigger } from '@mrak/content-schema';
import type { CoreEvent } from '@mrak/core';

export const MAX_QUEUED_HINTS = 3;
export const LOW_SANITY_RATIO = 0.4;

/** Triggers raised by a batch of core events. `sanityMax` reads the current maximum. */
export function triggersOf(
  events: readonly CoreEvent[],
  sanityMax: () => number,
): Set<HintTrigger> {
  const out = new Set<HintTrigger>();
  for (const e of events) {
    if (e.type === 'world/zoneEntered') out.add('zone-entered');
    else if (e.type === 'time/nightStarted') out.add('night-started');
    else if (e.type === 'time/dawn') out.add('dawn');
    else if (e.type === 'state/decisionRecorded') out.add('decision-recorded');
    else if (e.type === 'inventory/itemAdded') out.add('item-added');
    else if (e.type === 'state/statChanged') {
      out.add('stat-changed');
      const max = sanityMax();
      if (
        e.payload.stat === 'sanity' &&
        max > 0 &&
        e.payload.to < max * LOW_SANITY_RATIO &&
        e.payload.from >= max * LOW_SANITY_RATIO
      )
        out.add('low-sanity');
    }
  }
  return out;
}

export class HintQueue {
  private queue: Hint[] = [];
  private shown: Hint | null = null;
  private readonly seen: Set<string>;

  constructor(
    private readonly hints: readonly Hint[],
    seen: Iterable<string>,
  ) {
    this.seen = new Set(seen);
  }

  get current(): Hint | null {
    return this.shown;
  }

  get seenIds(): string[] {
    return [...this.seen];
  }

  /**
   * Queues every unseen hint for the trigger whose condition holds. Does not show anything: call
   * `next()` once all triggers of the moment are in, so the most important hint wins.
   */
  enqueue(trigger: HintTrigger, check: (c: Condition) => boolean): void {
    for (const hint of this.hints) {
      if (hint.on !== trigger || this.seen.has(hint.id)) continue;
      if (this.shown?.id === hint.id || this.queue.some((h) => h.id === hint.id)) continue;
      if (hint.when && !check(hint.when)) continue;
      this.queue.push(hint);
    }
    this.queue.sort((a, b) => b.priority - a.priority);
    this.queue = this.queue.slice(0, MAX_QUEUED_HINTS);
  }

  /** Shows the most important queued hint if none is showing. */
  next(): Hint | null {
    if (!this.shown) this.advance();
    return this.shown;
  }

  /** enqueue + next, for a single trigger. */
  trigger(trigger: HintTrigger, check: (c: Condition) => boolean): Hint | null {
    this.enqueue(trigger, check);
    return this.next();
  }

  /** Marks the current hint as seen and shows the next one. */
  dismiss(): Hint | null {
    if (this.shown) this.seen.add(this.shown.id);
    this.shown = null;
    this.advance();
    return this.shown;
  }

  /** Drops everything queued (hints turned off). */
  clear(): void {
    this.queue = [];
    this.shown = null;
  }

  private advance(): void {
    this.shown = this.queue.shift() ?? null;
  }
}
