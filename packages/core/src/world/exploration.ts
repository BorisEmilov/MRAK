/**
 * Explored area of a zone, for the player map (docs/systems/night-exploration.md). A bitset of
 * cells (2 × 2 tiles), stored base64 in the WorldState so saves stay small.
 */

export const EXPLORE_CELL_TILES = 2;
/** Largest cell index accepted (a 512 × 512-tile map has 65 536 cells). */
export const MAX_CELLS = 65_536;
/** Reveal radius in tiles by day (ambient ≥ 0.5). */
export const DAY_REVEAL_TILES = 8;
/** Minimum reveal radius in tiles at night (otherwise the lantern radius). */
export const NIGHT_REVEAL_TILES = 3;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map(Array.from({ length: ALPHABET.length }, (_, i) => [ALPHABET.charAt(i), i]));

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63] ?? '';
    out += ALPHABET[(n >> 12) & 63] ?? '';
    out += i + 1 < bytes.length ? (ALPHABET[(n >> 6) & 63] ?? '') : '=';
    out += i + 2 < bytes.length ? (ALPHABET[n & 63] ?? '') : '=';
  }
  return out;
}

export function decodeBase64(text: string): Uint8Array {
  let end = text.length;
  while (end > 0 && text[end - 1] === '=') end--;
  const clean = text.slice(0, end);
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of clean) {
    const v = LOOKUP.get(ch);
    if (v === undefined) throw new RangeError('invalid base64');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Sets the given cells; returns the new encoding (unchanged string when nothing was new). */
export function revealCells(encoded: string, cells: readonly number[]): string {
  let bytes = decodeBase64(encoded);
  let changed = false;
  for (const cell of cells) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= MAX_CELLS)
      throw new RangeError(`cell ${String(cell)} out of range`);
    const byte = cell >> 3;
    if (byte >= bytes.length) {
      const grown = new Uint8Array(byte + 1);
      grown.set(bytes);
      bytes = grown;
    }
    const mask = 1 << (cell & 7);
    if (((bytes[byte] ?? 0) & mask) === 0) {
      bytes[byte] = (bytes[byte] ?? 0) | mask;
      changed = true;
    }
  }
  return changed ? encodeBase64(bytes) : encoded;
}

export function isRevealed(bytes: Uint8Array, cell: number): boolean {
  return (((bytes[cell >> 3] ?? 0) >> (cell & 7)) & 1) === 1;
}

export function countRevealed(encoded: string): number {
  let n = 0;
  for (const byte of decodeBase64(encoded)) for (let b = byte; b; b &= b - 1) n++;
  return n;
}

/** Cell indices (row-major, `cols` wide) within `radius` cells of (cx, cy). */
export function cellsInDisc(
  cx: number,
  cy: number,
  radius: number,
  cols: number,
  rows: number,
): number[] {
  const out: number[] = [];
  const r = Math.max(0, radius);
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(rows - 1, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(cols - 1, Math.ceil(cx + r)); x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) out.push(y * cols + x);
  return out;
}
