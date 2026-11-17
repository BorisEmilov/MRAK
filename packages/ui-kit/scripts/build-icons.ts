/** CLI: regenerates the icon sprite, the typed names and docs/ui/icons.md. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocs, buildNames, buildSprite, parseManifest, type IconSet } from './icons-lib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function generate(): Record<string, string> {
  const manifest = parseManifest(
    JSON.parse(readFileSync(resolve(root, 'icons/manifest.json'), 'utf8')),
  );
  const require = createRequire(import.meta.url);
  const set = JSON.parse(
    readFileSync(require.resolve('@iconify-json/game-icons/icons.json'), 'utf8'),
  ) as IconSet;
  return {
    [resolve(root, 'src/icons/sprite.svg')]: buildSprite(manifest, set),
    [resolve(root, 'src/icons/names.ts')]: buildNames(manifest),
    [resolve(root, '../../docs/ui/icons.md')]: buildDocs(manifest),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [file, text] of Object.entries(generate())) {
    writeFileSync(file, text);
    console.log(`wrote ${file}`);
  }
}
