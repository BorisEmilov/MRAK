import { describe, expect, it } from 'vitest';
import { bytesOfGroups, type AssetManifest } from '../assets/manifest';
import { DEFAULT_OPTIONS, loadOptions, saveOptions } from './options';

describe('options', () => {
  it('round-trips through storage and falls back on bad data', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
    saveOptions(storage, { ...DEFAULT_OPTIONS, textScale: 1.5 });
    expect(loadOptions(storage).textScale).toBe(1.5);
    data.set('mrak.options.v1', '{not json');
    expect(loadOptions(storage)).toEqual(DEFAULT_OPTIONS);
    expect(loadOptions(undefined)).toEqual(DEFAULT_OPTIONS);
  });
});

describe('asset manifest', () => {
  it('counts one audio format per sound', () => {
    const manifest: AssetManifest = {
      version: 1,
      zones: {},
      maps: {},
      groups: {
        common: {
          demo: true,
          atlases: [
            {
              key: 'common',
              image: { url: 'a.png', bytes: 100 },
              data: { url: 'a.json', bytes: 10 },
            },
          ],
          audio: [
            { key: 'wind', ogg: { url: 'w.ogg', bytes: 50 }, m4a: { url: 'w.m4a', bytes: 70 } },
          ],
        },
      },
    };
    expect(bytesOfGroups(manifest, ['common', 'missing'])).toBe(180);
  });
});
