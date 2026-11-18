/**
 * Asset pipeline (docs/systems/asset-pipeline.md):
 *   1. read each art slot (assets/art-slots.json) from its source (Aseprite, PSD or PNG), check its
 *      final size, pack one atlas per group (free-tex-packer-core) with pivots, and compose its
 *      normal map from painted `_n` sources or generated per sprite (docs/art-direction.md);
 *   2. encode assets/src/audio/*.wav to Ogg Vorbis + AAC/m4a (ffmpeg);
 *   3. name every output by content hash (long-term CDN caching);
 *   4. write public/assets/manifest.json, enforce file/demo budgets and warn on zone budgets.
 * Usage: tsx scripts/build-assets.ts [--require-audio]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packAsync } from 'free-tex-packer-core';
import {
  AssetManifestSchema,
  bytesOfGroups,
  bytesOfMap,
  type AssetManifest,
} from '../src/assets/manifest';
import { normalMapOf } from './art/normal-map';
import { createImage, decodePng, encodePng, type Rgba } from './art/png';
import { loadSlots, readFrames, sourceBases, type Slot } from './art/slots';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(APP, 'assets/src');
const CONTENT = join(APP, '../../packages/content');
const OUT = join(APP, 'public/assets');
const requireAudio = process.argv.includes('--require-audio');

interface Config {
  groups: Record<string, { sprites: boolean; audio: string[]; demo: boolean }>;
  zones: Record<string, string[]>;
  budgets: {
    maxFileBytes: number;
    maxDemoBytes: number;
    /** Per zone (common + zone groups + its maps); over it = warning, not failure. */
    maxZoneBytes: number;
    zoneBytes?: Record<string, number>;
  };
}
const config = JSON.parse(readFileSync(join(APP, 'assets/assets.config.json'), 'utf8')) as Config;
const slots = loadSlots(join(APP, 'assets/art-slots.json'));

interface FrameArt {
  slot: Slot;
  image: Rgba;
  normal: Rgba | null;
}

/** Every frame of a group's slots, checked against its final size; unknown sources fail. */
function groupFrames(group: string, problems: string[]): Map<string, FrameArt> {
  const dir = join(SRC, 'sprites', group);
  const mine = slots.filter((s) => s.group === group);
  for (const base of sourceBases(dir))
    if (!mine.some((s) => s.name === base))
      problems.push(`sprites/${group}/${base}: no slot in assets/art-slots.json`);
  const out = new Map<string, FrameArt>();
  for (const slot of mine) {
    const images = readFrames(dir, slot.name);
    if (!images) {
      problems.push(`sprites/${group}/${slot.name}: missing source (run pnpm art:placeholders)`);
      continue;
    }
    const normals = readFrames(dir, `${slot.name}_n`);
    if (images.length !== slot.frames.length)
      problems.push(
        `sprites/${group}/${slot.name}: ${String(images.length)} frames, slot has ${String(slot.frames.length)}`,
      );
    slot.frames.forEach((frame, i) => {
      const image = images[i];
      if (!image) return;
      const normal = normals?.[i] ?? null;
      for (const [what, img] of [
        ['', image],
        ['_n', normal],
      ] as const)
        if (img && (img.width !== slot.width || img.height !== slot.height))
          problems.push(
            `sprites/${group}/${frame}${what}: ${String(img.width)}×${String(img.height)}, slot ${slot.category} is ${String(slot.width)}×${String(slot.height)}`,
          );
      out.set(frame, { slot, image, normal });
    });
  }
  return out;
}

/** Normal-map atlas in the atlas layout: painted `_n` frames or generated per sprite. */
function composeNormals(
  size: { w: number; h: number },
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>,
  art: Map<string, FrameArt>,
): Buffer {
  const out = createImage(size.w, size.h);
  for (let i = 0; i < out.data.length; i += 4) out.data.set([128, 128, 255, 255], i);
  for (const [name, { frame }] of Object.entries(frames)) {
    const a = art.get(name);
    if (!a) continue;
    const n = a.normal ?? normalMapOf(a.image, { cell: 0 });
    for (let y = 0; y < frame.h; y++)
      out.data.set(
        n.data.subarray(y * n.width * 4, (y * n.width + frame.w) * 4),
        ((frame.y + y) * size.w + frame.x) * 4,
      );
  }
  return encodePng(out);
}

