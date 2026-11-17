import { describe, expect, it } from 'vitest';
import { buildRawPack, ContentLoadError, loadContentDatabase } from './content';

describe('content loading', () => {
  it('loads and validates the bundled content pack', () => {
    const db = loadContentDatabase();
    expect(db.all('villagers')).toHaveLength(8);
    expect(db.info.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('maps data files to collections and the registry', () => {
    const raw = buildRawPack({
      '../../../../packages/content/data/flags.json': { flags: [] },
      '../../../../packages/content/data/items/items.json': [],
      '../../../../packages/content/data/not-a-collection/x.json': {},
    });
    expect(raw.registry.file).toBe('data/flags.json');
    expect(Object.keys(raw.collections)).toEqual(['items']);
  });

  it('fails clearly without a registry', () => {
    expect(() => buildRawPack({})).toThrow(ContentLoadError);
  });
});
