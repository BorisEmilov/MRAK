/**
 * Asset pipeline (docs/systems/asset-pipeline.md):
 *   1. pack assets/src/sprites/<group>/*.png into one atlas per group (free-tex-packer-core);
 *   2. encode assets/src/audio/*.wav to Ogg Vorbis + AAC/m4a (ffmpeg);
 *   3. name every output by content hash (long-term CDN caching);
 *   4. write public/assets/manifest.json and enforce size budgets.
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
import { decodePng, encodePng } from './art/png';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(APP, 'assets/src');
const CONTENT = join(APP, '../../packages/content');
const OUT = join(APP, 'public/assets');
const requireAudio = process.argv.includes('--require-audio');

interface Config {
  groups: Record<string, { sprites: boolean; audio: string[]; demo: boolean }>;
  zones: Record<string, string[]>;
  budgets: { maxFileBytes: number; maxDemoBytes: number };
}
const config = JSON.parse(readFileSync(join(APP, 'assets/assets.config.json'), 'utf8')) as Config;

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
      const dir = join(SRC, 'sprites', group);
      const images = readdirSync(dir)
        .filter((f) => f.endsWith('.png'))
        .sort()
        .map((f) => ({ path: f, contents: readFileSync(join(dir, f)) }));
      const files = await packAsync(images, {
        textureName: group,
        width: 2048,
        height: 2048,
        padding: 2,
        extrude: 1,
        allowRotation: false,
        allowTrim: false,
        detectIdentical: true,
        removeFileExtension: true,
        prependFolderName: false,
        exporter: 'JsonHash',
        packer: 'MaxRectsPacker',
      });
      const png = files.find((f) => f.name.endsWith('.png'));
      const json = files.find((f) => f.name.endsWith('.json'));
      if (!png || !json || files.length !== 2)
        throw new Error(`group "${group}" did not fit in one 2048² atlas`);
      entry.atlases.push({
        key: group,
        image: hashed('atlases', group, 'png', png.buffer),
        data: hashed('atlases', group, 'json', json.buffer),
        normal: hashed('atlases', `${group}_n`, 'png', normalOf(png.buffer, 0)),
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
  if (problems.length > 0) throw new Error(`asset budget exceeded:\n  ${problems.join('\n  ')}`);

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
