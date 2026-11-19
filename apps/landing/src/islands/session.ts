/**
 * Signed-in hint for the static pages (docs/ui/player-hub.md): display name and edition only,
 * never a token. The hub writes it after the session resumes and removes it on logout; the header
 * script reads it to show the player's navigation. A stale hint is harmless (the hub re-checks).
 */
export type Edition = 'demo' | 'full-game' | 'collector';

export interface PlayerHint {
  name: string | null;
  edition: Edition;
}

const KEY = 'mrak.player';
export const PLAYER_EVENT = 'mrak:player';

export function readPlayer(): PlayerHint | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PlayerHint> | null;
    if (!raw || typeof raw !== 'object') return null;
    const edition = ['demo', 'full-game', 'collector'].includes(String(raw.edition))
      ? (raw.edition as Edition)
      : 'demo';
    const name = typeof raw.name === 'string' ? raw.name.slice(0, 24) : null;
    return { name, edition };
  } catch {
    return null;
  }
}

export function writePlayer(hint: PlayerHint | null): void {
  try {
    if (hint) localStorage.setItem(KEY, JSON.stringify(hint));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the header simply stays in its visitor form
  }
  window.dispatchEvent(new Event(PLAYER_EVENT));
}
