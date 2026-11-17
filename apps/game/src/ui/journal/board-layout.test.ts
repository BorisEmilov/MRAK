import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clampZoom, defaultPosition, threadCount } from './board-layout';

describe('deduction board', () => {
  it('lays out clues left and propositions by kind', () => {
    expect(defaultPosition('g-ballad', 0, 0)).toEqual({ x: 40, y: 40 });
    expect(defaultPosition('cause:x', 0, 1).x).toBeGreaterThan(
      defaultPosition('culprit:y', 0, 1).x,
    );
    expect(clampZoom(5)).toBe(2);
    expect(
      threadCount([{ proposition: 'culprit:a' }, { proposition: 'cause:b' }], 'culprit:a'),
    ).toBe(1);
  });

  it('no UI reads the solution or the verdict before the act', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const full = join(dir, f);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.tsx') && !full.includes('debug')) files.push(full);
      }
    };
    walk(join(__dirname, '..'));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\.solution\b|conclusion\??\.correct|payload\.correct/);
    }
  });
});
