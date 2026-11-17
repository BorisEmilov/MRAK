/** Things: items, gear, blessings, recipes, collectibles, cursed objects. */
import { z } from 'zod';
import { Condition, Effects, Modifier } from '../lang';
import { CheckSpec, Id, ItemStack, LocKey, Origin, entityBase, ref } from '../primitives';

/** UI icon name (ui-kit icon set; checked by the game's tests). */
export const IconRef = z.string().regex(/^[a-z-]+\.[a-z0-9-]+$/);

export const ItemCategory = z.enum([
  'consumable',
  'material',
  'herb',
  'ammo',
  'tool',
  'ritual',
  'relic',
  'quest',
]);

export const ItemTag = z.enum([
  'light',
  'holy',
  'herb',
  'dark',
  'warding',
  'food',
  'calming',
  'fever',
]);
export type ItemTag = z.infer<typeof ItemTag>;

export const Item = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    category: ItemCategory,
    icon: IconRef,
    stackSize: z.int().min(1).max(99),
    slotSize: z.int().min(1).max(4).default(1),
    /** Carry weight of one unit (docs/systems/inventory.md rule 2). */
    weight: z.number().min(0).max(20).default(1),
    /** Never stacks or merges (relics, cursed objects, the camera). */
    unique: z.boolean().default(false),
    /** The cursed object this item embodies (docs/systems/collection.md). */
    cursed: ref('cursed-object').optional(),
    tags: z.array(ItemTag).default([]),
    potency: z.int().min(1).max(3).optional(),
    useEffects: Effects.optional(),
  })
  .meta({ id: 'Item' });

export const GearSlot = z.enum(['lantern', 'weapon', 'amulet', 'tool', 'clothing']);

export const Gear = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    slot: GearSlot,
    blessingSlots: z.int().min(0).max(3),
    damageTier: z.int().min(0).max(4).optional(),
    lightRadius: z.int().min(0).max(12).optional(),
    effects: Effects.default([]),
    icon: IconRef.optional(),
    /** Workshop improvements (docs/systems/progression.md G5). */
    upgrades: z
      .array(
        z.strictObject({
          id: Id,
          nameKey: LocKey,
          materials: z.array(ItemStack).min(1),
          blessingSlots: z.int().min(0).max(2).default(0),
          effects: Effects.default([]),
        }),
      )
      .default([]),
  })
  .meta({ id: 'Gear' });

export const Blessing = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    origin: Origin,
    appliesTo: z.array(GearSlot).min(1),
    materials: z.array(ItemStack).min(1),
    /** Building required to apply it (omit = any hearth). */
    station: ref('building').optional(),
    check: CheckSpec,
    duration: z.union([
      z.strictObject({ uses: z.int().min(1).max(20) }),
      z.strictObject({ nights: z.int().min(1).max(30) }),
      z.strictObject({ permanent: z.literal(true) }),
    ]),
    effects: Effects.min(1),
    /** Holy and dark blessings drive each other out of an item (G3). */
    power: z.enum(['holy', 'dark', 'folk']).default('folk'),
    conflictsWith: z.array(ref('blessing')).default([]),
  })
  .meta({ id: 'Blessing' });

export const Recipe = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    inputs: z.array(ItemStack).min(1),
    station: ref('building').optional(),
    check: CheckSpec,
    minutes: z.int().min(5).max(720),
    outputs: z.array(ItemStack).min(1),
    visibleWhen: Condition.optional(),
    onBrew: Effects.optional(),
  })
  .meta({ id: 'Recipe' });

export const Collectible = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    kind: z.enum(['grimoire-page', 'folk-tale', 'song', 'relic', 'daguerreotype', 'letter']),
    origin: Origin,
    journalPages: z.int().min(1).max(3),
    forbidden: z.boolean().default(false),
    /** Earliest in-world year it can exist (e.g. daguerreotypes ≥ 1858). */
    minYear: z.int().min(1700).max(2000).optional(),
    grants: Effects.default([]),
    /** Told by a villager when the guardian talks to them (docs/systems/collection.md rule 1). */
    source: z
      .strictObject({
        talk: ref('villager'),
        when: Condition.optional(),
        minAffinity: z.int().min(-100).max(100).optional(),
      })
      .optional(),
  })
  .meta({ id: 'Collectible' });

