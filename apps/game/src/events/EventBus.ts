/**
 * UI EventBus: presentation signals between the Phaser layer, the React layer and the GameHost.
 * Game rules never travel here — they live in core (`Game.events`) and reach React through the
 * throttled store. One instance per app (created in main.tsx), never a module singleton.
 */
import type { IconName } from '@mrak/ui-kit';
export type InteractionAction =
  'talk' | 'gather' | 'pray' | 'ritual' | 'investigate' | 'use' | 'rest' | 'photograph' | 'house';

export interface Interaction {
  action: InteractionAction;
  /** Localization key of the target's name. */
  targetKey: string;
}

export interface Caption {
  kind: 'speech' | 'sound';
  /** Localization key of the line or of the sound description ("[Bell tolls]"). */
  textKey: string;
  /** Speech: localization key of the speaker's name. */
  speakerKey?: string;
  /** Sound: where it comes from on screen. */
  direction?: 'left' | 'right' | 'center';
  durationMs?: number;
}

export interface EventMap {
  /** Asset loading progress (0–1) for the loading screen. */
  'load:progress': { progress: number };
  /** Base assets loaded: the main menu can be shown. */
  'load:complete': Record<string, never>;
  'load:error': { file: string };
  /** A scene finished `create()`. */
  'scene:ready': { sceneKey: string };
  /** The World scene is fetching a zone's assets. */
  'world:zoneLoading': { zone: string; loading: boolean };
  /** GameHost started or loaded a game: Phaser should show the World. */
  'host:gameStarted': { zone: string };
  /** GameHost returned to the main menu: Phaser should show the backdrop. */
  'host:gameEnded': Record<string, never>;
  /** Phaser: the guardian can interact with something (null: nothing in reach). */
  'world:interaction': Interaction | null;
  /** Audio: a line or a sound to caption (subtitles / sound captions options). */
  'audio:caption': Caption;
  /** Phaser: a short message for the HUD notices (e.g. "No oil left"). */
  'world:notice': WorldNotice;
  /** React: take a photograph of whatever is nearest the guardian (photography.md). */
  'ui:photograph': Record<string, never>;
}

export interface WorldNotice {
  /** Localization key. */
  key: string;
  icon: IconName;
  tone: 'neutral' | 'bad' | 'good';
  /** Already-translated values for the key's placeholders. */
  params?: Record<string, string | number>;
}

export type EventName = keyof EventMap;
type Handler<K extends EventName> = (payload: EventMap[K]) => void;
type AnyHandler = (payload: EventMap[EventName]) => void;

export class TypedEventBus {
  // Type safety is enforced by the public on/off/emit signatures; internally
  // handlers are stored erased, keyed by event name.
  private readonly handlers = new Map<EventName, Set<AnyHandler>>();

  on<K extends EventName>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as AnyHandler);
    return () => {
      this.off(event, handler);
    };
  }

  off<K extends EventName>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as AnyHandler);
  }

  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) handler(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