function hashed(
  dir: string,
  name: string,
  ext: string,
  buffer: Buffer,
): { url: string; bytes: number } {
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 10);
  const file = `${name}.${hash}.${ext}`;
  mkdirSync(join(OUT, dir), { recursive: true });
  writeFileSync(join(OUT, dir, file), buffer);
  return { url: `${dir}/${file}`, bytes: buffer.length };
}

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function encode(wav: string, args: string[], ext: string): Buffer {
  const out = join(tmpdir(), `mrak-${basename(wav, '.wav')}-${String(process.pid)}.${ext}`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, ...args, out]);
  const buffer = readFileSync(out);
  rmSync(out);
  return buffer;
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const ffmpeg = hasFfmpeg();
  if (!ffmpeg) {
    const message = 'ffmpeg not found: audio is skipped (install ffmpeg to encode ogg + m4a)';
    if (requireAudio) throw new Error(message);
    console.warn(`⚠ ${message}`);
  }

  const manifest: AssetManifest = { version: 1, groups: {}, zones: config.zones, maps: {} };
  const problems: string[] = [];

  for (const [group, spec] of Object.entries(config.groups)) {
    const entry: AssetManifest['groups'][string] = { demo: spec.demo, atlases: [], audio: [] };
    if (spec.sprites) {
      const art = groupFrames(group, problems);
      const images = [...art.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, a]) => ({ path: `${name}.png`, contents: encodePng(a.image) }));
      const files = await packAsync(images, {
        textureName: group,
        width: 2048,
        height: 2048,
        padding: 2,
        extrude: 1,
        allowRotation: false,
        allowTrim: false,
        detectIdentical: false,
        removeFileExtension: true,
        prependFolderName: false,
        exporter: 'JsonHash',
        packer: 'MaxRectsPacker',
      });
      const png = files.find((f) => f.name.endsWith('.png'));
      const json = files.find((f) => f.name.endsWith('.json'));
      if (!png || !json || files.length !== 2)
        throw new Error(`group "${group}" did not fit in one 2048² atlas`);
      // Pivots from the slots: Phaser uses a frame's `pivot` as the default origin.
      const data = JSON.parse(json.buffer.toString('utf8')) as {
        frames: Record<
          string,
          {
            frame: { x: number; y: number; w: number; h: number };
            pivot?: { x: number; y: number };
          }
        >;
        meta: { size: { w: number; h: number } };
      };
      for (const [name, f] of Object.entries(data.frames)) {
        const a = art.get(name);
        if (a) f.pivot = a.slot.pivot;
      }
      entry.atlases.push({
        key: group,
        image: hashed('atlases', group, 'png', png.buffer),
        data: hashed('atlases', group, 'json', Buffer.from(JSON.stringify(data))),
        normal: hashed(
          'atlases',
          `${group}_n`,
          'png',
          composeNormals(data.meta.size, data.frames, art),
        ),
      });
    }
    for (const sound of ffmpeg ? spec.audio : []) {
      const wav = join(SRC, 'audio', `${sound}.wav`);
      if (!existsSync(wav)) throw new Error(`missing audio source ${wav}`);
      entry.audio.push({
        key: sound,
        ogg: hashed('audio', sound, 'ogg', encode(wav, ['-c:a', 'libvorbis', '-q:a', '3'], 'ogg')),
        m4a: hashed('audio', sound, 'm4a', encode(wav, ['-c:a', 'aac', '-b:a', '96k'], 'm4a')),
      });
    }
    manifest.groups[group] = entry;
  }

  // Zone maps (Tiled) and their tilesets, with generated normal maps (docs/systems/maps.md).
  const mapsDir = join(CONTENT, 'maps');
  for (const file of readdirSync(mapsDir)
    .filter((f) => f.endsWith('.tmj'))
    .sort()) {
    const raw = readFileSync(join(mapsDir, file));
    const map = JSON.parse(raw.toString('utf8')) as { tilesets: { name: string; image: string }[] };
    const tilesets: AssetManifest['maps'][string]['tilesets'] = {};
    for (const ts of map.tilesets) {
      const source = join(mapsDir, ts.image);
      const image = readFileSync(source);
      // A hand-painted normal map next to the art wins over the generated one.
      const painted = source.replace(/\.png$/, '_n.png');
      tilesets[ts.name] = {
        image: hashed('maps', ts.name, 'png', image),
        normal: hashed(
          'maps',
          `${ts.name}_n`,
          'png',
          existsSync(painted) ? readFileSync(painted) : normalOf(image, 16),
        ),
      };
    }
    manifest.maps[`maps/${file}`] = {
      data: hashed('maps', basename(file, '.tmj'), 'json', raw),
      tilesets,
    };
  }

  for (const g of Object.values(manifest.groups)) {
    for (const f of [
      ...g.atlases.flatMap((a) => [a.image, a.data, ...(a.normal ? [a.normal] : [])]),
      ...g.audio.flatMap((a) => [a.ogg, a.m4a]),
    ]) {
      if (f.bytes > config.budgets.maxFileBytes)
        problems.push(`${f.url} is ${String(f.bytes)} bytes (> 2 MB)`);
    }
  }
  const demoGroups = Object.entries(manifest.groups)
    .filter(([, g]) => g.demo)
    .map(([name]) => name);
  for (const m of Object.values(manifest.maps))
    for (const f of [m.data, ...Object.values(m.tilesets).flatMap((t) => [t.image, t.normal])])
      if (f.bytes > config.budgets.maxFileBytes)
        problems.push(`${f.url} is ${String(f.bytes)} bytes (> 2 MB)`);
  // Demo maps: every map counts (the MVP zones are all in the demo).
  const demoBytes =
    bytesOfGroups(manifest, demoGroups) +
    Object.keys(manifest.maps).reduce((s, path) => s + bytesOfMap(manifest, path), 0);
  if (demoBytes > config.budgets.maxDemoBytes)
    problems.push(`demo assets ${String(demoBytes)} bytes exceed budget`);
  if (problems.length > 0) throw new Error(`assets:\n  ${problems.join('\n  ')}`);

  // Zone budgets (docs/art-direction.md → Budgets): a warning, and a CI annotation.
  for (const zone of Object.keys(config.zones)) {
    const maps = Object.keys(manifest.maps).filter((p) =>
      new RegExp(`^maps/${zone}(-[\\w-]+)?\\.tmj$`).test(p),
    );
    const bytes =
      bytesOfGroups(manifest, ['common', ...(config.zones[zone] ?? [])]) +
      maps.reduce((sum, p) => sum + bytesOfMap(manifest, p), 0);
    const budget = config.budgets.zoneBytes?.[zone] ?? config.budgets.maxZoneBytes;
    if (bytes > budget) {
      const msg = `zone "${zone}" assets ${(bytes / 1024).toFixed(1)} KiB exceed its budget ${(budget / 1024).toFixed(1)} KiB`;
      console.warn(`⚠ ${msg}`);
      if (process.env['GITHUB_ACTIONS']) console.log(`::warning title=Zone asset budget::${msg}`);
    }
  }

  AssetManifestSchema.parse(manifest);
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `✔ assets: ${String(Object.keys(manifest.groups).length)} groups, demo ${(demoBytes / 1024).toFixed(1)} KiB → public/assets`,
  );
}

function normalOf(png: Buffer, cell: number): Buffer {
  return encodePng(normalMapOf(decodePng(png), { cell }));
}

await main();
