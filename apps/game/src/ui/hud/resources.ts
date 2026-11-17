import { itemCount, type ContentDatabase, type Snapshot } from '@mrak/core';

/** Below this fraction of max sanity the HUD stays visible and warns. */
export const LOW_SANITY = 0.4;

function stat(s: Snapshot, content: ContentDatabase, id: string): number {
  return s.stats[id] ?? content.statDecl(id).default;
}

/** Resource values for the HUD (until dedicated light/food systems exist). */
export function hudResources(s: Snapshot, content: ContentDatabase) {
  const sanity = stat(s, content, 'sanity');
  const sanityMax = stat(s, content, 'sanity-max');
  return {
    // Light the guardian carries tonight; food in the house store.
    light: itemCount(s, 'lamp-oil', 'pack'),
    food: itemCount(s, 'bread', 'storage'),
    faith: stat(s, content, 'faith'),
    corruption: stat(s, content, 'corruption'),
    sanity,
    sanityMax,
  };
}
