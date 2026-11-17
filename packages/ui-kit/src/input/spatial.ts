/** Spatial focus navigation for gamepads (D-pad / stick): pure geometry, DOM queries at the edge. */
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Picks the best candidate in a direction: it must lie in that half-plane; the score favours
 * distance along the axis and penalises sideways offset (×2). Returns an index or -1.
 */
export function pickInDirection(from: Rect, candidates: readonly Rect[], dir: Direction): number {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((r, i) => {
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    const side = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (along <= 1) return;
    const score = along + side * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable, visible elements inside the topmost modal (or the whole document). */
export function focusScope(doc: Document): HTMLElement[] {
  const modals = doc.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  const root: ParentNode = modals.length > 0 ? (modals[modals.length - 1] ?? doc) : doc;
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.closest('[hidden], [inert]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

export function moveFocus(doc: Document, dir: Direction): HTMLElement | null {
  const scope = focusScope(doc);
  const active = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  if (!active || !scope.includes(active)) {
    const first = scope[0] ?? null;
    first?.focus();
    return first;
  }
  const others = scope.filter((el) => el !== active);
  const i = pickInDirection(
    active.getBoundingClientRect(),
    others.map((el) => el.getBoundingClientRect()),
    dir,
  );
  const next = i >= 0 ? (others[i] ?? null) : null;
  next?.focus();
  return next;
}
