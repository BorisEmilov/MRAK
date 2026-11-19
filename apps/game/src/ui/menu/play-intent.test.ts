import { describe, expect, it } from 'vitest';
import { takePlayIntent } from './play-intent';

function at(href: string) {
  const calls: string[] = [];
  const hist = {
    state: null,
    replaceState: (_s: unknown, _t: string, url?: string | URL | null) => {
      calls.push(String(url));
    },
  };
  return { intent: takePlayIntent({ href }, hist), calls };
}

describe('play intent from the player hub', () => {
  it('reads continue and new and removes the parameter', () => {
    expect(at('https://play.mrak.game/?play=continue')).toEqual({
      intent: 'continue',
      calls: ['/'],
    });
    expect(at('https://play.mrak.game/?x=1&play=new#a')).toEqual({
      intent: 'new',
      calls: ['/?x=1#a'],
    });
  });
  it('ignores unknown values (still cleaned) and absent parameters', () => {
    expect(at('https://play.mrak.game/?play=delete-all')).toEqual({ intent: null, calls: ['/'] });
    expect(at('https://play.mrak.game/')).toEqual({ intent: null, calls: [] });
  });
});
