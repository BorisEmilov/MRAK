import { z } from 'zod';

/** Stable content id: kebab-case ASCII (e.g. `baba-neda`). */
// eslint-disable-next-line security/detect-unsafe-regex -- separator-delimited id: linear (timed in docs/security/test-report.md)
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Localization key: dot-separated kebab-case segments (e.g. `villager.baba-neda.name`). */
// eslint-disable-next-line security/detect-unsafe-regex -- separator-delimited id: linear (timed in docs/security/test-report.md)
export const LOC_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

/**
 * Every kind of thing a piece of content can reference by id. Each reference is checked by
 * the cross-reference validator (`validate/refs.ts`).
 */
export const REF_KINDS = [
  // content collections
  'attribute',
  'skill',
  'virtue',
  'sin',
  'calling',
  'tree',
  'talent',
  'villager',
  'demon',
  'creature',
  'item',
  'gear',
  'blessing',
  'recipe',
  'collectible',
  'cursed-object',
  'event',
  'quest',
  'mystery',
  'pact',
  'debt-source',
  'festival',
  'zone',
  'omen-table',
  'building',
  'bloodline-node',
  'darkness-level',
  'seasonal-event',
  'achievement',
  'glossary-term',
  'hint',
  'start',
  'trait',
  'task',
  'routine',
  'village-rules',
  'cabinet-set',
  'photo-layer',
  'item-rules',
  'milestone',
  'progression-rules',
  'fear-rules',
  'talk-tone',
  'debt-collection',
  'debt-remedy',
  // nested ids
  'clue',
  // registry (flags.json)
  'flag',
  'stat',
  'rule',
  'context',
  // localization (locales/en.json)
  'loc',
] as const;
export type RefKind = (typeof REF_KINDS)[number];

/** Metadata attached to reference schemas; read by the reference walker. */
export const refRegistry = z.registry<{ refKind: RefKind }>();

/** A reference to another piece of content (or a flag, stat, localization key…). */
export function ref(kind: RefKind) {
  const pattern = kind === 'loc' ? LOC_KEY_PATTERN : ID_PATTERN;
  const message =
    kind === 'loc' ? 'must be a localization key like "area.item.name"' : 'must be a kebab-case id';
  // `.meta()` clones the schema, so it must come before `.register()`.
  return z
    .string()
    .regex(pattern, message)
    .meta({ description: `Reference to a ${kind}` })
    .register(refRegistry, { refKind: kind });
}

export const Id = z.string().regex(ID_PATTERN, 'must be a kebab-case id');
export const LocKey = ref('loc');

/** Release tier: demo content must never depend on full-game content. */
export const ContentTier = z.enum(['demo', 'full']);
export type ContentTier = z.infer<typeof ContentTier>;

/** Where a piece of lore comes from (see docs: [F] / [H] / [I]). */
export const Origin = z.enum(['folklore', 'history', 'invented']);

/** Fields shared by every top-level content entity. */
export const entityBase = {
  id: Id,
  tier: ContentTier,
};

export const Quantity = z.int().min(1).max(999);
export const ItemStack = z.strictObject({ item: ref('item'), qty: Quantity });

export const Difficulty = z.enum(['easy', 'average', 'hard', 'daunting', 'dire']);
export const CheckSpec = z.strictObject({ skill: ref('skill'), difficulty: Difficulty });

export const UsePeriod = z.enum(['day', 'night', 'chapter', 'year', 'generation']);
export const DayPhase = z.enum(['dawn', 'day', 'dusk', 'night']);
export const MoonPhase = z.enum([
  'new',
  'waxing-crescent',
  'first-quarter',
  'waxing-gibbous',
  'full',
  'waning-gibbous',
  'last-quarter',
  'waning-crescent',
]);
/** A recurring month/day "MM-DD" (Julian in game rules). */
export const MonthDay = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'expected MM-DD');
export const ItemPlace = z.enum(['pack', 'storage']);
/** Collection categories (docs/systems/collection.md rule 6). */
export const CollectionCategory = z.enum([
  'herbs',
  'recipes',
  'grimoire',
  'relics',
  'tales',
  'songs',
  'cursed',
  'photos',
  'memories',
]);
