/**
 * Art slots (docs/art-direction.md): the final size and pivot of every sprite, and how its source
 * file (Aseprite, PSD or PNG) becomes frames. Replacing art = replacing the source file.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePng, type Rgba } from './png';

export const SOURCE_EXTS = ['aseprite', 'ase', 'psd', 'png'] as const;

interface Category {
  size?: [number, number];
  pivot: [number, number];
}
interface SlotSpec {
  category: string;
  frames?: number;
  size?: [number, number];
}
export interface SlotsFile {
  categories: Record<string, Category>;
  sprites: Record<string, SlotSpec>;
}

export interface Slot {
  group: string;
  name: string;
  category: string;
  width: number;
  height: number;
  pivot: { x: number; y: number };
  /** Atlas frame names: `name`, or `name-0`… for animations. */
  frames: string[];
}

export function loadSlots(path: string): Slot[] {
  const file = JSON.parse(readFileSync(path, 'utf8')) as SlotsFile;
  return Object.entries(file.sprites).map(([id, spec]) => {
    const [group = '', name = ''] = id.split('/');
    const cat = file.categories[spec.category];
    if (!cat || !group || !name) throw new Error(`art-slots: bad slot "${id}"`);
    const size = spec.size ?? cat.size;
    if (!size) throw new Error(`art-slots: "${id}" needs a size (category ${spec.category})`);
    const n = spec.frames ?? 1;
    return {
      group,
      name,
      category: spec.category,
      width: size[0],
      height: size[1],
      pivot: { x: cat.pivot[0], y: cat.pivot[1] },
      frames: n > 1 ? Array.from({ length: n }, (_, i) => `${name}-${String(i)}`) : [name],
    };
  });
}

function hasTool(cmd: string): boolean {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** PNG files exported by a tool into a temporary folder, in name order. */
function exported(run: (out: string) => void): Rgba[] {
  const dir = mkdtempSync(join(tmpdir(), 'mrak-art-'));
  try {
    run(dir);
    return readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      .map((f) => decodePng(readFileSync(join(dir, f))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The source file(s) of `base` in `dir`, or null when there is none. */
export function sourceOf(dir: string, base: string): string | null {
  for (const ext of SOURCE_EXTS) {
    const f = join(dir, `${base}.${ext}`);
    if (existsSync(f)) return f;
  }
  return existsSync(join(dir, `${base}-0.png`)) ? join(dir, `${base}-0.png`) : null;
}

/**
 * Frames of `base` (sprite or its `_n` normal map): `<base>.aseprite|.ase` (every frame, via the
 * Aseprite CLI), `<base>.psd` (flattened, via ImageMagick), `<base>.png`, or `<base>-0.png`….
 */
export function readFrames(dir: string, base: string): Rgba[] | null {
  const src = sourceOf(dir, base);
  if (!src) return null;
  if (/\.(aseprite|ase)$/.test(src)) {
    if (!hasTool('aseprite'))
      throw new Error(`${src}: install the Aseprite CLI (aseprite -b) or export PNGs`);
    return exported((out) => {
      execFileSync('aseprite', ['-b', src, '--save-as', join(out, '{frame}.png')]);
    });
  }
  if (src.endsWith('.psd')) {
    const magick = hasTool('magick') ? 'magick' : null;
    if (!magick) throw new Error(`${src}: install ImageMagick (magick) or export a PNG`);
    return exported((out) => {
      execFileSync(magick, [`${src}[0]`, '-define', 'png:color-type=6', join(out, '0.png')]);
    });
  }
  if (src.endsWith(`${base}-0.png`)) {
    const frames: Rgba[] = [];
    for (let i = 0; existsSync(join(dir, `${base}-${String(i)}.png`)); i++)
      frames.push(decodePng(readFileSync(join(dir, `${base}-${String(i)}.png`))));
    return frames;
  }
  return [decodePng(readFileSync(src))];
}

/** Source bases present in a group folder (`guardian-0.png` → `guardian`, `x_n.png` skipped). */
export function sourceBases(dir: string): Set<string> {
  const out = new Set<string>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const ext = SOURCE_EXTS.find((e) => f.endsWith(`.${e}`));
    if (!ext) continue;
    const base = f.slice(0, -ext.length - 1).replace(/-\d+$/, '');
    if (base && !base.endsWith('_n')) out.add(base);
  }
  return out;
}
