import { describe, expect, it } from 'vitest';
import { actionFor, rebind, resolveBindings } from './bindings';

describe('key bindings', () => {
  it('uses defaults and resolves actions', () => {
    const b = resolveBindings({});
    expect(b.interact.keys).toEqual(['KeyE', 'Space']);
    expect(actionFor(b, 'KeyJ')).toBe('journal');
    expect(actionFor(b, 'KeyZ')).toBeNull();
  });

  it('swaps instead of leaving an action without a key', () => {
    const next = rebind({}, 'journal', 'KeyE');
    const b = resolveBindings(next);
    expect(b.journal.keys[0]).toBe('KeyE');
    expect(b.interact.keys).toEqual(['KeyJ', 'Space']);
    expect(actionFor(b, 'KeyE')).toBe('journal');
  });

  it('refuses reserved keys', () => {
    expect(rebind({}, 'pause', 'F12')).toEqual({});
  });
});
