/**
 * Pillar-6 rules that must never regress: every content entity with an icon convention has an
 * icon, no font size under the 14 px minimum, every ui-kit string has a locale key.
 */
import { locales } from '@mrak/content';
import { ICON_NAMES, MIN_TEXT_PX, TEXT_SIZES, UI_STRING_KEYS } from '@mrak/ui-kit';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from '../host/content';

const content = loadContentDatabase();
const icons = new Set<string>(ICON_NAMES);

describe('icons', () => {
  it.each([
    ['talents', 'talent'],
    ['attributes', 'attribute'],
    ['skills', 'skill'],
    ['callings', 'calling'],
    ['trees', 'tree'],
    ['buildings', 'building'],
    ['debt-sources', 'debt'],
    ['achievements', 'achievement'],
  ] as const)('every entity in %s has the icon %s.<id>', (collection, category) => {
    const missing = content
      .all(collection)
      .map((e) => `${category}.${e.id}`)
      .filter((name) => !icons.has(name));
    expect(missing).toEqual([]);
  });

  it('every director event category and hint icon exists', () => {
    for (const e of content.all('events')) expect(icons.has(`event.${e.category}`)).toBe(true);
    for (const h of content.all('hints')) if (h.icon) expect(icons.has(h.icon), h.id).toBe(true);
  });

  it('every item and task icon exists', () => {
    for (const i of content.all('items')) expect(icons.has(i.icon), i.id).toBe(true);
    for (const t of content.all('tasks')) expect(icons.has(t.icon), t.id).toBe(true);
  });
});

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? cssFiles(join(dir, d.name))
      : d.name.endsWith('.css')
        ? [join(dir, d.name)]
        : [],
  );
}

describe('minimum text size', () => {
  const root = resolve(process.cwd(), '../..');
  const files = [
    ...cssFiles(resolve(root, 'apps/game/src')),
    ...cssFiles(resolve(root, 'packages/ui-kit/src/styles')),
  ];

  it('the smallest token is the 14 px minimum', () => {
    expect(Math.min(...Object.values(TEXT_SIZES)) * 16).toBe(MIN_TEXT_PX);
  });

  it.each(files.map((f) => [f.slice(root.length + 1), f]))(
    '%s sets font sizes only through tokens',
    (_name, file) => {
      const css = readFileSync(file, 'utf8');
      const bad: string[] = [];
      for (const m of css.matchAll(/font(?:-size)?\s*:\s*([^;]+);/g)) {
        const value = m[1] ?? '';
        // The root rule that applies the text-scale option is the only non-token size.
        if (
          /^(inherit|var\(--mrak-font-[a-z]+\)|calc\(100% \* var\(--mrak-text-scale, 1\)\))$/.test(
            value.trim(),
          )
        )
          continue;
        const sizes = value.match(/(\d*\.?\d+)(px|rem|em)\b/g) ?? [];
        const tokenised = /var\(--mrak-text-(xs|sm|md|lg|xl|display)\)/.test(value);
        if (!tokenised || sizes.length > 0) bad.push(value.trim());
      }
      expect(bad).toEqual([]);
    },
  );
});

describe('ui-kit strings', () => {
  it('every kit string key exists in locales/en.json', () => {
    const en: Record<string, string> = locales.en;
    expect(UI_STRING_KEYS.filter((k) => !(k in en))).toEqual([]);
  });
});
