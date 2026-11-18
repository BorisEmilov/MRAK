/**
 * Placeholder art at the final size and pivot of every slot without a source
 * (docs/art-direction.md). Never overwrites a file. Usage: pnpm art:placeholders
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImage, encodePng, type Rgba } from './png';
import { loadSlots, sourceOf, type Slot } from './slots';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(APP, 'assets/src/sprites');

const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
// Palette of docs/art-direction.md.
const INK = hex('#1c1410');
const EARTH = hex('#4b3a2b');
const STONE = hex('#86857f');
const MOSS = hex('#56683f');
const RIM = hex('#cdb98f');
const SKIN = hex('#c79a76');
const SHADOW = hex('#0e0a08');
const EYE = hex('#ff3b2f');

function put(img: Rgba, x: number, y: number, c: [number, number, number], a = 255): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data.set([...c, a], (y * img.width + x) * 4);
}

/** Filled ellipse inside the box, outlined in ink, lit rim on top. */
function blob(img: Rgba, x0: number, y0: number, w: number, h: number, fill: typeof INK): void {
  const cx = x0 + (w - 1) / 2;
  const cy = y0 + (h - 1) / 2;
  const inside = (x: number, y: number) =>
    ((x - cx) / (w / 2)) ** 2 + ((y - cy) / (h / 2)) ** 2 <= 1;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      put(img, x, y, edge ? INK : !inside(x, y - 2) ? RIM : fill);
    }
}

function draw(slot: Slot, frame: number): Rgba {
  const { width: w, height: h } = slot;
  const img = createImage(w, h);
  switch (slot.category) {
    case 'tile':
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) put(img, x, y, (x + y) % 4 === 0 ? INK : EARTH);
      break;
    case 'character': {
      const step = frame % 2 === 1 ? 1 : 0;
      blob(img, 3, h - 18, w - 6, 14, EARTH); // body
      blob(img, 4, h - 24, w - 8, 8, SKIN); // head
      for (let y = h - 4; y < h; y++) {
        put(img, 6 - step, y, INK);
        put(img, w - 7 + step, y, INK);
      }
      break;
    }
    case 'creature':
      blob(img, 2, 2, w - 4, h - 2, SHADOW);
      put(img, Math.floor(w / 2) - 3, Math.floor(h / 3), EYE);
      put(img, Math.floor(w / 2) + 2, Math.floor(h / 3), EYE);
      break;
    case 'portrait':
      for (let i = 0; i < w * h; i++) img.data.set([...EARTH, 255], i * 4);
      blob(img, w / 4, h / 6, w / 2, (h * 2) / 3, SKIN);
      break;
    case 'effect':
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) if ((x + 2 * y) % 5 === 0) put(img, x, y, STONE, 90);
      break;
    default: // object: base on the bottom edge (pivot 0.5, 1)
      blob(img, 1, 1, w - 2, h - 1, h > w ? MOSS : STONE);
  }
  return img;
}

let made = 0;
for (const slot of loadSlots(join(APP, 'assets/art-slots.json'))) {
  const dir = join(SRC, slot.group);
  if (sourceOf(dir, slot.name)) continue;
  mkdirSync(dir, { recursive: true });
  slot.frames.forEach((name, i) => {
    writeFileSync(join(dir, `${name}.png`), encodePng(draw(slot, i)));
    made++;
    console.log(
      `+ sprites/${slot.group}/${name}.png (${slot.category} ${String(slot.width)}×${String(slot.height)})`,
    );
  });
}
console.log(`✔ ${String(made)} placeholder(s) created`);
