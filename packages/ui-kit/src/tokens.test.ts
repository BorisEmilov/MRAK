import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLORBLIND_MODES, contrast, CONTRAST_PAIRS, PALETTE } from './tokens';

describe('design tokens', () => {
  it.each(CONTRAST_PAIRS.map((p) => [p[3], p[0], p[1], p[2]] as const))(
    '%s meets its contrast',
    (_use, fg, bg, min) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
    },
  );

  it('semantic colours stay readable in every colour-blind mode', () => {
    for (const mode of Object.values(COLORBLIND_MODES))
      for (const c of Object.values(mode))
        expect(contrast(c, PALETTE['earth-900'])).toBeGreaterThanOrEqual(4.5);
  });

  it('tokens.css matches tokens.ts', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    for (const [name, hex] of Object.entries(PALETTE))
      expect(css).toContain(`--mrak-${name}: ${hex};`);
  });
});