export const CursedObject = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    memoryKey: LocKey,
    /** Scene of the playable memory (phase 19); until then the memory is shown as text. */
    memoryScene: Id.optional(),
    /** Applied the first time the memory is recalled. */
    memoryEffects: Effects.default([]),
    /** Sanity lost per 10 in-world minutes while carried unsealed. */
    whisper: z.int().min(0).max(10),
    sealedBy: ref('blessing').optional(),
    /** Applied once, when the object is first found. */
    effects: Effects.default([]),
    /** Passive while carried in the pack. */
    carried: z.array(Modifier).default([]),
    /** Passive while displayed in the cellar cabinet. */
    displayed: z.array(Modifier).default([]),
  })
  .meta({ id: 'CursedObject' });

/** Cursed objects that, displayed together in the cabinet, add their modifiers. */
export const CabinetSet = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    objects: z.array(ref('cursed-object')).min(2).max(6),
    modifiers: z.array(Modifier).min(1),
  })
  .meta({ id: 'CabinetSet' });

/** A hidden layer a daguerreotype may reveal (docs/systems/photography.md). */
export const PhotoLayer = z
  .strictObject({
    ...entityBase,
    kind: z.enum(['presence', 'possessed', 'symbol']),
    nameKey: LocKey,
    descKey: LocKey,
    target: z.union([
      z.strictObject({
        /** A villager id, or "*" for any villager. */
        villager: z.union([ref('villager'), z.literal('*')]),
        /** true = hosts any possession (hidden or not); a demon id = only that demon. */
        possessed: z.union([z.literal(true), ref('demon')]).optional(),
      }),
      /** `poi` is a POI id of that zone (checked by the validator). */
      z.strictObject({ zone: ref('zone'), poi: Id }),
      /** The place itself: any photo taken in the zone. */
      z.strictObject({ zone: ref('zone') }),
    ]),
    when: Condition.optional(),
    /** Applied the first time the layer is revealed. */
    effects: Effects.default([]),
  })
  .meta({ id: 'PhotoLayer' });

/** Numbers of the inventory, gathering, alchemy, collection and photography systems. */
export const ItemRules = z
  .strictObject({
    ...entityBase,
    inventory: z.strictObject({
      /** Zone where the house store, mortar and cabinet are reachable. */
      homeZone: ref('zone'),
      packSlots: z.int().min(1).max(40),
      carryWeight: z.number().min(1).max(200),
      encumberedSpeed: z.number().min(0.1).max(1),
      groundStacks: z.int().min(1).max(64),
      /** addStat multiplier of useEffects by potency 1, 2, 3. */
      potencyScale: z.tuple([z.number(), z.number(), z.number()]),
      /** Stats adding pack slots / carry weight (talents, gear). */
      slotsStat: ref('stat').optional(),
      weightStat: ref('stat').optional(),
      /** Stat drained by cursed objects' whispers. */
      whisperStat: ref('stat'),
    }),
    gathering: z.strictObject({
      boosts: z
        .array(
          z.strictObject({
            when: Condition,
            add: z.int().min(0).max(2).default(0),
            factor: z.number().min(1).max(3).default(1),
            labelKey: LocKey,
          }),
        )
        .default([]),
    }),
    alchemy: z.strictObject({
      failMinutes: z.int().min(0).max(240),
      maxIngredients: z.int().min(1).max(6),
      maxQty: z.int().min(1).max(10),
      journalSize: z.int().min(10).max(500),
    }),
    talk: z.strictObject({ affinityPerDay: z.int().min(0).max(20) }),
    cabinet: z.strictObject({ slots: z.int().min(1).max(24) }),
    photography: z.strictObject({
      camera: ref('item'),
      plate: ref('item'),
      minutes: z.int().min(0).max(240),
      albumSize: z.int().min(1).max(200),
      rangeTiles: z.int().min(1).max(12),
    }),
  })
  .meta({ id: 'ItemRules' });

// Inferred types (output side: defaults applied).
export type Item = z.infer<typeof Item>;
export type Gear = z.infer<typeof Gear>;
export type Blessing = z.infer<typeof Blessing>;
export type Recipe = z.infer<typeof Recipe>;
export type Collectible = z.infer<typeof Collectible>;
export type CursedObject = z.infer<typeof CursedObject>;
export type CabinetSet = z.infer<typeof CabinetSet>;
export type PhotoLayer = z.infer<typeof PhotoLayer>;
export type ItemRules = z.infer<typeof ItemRules>;
