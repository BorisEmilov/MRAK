/** Collection progress by category (docs/systems/collection.md rules 6–7). */
import type { CollectionCategory } from '@mrak/content-schema';
import type { z } from 'zod';
import type { ContentDatabase } from '../content/database';
import type { Snapshot, WorldState } from '../state/world-state';

type ReadState = Snapshot | WorldState;
export type Category = z.infer<typeof CollectionCategory>;

export const CATEGORIES: readonly Category[] = [
  'herbs',
  'recipes',
  'grimoire',
  'relics',
  'tales',
  'songs',
  'cursed',
  'photos',
  'memories',
];

export interface CategoryProgress {
  category: Category;
  have: number;
  total: number;
  /** Ids counted (for the collection screen). */
  ids: readonly string[];
  owned: readonly string[];
}

const KIND_OF: Partial<Record<Category, string>> = {
  grimoire: 'grimoire-page',
  relics: 'relic',
  tales: 'folk-tale',
  songs: 'song',
};

function progress(category: Category, ids: readonly string[], owned: ReadonlySet<string>) {
  const have = ids.filter((id) => owned.has(id));
  return { category, have: have.length, total: ids.length, ids, owned: have };
}

export function categoryProgress(
  state: ReadState,
  db: ContentDatabase,
  category: Category,
): CategoryProgress {
  const found = new Set(state.collection.found);
  switch (category) {
    case 'herbs':
      return progress(
        category,
        db
          .all('items')
          .filter((i) => i.category === 'herb')
          .map((i) => i.id),
        found,
      );
    case 'recipes':
      return progress(
        category,
        db.all('recipes').map((r) => r.id),
        new Set(state.guardian.unlockedRecipes),
      );
    case 'cursed':
      return progress(
        category,
        db
          .all('items')
          .filter((i) => i.cursed !== undefined)
          .map((i) => i.id),
        found,
      );
    case 'photos':
      return progress(
        category,
        db.all('photo-layers').map((l) => l.id),
        new Set(state.collection.layers),
      );
    case 'memories':
      return progress(
        category,
        db.all('cursed-objects').map((c) => c.id),
        new Set(state.collection.memories),
      );
    default: {
      const kind = KIND_OF[category];
      return progress(
        category,
        db
          .all('collectibles')
          .filter((c) => c.kind === kind)
          .map((c) => c.id),
        new Set(state.guardian.collectibles),
      );
    }
  }
}

export function collectionProgress(state: ReadState, db: ContentDatabase): CategoryProgress[] {
  return CATEGORIES.map((c) => categoryProgress(state, db, c));
}
