// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generate } from './build-icons';
import { parseManifest } from './icons-lib';

describe('icon pipeline', () => {
  it('generated sprite, names and docs are up to date (run `pnpm --filter @mrak/ui-kit icons`)', () => {
    for (const [file, text] of Object.entries(generate()))
      expect(readFileSync(file, 'utf8')).toBe(text);
  });

  it('rejects bad manifests', () => {
    expect(() => parseManifest({})).toThrow(/icons/);
    const base = { name: 'ui.x', category: 'ui', source: 's', author: 'lorc', meaning: 'm' };
    expect(() => parseManifest({ icons: [base, base] })).toThrow(/duplicate/);
    expect(() => parseManifest({ icons: [{ ...base, category: 'resource' }] })).toThrow(
      /start with/,
    );
    expect(() => parseManifest({ icons: [{ ...base, author: 'nobody' }] })).toThrow(/author/);
  });
});
