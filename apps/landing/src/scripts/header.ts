/**
 * Visitor or player navigation (docs/ui/player-hub.md → Signed-in header). Both variants are in
 * the static HTML; this bundled module (no inline script, strict CSP) shows the right one.
 */
import { PLAYER_EVENT, readPlayer } from '../islands/session';

function apply(): void {
  const player = readPlayer();
  for (const el of document.querySelectorAll<HTMLElement>('[data-guest]')) el.hidden = !!player;
  for (const el of document.querySelectorAll<HTMLElement>('[data-player]')) el.hidden = !player;
  for (const el of document.querySelectorAll<HTMLElement>('[data-editions]'))
    el.hidden = !!player && player.edition !== 'demo';
  for (const el of document.querySelectorAll<HTMLElement>('[data-player-name]')) {
    const fallback = el.dataset['fallback'] ?? '';
    el.textContent = player?.name ?? fallback;
  }
}

apply();
window.addEventListener(PLAYER_EVENT, apply);
window.addEventListener('storage', apply);
