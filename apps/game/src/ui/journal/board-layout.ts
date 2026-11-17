/** Pure layout of the deduction board (docs/systems/mysteries.md → Implementation). */
export const CARD_W = 190;
export const CARD_H = 70;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 2;

export interface Point {
  x: number;
  y: number;
}

/** Default position of a card: clues in two columns on the left, propositions by kind on the right. */
export function defaultPosition(card: string, clueIndex: number, propIndex: number): Point {
  if (!card.includes(':'))
    return {
      x: 40 + (clueIndex % 2) * (CARD_W + 30),
      y: 40 + Math.floor(clueIndex / 2) * (CARD_H + 30),
    };
  const kinds = ['culprit', 'cause', 'remedy', 'motive', 'opportunity'];
  const col = Math.max(0, kinds.indexOf(card.split(':')[0] ?? ''));
  return { x: 520 + col * (CARD_W + 30), y: 40 + propIndex * (CARD_H + 24) };
}

/** Threads tied to a proposition: what the board shows instead of a verdict. */
export function threadCount(
  links: readonly { proposition: string }[],
  proposition: string,
): number {
  return links.filter((l) => l.proposition === proposition).length;
}

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
}
