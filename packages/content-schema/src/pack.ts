import { z } from 'zod';
import {
  Achievement,
  Attribute,
  Milestone,
  ProgressionRules,
  TalkTone,
  BloodlineNode,
  Calling,
  DarknessLevel,
  Sin,
  Skill,
  SpecializationTree,
  Talent,
  Virtue,
} from './entities/guardian';
import {
  Blessing,
  CabinetSet,
  Collectible,
  CursedObject,
  Gear,
  Item,
  ItemRules,
  PhotoLayer,
  Recipe,
} from './entities/items';
import { GlossaryEntry, Hint } from './entities/onboarding';
import {
  DebtCollection,
  DebtRemedy,
  DebtSource,
  DirectorEvent,
  Mystery,
  OmenTable,
  Pact,
  Quest,
} from './entities/narrative';
import {
  Creature,
  Demon,
  Festival,
  SeasonalEvent,
  Start,
  VillageBuilding,
  Villager,
  Zone,
} from './entities/world';
import { Routine, Task, Trait, VillageRules } from './entities/village';
import { FearRules } from './entities/fear';
import { LOC_KEY_PATTERN, type RefKind } from './primitives';
import type { Registry } from './registry';

/**
 * Every content collection: its folder name under `packages/content/data/`, the ref kind other
 * content uses to point at it, and its schema.
 */
export const COLLECTIONS = {
  attributes: { kind: 'attribute', schema: Attribute },
  skills: { kind: 'skill', schema: Skill },
  virtues: { kind: 'virtue', schema: Virtue },
  sins: { kind: 'sin', schema: Sin },
  callings: { kind: 'calling', schema: Calling },
  trees: { kind: 'tree', schema: SpecializationTree },
  talents: { kind: 'talent', schema: Talent },
  villagers: { kind: 'villager', schema: Villager },
  demons: { kind: 'demon', schema: Demon },
  creatures: { kind: 'creature', schema: Creature },
  items: { kind: 'item', schema: Item },
  gear: { kind: 'gear', schema: Gear },
  blessings: { kind: 'blessing', schema: Blessing },
  recipes: { kind: 'recipe', schema: Recipe },
  collectibles: { kind: 'collectible', schema: Collectible },
  'cursed-objects': { kind: 'cursed-object', schema: CursedObject },
  events: { kind: 'event', schema: DirectorEvent },
  quests: { kind: 'quest', schema: Quest },
  mysteries: { kind: 'mystery', schema: Mystery },
  pacts: { kind: 'pact', schema: Pact },
  'debt-sources': { kind: 'debt-source', schema: DebtSource },
  festivals: { kind: 'festival', schema: Festival },
  zones: { kind: 'zone', schema: Zone },
  'omen-tables': { kind: 'omen-table', schema: OmenTable },
  buildings: { kind: 'building', schema: VillageBuilding },
  'bloodline-nodes': { kind: 'bloodline-node', schema: BloodlineNode },
  'darkness-levels': { kind: 'darkness-level', schema: DarknessLevel },
  'seasonal-events': { kind: 'seasonal-event', schema: SeasonalEvent },
  achievements: { kind: 'achievement', schema: Achievement },
  glossary: { kind: 'glossary-term', schema: GlossaryEntry },
  hints: { kind: 'hint', schema: Hint },
  starts: { kind: 'start', schema: Start },
  traits: { kind: 'trait', schema: Trait },
  tasks: { kind: 'task', schema: Task },
  routines: { kind: 'routine', schema: Routine },
  'village-rules': { kind: 'village-rules', schema: VillageRules },
  'cabinet-sets': { kind: 'cabinet-set', schema: CabinetSet },
  'photo-layers': { kind: 'photo-layer', schema: PhotoLayer },
  'item-rules': { kind: 'item-rules', schema: ItemRules },
  milestones: { kind: 'milestone', schema: Milestone },
  'progression-rules': { kind: 'progression-rules', schema: ProgressionRules },
  'fear-rules': { kind: 'fear-rules', schema: FearRules },
  'talk-tones': { kind: 'talk-tone', schema: TalkTone },
  'debt-collections': { kind: 'debt-collection', schema: DebtCollection },
  'debt-remedies': { kind: 'debt-remedy', schema: DebtRemedy },
} as const satisfies Record<string, { kind: RefKind; schema: z.ZodType }>;

