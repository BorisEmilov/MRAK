import { describe, expect, it } from 'vitest';
import { safeNext } from './index';

const origin = 'https://mrak.game';

describe('safeNext (open redirect after sign-in)', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/store/?a=1#b', origin)).toBe('/store/?a=1#b');
  });
  it.each([
    null,
    '',
    'https://evil.test/',
    '//evil.test/',
    '/\\evil.test/',
    '/\\/evil.test/',
    'javascript:alert(1)',
    ' /x',
  ])('falls back for %j', (next) => {
    expect(safeNext(next, origin)).toBe('/account/');
  });
});
