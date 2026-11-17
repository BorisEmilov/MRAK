/**
 * Wires onboarding and HUD notices to the host and the UI bus: core events → hint triggers and
 * village notices in the UI store.
 */
import type { LocaleKey } from '@mrak/content';
import type { TypedEventBus } from '../events/EventBus';
import type { GameHost } from '../host/GameHost';
import { t } from '../i18n/t';
import type { UiStore } from '../state/ui-store';
import { updateOptions } from '../storage/update-options';
import {
  dawnRevelation,
  holdUntilDawn,
  makeNotice,
  mergeNotices,
  noticesFrom,
  type Notice,
} from '../ui/hud/notices';
import { isNight } from '@mrak/core';
import { HintQueue, triggersOf } from './hints';

export interface Presentation {
  dismissHint: () => void;
  disableHints: () => void;
  resetHints: () => void;
  dispose: () => void;
}

export function wirePresentation(host: GameHost, bus: TypedEventBus, store: UiStore): Presentation {
  const hints = host.content.all('hints');
  let queue = new HintQueue(hints, store.getState().options.seenHints);
  const check = host.check.bind(host);
  const enabled = (): boolean => store.getState().options.hints;
  const show = (): void => {
    store.setState({ hint: queue.current });
  };
  // Triggers raised in the same task (e.g. entering the first zone and the game starting) are
  // collected first, so the most important hint is shown rather than the first one to arrive.
  let scheduled = false;
  const showSoon = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      queue.next();
      show();
    });
  };

  const sanityMax = (): number => {
    const s = host.snapshot();
    if (!s) return 0;
    return s.stats['sanity-max'] ?? host.content.statDecl('sanity-max').default;
  };

  // Revelation won at night is announced at dawn (progression.md R5).
  let held: Notice[] = [];
  let affordable = 0;
  const offEvents = host.subscribeEvents((events) => {
    const now = Date.now();
    const snapshot = host.snapshot();
    const night = snapshot !== null && isNight(snapshot);
    const fresh = noticesFrom(events, host.content, (k) => t(k as LocaleKey), now);
    const { show: shown, hold } = holdUntilDawn(fresh, night);
    held.push(...hold);
    const added = [...shown];
    if (events.some((e) => e.type === 'time/dawn')) {
      added.push(...dawnRevelation(held, now));
      held = [];
    }
    // A talent became affordable (once per change, never at night).
    if (events.some((e) => e.type.startsWith('revelation/') || e.type === 'talent/bought')) {
      const count = host.affordableTalents().length;
      if (count > affordable && !night)
        added.push(makeNotice('ui.talents', 'notice.talent-available', { count }, 'good', now));
      affordable = count;
    }
    const rolled = [...events].reverse().find((e) => e.type === 'check/resolved');
    if (rolled?.type === 'check/resolved') store.setState({ lastCheck: rolled.payload });
    if (added.length > 0)
      store.setState({ notices: mergeNotices(store.getState().notices, added, now) });
    if (!enabled()) return;
    for (const trigger of triggersOf(events, sanityMax)) queue.enqueue(trigger, check);
    showSoon();
  });
  const offStarted = bus.on('host:gameStarted', () => {
    held = [];
    affordable = host.affordableTalents().length;
    store.setState({ notices: [], interaction: null });
    if (enabled()) queue.enqueue('game-started', check);
    showSoon();
  });
  const offEnded = bus.on('host:gameEnded', () => {
    queue.clear();
    store.setState({ hint: null, notices: [], interaction: null });
  });
  const offInteraction = bus.on('world:interaction', (interaction) => {
    store.setState({ interaction });
    if (interaction && enabled()) {
      queue.enqueue('interaction-available', check);
      showSoon();
    }
  });

  const offNotice = bus.on('world:notice', ({ key, icon, tone, params }) => {
    const now = Date.now();
    store.setState({
      notices: mergeNotices(
        store.getState().notices,
        [makeNotice(icon, key as LocaleKey, params ?? {}, tone, now)],
        now,
      ),
    });
  });

  const persistSeen = (): void => {
    updateOptions(store, { seenHints: queue.seenIds });
  };

  return {
    dismissHint: () => {
      queue.dismiss();
      persistSeen();
      show();
    },
    disableHints: () => {
      queue.dismiss();
      queue.clear();
      updateOptions(store, { hints: false, seenHints: queue.seenIds });
      show();
    },
    resetHints: () => {
      queue = new HintQueue(hints, []);
      updateOptions(store, { seenHints: [] });
      show();
    },
    dispose: () => {
      offEvents();
      offStarted();
      offEnded();
      offInteraction();
      offNotice();
    },
  };
}