export type CollectionName = keyof typeof COLLECTIONS;
export const COLLECTION_NAMES = Object.keys(COLLECTIONS) as CollectionName[];

export type EntityOf<C extends CollectionName> = z.infer<(typeof COLLECTIONS)[C]['schema']>;

/** Locale file: flat map of localization key → non-empty text. */
export const LocaleFile = z
  .record(z.string().regex(LOC_KEY_PATTERN, 'invalid localization key'), z.string().min(1))
  .meta({ id: 'LocaleFile' });
export type LocaleFile = z.infer<typeof LocaleFile>;

/** A fully parsed content pack. */
export type ContentPack = {
  registry: Registry;
  locales: { en: LocaleFile };
} & { [C in CollectionName]: EntityOf<C>[] };

/** Where each parsed entity came from (for error messages). */
export type SourceMap = { [C in CollectionName]?: Record<string, string> };

export interface RawEntry {
  /** File path relative to the content root. */
  file: string;
  data: unknown;
}

/** Unparsed pack as loaded from disk (or built in memory by tests and the editor). */
export interface RawPack {
  registry: RawEntry;
  locales: { en: RawEntry };
  collections: Partial<Record<CollectionName, RawEntry[]>>;
  /** Zone maps and the files beside them; only Node tooling provides them (map validation). */
  maps?: RawMaps;
  /** Ink stories by id (`ink/<id>.ink`); only Node tooling provides them (dialogue validation). */
  ink?: Record<string, string>;
}

export interface RawMaps {
  /** Parsed `.tmj` files by path relative to the content root (e.g. "maps/village.tmj"). */
  maps: Record<string, unknown>;
  /** Every file under `maps/`, relative to the content root (tileset images…). */
  files: ReadonlySet<string>;
}

/**
 * A live content pack (docs/systems/seasonal-events.md → Implementation): data only, delivered
 * from the CDN after the client verified its hash and signature. It may only ADD entities of the
 * listed collections and NEW locale keys; the merged pack is validated like the bundled one.
 */
export const PACK_COLLECTIONS = [
  'mysteries',
  'events',
  'talents',
  'trees',
  'quests',
  'seasonal-events',
  'villagers',
] as const satisfies readonly CollectionName[];

export const ContentPackFile = z
  .strictObject({
    packId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    collections: z.partialRecord(z.enum(PACK_COLLECTIONS), z.array(z.unknown()).max(200)),
    locales: z.strictObject({ en: LocaleFile }),
  })
  .meta({ id: 'ContentPackFile' });
export type ContentPackFile = z.infer<typeof ContentPackFile>;

export class PackConflictError extends Error {}

/** The bundled raw pack plus live packs (new ids and new locale keys only). */
export function applyContentPacks(raw: RawPack, packs: readonly ContentPackFile[]): RawPack {
  const texts = { ...(raw.locales.en.data as Record<string, string>) };
  const collections = { ...raw.collections };
  for (const pack of packs) {
    for (const [key, text] of Object.entries(pack.locales.en)) {
      if (key in texts) throw new PackConflictError(`${pack.packId}: locale key "${key}" exists`);
      texts[key] = text;
    }
    for (const [name, data] of Object.entries(pack.collections)) {
      const c = name as (typeof PACK_COLLECTIONS)[number];
      collections[c] = [
        ...(collections[c] ?? []),
        { file: `packs/${pack.packId}@${pack.version}/${c}.json`, data },
      ];
    }
  }
  return { ...raw, locales: { en: { ...raw.locales.en, data: texts } }, collections };
}
