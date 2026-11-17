/** The world: villagers, demons, creatures, zones, festivals, buildings, seasonal events. */
import { z } from 'zod';
import { Condition, Effects } from '../lang';
import { Id, ItemStack, LocKey, MonthDay, Origin, entityBase, ref } from '../primitives';
import { VillagerLook } from './village';

export const FearTag = z.enum([
  'water',
  'fire',
  'dark',
  'death',
  'aga',
  'debt',
  'witchcraft',
  'solitude',
  'god-abandonment',
  'mill',
  'being-ridiculed',
]);

export const Villager = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    tradeKey: LocKey,
    bioKey: LocKey,
    age: z.int().min(0).max(110),
    sex: z.enum(['female', 'male']),
    /** Traits (data/traits): task efficiency, fear and needs; also used by hysteria templates. */
    traits: z.array(ref('trait')).default([]),
    /** Ink story spoken when the guardian talks to them (packages/content/ink/<id>.ink). */
    dialogue: Id.optional(),
    fears: z.array(FearTag).min(1),
    startingFear: z.int().min(0).max(100).default(10),
    relationships: z
      .array(z.strictObject({ villager: ref('villager'), affinity: z.int().min(-100).max(100) }))
      .default([]),
    secrets: z
      .array(
        z.strictObject({
          id: Id,
          descKey: LocKey,
          revealWhen: Condition,
          /** Applied when the secret is revealed (a confession). */
          effects: Effects.default([]),
        }),
      )
      .default([]),
    /** POI id (village zone) of their house. */
    home: Id,
    /** POI id (village zone) where they ply their trade. */
    work: Id,
    /** Base daily routine (docs/systems/villagers.md → Routines). */
    routine: ref('routine'),
    look: VillagerLook,
  })
  .meta({ id: 'Villager' });

export const Demon = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    epithetKey: LocKey,
    trueNameKey: LocKey,
    loreKey: LocKey,
    rank: z.int().min(1).max(4),
    origin: Origin,
    seal: z.strictObject({ formKey: LocKey, mediumKey: LocKey }).nullable(),
    symptoms: z
      .array(
        z.strictObject({
          stage: z.int().min(1).max(5),
          descKey: LocKey,
          /** Extra requirement to notice the symptom (talent, skill…). */
          visibleWhen: Condition.optional(),
        }),
      )
      .min(1),
    weaknesses: z.array(z.strictObject({ descKey: LocKey, item: ref('item').optional() })).min(1),
    desires: z.array(LocKey).min(1),
    maxStage: z.int().min(1).max(5).default(5),
    /** Lines the demon speaks during a rite. */
    phrases: z.array(LocKey).min(1),
    /** Taunt templates by fact of the playthrough (docs/systems/exorcism.md → Confrontation). */
    taunts: z.strictObject({
      pact: LocKey,
      sacrifice: LocKey,
      death: LocKey,
      lynching: LocKey,
      debt: LocKey,
    }),
    /** Pieces of the true name, found in grimoires, graves, plates and confessions. */
    fragments: z
      .array(
        z.strictObject({
          id: Id,
          source: z.enum(['grimoire', 'grave', 'photograph', 'confession']),
          textKey: LocKey,
        }),
      )
      .min(1),
  })
  .meta({ id: 'Demon' });

export const Creature = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    origin: Origin,
    threat: z.int().min(1).max(5),
    health: z.int().positive(),
    resistanceTier: z.int().min(0).max(4),
    weaknesses: z
      .array(
        z.strictObject({
          kind: z.enum(['item', 'light', 'sound', 'fire', 'rite', 'time']),
          item: ref('item').optional(),
          descKey: LocKey,
        }),
      )
      .min(1),
    zones: z.array(ref('zone')).min(1),
    activeWhen: Condition.optional(),
    /** Night AI (docs/systems/night-exploration.md → Implementation); distances in tiles. */
    ai: z
      .strictObject({
        speed: z.number().min(0.1).max(10).default(1.5),
        sight: z.number().min(0).max(30).default(4),
        /** Hearing range per point of noise. */
        hearing: z.number().min(0).max(5).default(0.8),
        /** Runs from the lantern's light. */
        fleeLight: z.boolean().default(true),
        /** Seconds a hunt lasts without sensing the guardian. */
        memory: z.number().min(0).max(60).default(4),
        damage: z.number().min(0).max(100).default(15),
      })
      .prefault({}),
  })
  .meta({ id: 'Creature' });

/** Kinds of points of interest (docs/systems/night-exploration.md); drive icons and the map. */
export const PoiKind = z.enum([
  'woodpile',
  'church',
  'tavern',
  'house',
  'mill',
  'cemetery',
  'grave',
  'well',
  'shrine',
  'bonfire',
  'oil-store',
  'herbs',
  'ruin',
  'samodiva-circle',
  'crossroads',
  'gate',
]);

/** The verb shown in the interaction prompt (matches the HUD interaction actions). */
export const PoiAction = z.enum([
  'talk',
  'gather',
  'pray',
  'ritual',
  'investigate',
  'use',
  'rest',
  'photograph',
]);

export const Poi = z.strictObject({
  id: Id,
  kind: PoiKind,
  nameKey: LocKey,
  descKey: LocKey.optional(),
  action: PoiAction,
  /** Applied by `interactPoi` (once per chronicle when `once`). */
  effects: Effects.default([]),
  once: z.boolean().default(true),
  /** Ink story spoken here (packages/content/ink/<id>.ink). */
  dialogue: Id.optional(),
  /** A place where a pact can be signed (docs/systems/progression.md D6). */
  pact: ref('pact').optional(),
  /** A gathering point (docs/systems/inventory.md → Gathering points). */
  gather: z
    .strictObject({
      item: ref('item'),
      qty: z.int().min(1).max(10),
      potency: z.int().min(1).max(3).default(1),
      /** The plant is there only while this holds (dates, moon phases…). */
      when: Condition.optional(),
      /** Days before it can be gathered again (0 = once per day). */
      regrowDays: z.int().min(0).max(365).default(1),
      /** Blossom colour drawn in the world. */
      tint: z
        .string()
        .regex(/^#[0-9a-f]{6}$/)
        .default('#d8c060'),
    })
    .optional(),
});

/** Path graph of a zone: nodes (clearings, exits) and edges (paths) that can open or close. */
export const PathGraph = z.strictObject({
  nodes: z
    .array(z.strictObject({ id: Id, exit: z.boolean().default(false) }))
    .min(1)
    .max(64),
  edges: z
    .array(
      z.strictObject({
        id: Id,
        from: Id,
        to: Id,
        /** Open only while this holds (e.g. night-only or high-corruption paths). */
        when: Condition.optional(),
        /** Edges sharing a group are alternatives: exactly one is chosen (re-chosen hourly at night). */
        shift: Id.optional(),
      }),
    )
    .max(128),
});

export const Zone = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    /** Path of the Tiled map, relative to the content root. */
    map: z.string().min(1),
    defaultVariant: Id,
    variants: z
      .array(
        z.strictObject({
          id: Id,
          nameKey: LocKey,
          /** First variant (in order) whose condition holds is used. */
          when: Condition.optional(),
          map: z.string().min(1).optional(),
        }),
      )
      .min(1),
    /** Night fog density (0 = none, 1 = thick). */
    fog: z.number().min(0).max(1).default(0.5),
    pois: z.array(Poi).max(128).default([]),
    paths: PathGraph.default({ nodes: [{ id: 'all', exit: true }], edges: [] }),
  })
  .meta({ id: 'Zone' });

/** How a new chronicle begins: where, when, and with what (docs/systems/light.md). */
export const Start = z
  .strictObject({
    ...entityBase,
    zone: ref('zone'),
    /** Spawn id in the zone's map (default: "default"). */
    spawn: Id.default('default'),
    /** Minute of the first day. */
    minute: z.int().min(0).max(1439).default(480),
    /** Lantern equipped at the start. */
    lantern: ref('gear').optional(),
    /** In-world date (Julian) of the first day (default: Christmas 1834); the prologue is 1779. */
    date: z
      .strictObject({
        year: z.int().min(1700).max(1900),
        month: z.int().min(1).max(12),
        day: z.int().min(1).max(31),
      })
      .optional(),
    effects: Effects.default([]),
  })
  .meta({ id: 'Start' });

export const JulianDate = z.strictObject({
  month: z.int().min(1).max(12),
  day: z.int().min(1).max(31),
});

const Difficulty = z.enum(['easy', 'average', 'hard', 'daunting', 'dire']);

/** A festival rite: the player picks one option; a check (rolled with omen) may decide it. */
export const Rite = z.strictObject({
  id: Id,
  nameKey: LocKey,
  descKey: LocKey,
  /** First chapter night it can be performed. */
  fromNight: z.int().min(1).default(1),
  options: z
    .array(
      z.strictObject({
        id: Id,
        labelKey: LocKey,
        check: z.strictObject({ skill: ref('skill'), difficulty: Difficulty }).optional(),
        effects: Effects.default([]),
        /** Applied instead of `effects` when the check fails. */
        failEffects: Effects.default([]),
      }),
    )
    .min(1),
});

export const Festival = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    origin: Origin,
    /** In-world date (Julian / Old Style) or a movable feast relative to Orthodox Easter. */
    start: z.union([
      z.strictObject({ fixed: JulianDate }),
      z.strictObject({ easterOffsetDays: z.int().min(-70).max(70) }),
    ]),
    nights: z.int().min(1).max(14),
    nightLengthMultiplier: z.number().min(0.5).max(2).default(1),
    specialNights: z
      .array(z.strictObject({ night: z.int().min(1), event: ref('event') }))
      .default([]),
    /** What hunts during the chapter (shown on the chapter card). */
    threatKey: LocKey.optional(),
    /** Creatures favoured by the night spawns while the chapter runs. */
    threats: z.array(ref('creature')).default([]),
    /** Chapter rules: applied when it starts; their modifiers end with it. */
    rules: Effects.default([]),
    /** Missions started with the chapter. */
    quests: z.array(ref('quest')).default([]),
    /** Rites and decisions of the chapter: one option each, once per chapter. */
    rites: z.array(Rite).default([]),
    /** Applied when the chapter ends (its own Revelation milestones). */
    onEnd: Effects.default([]),
  })
  .meta({ id: 'Festival' });

export const VillageBuilding = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    icon: z
      .string()
      .regex(/^[a-z-]+\.[a-z0-9-]+$/)
      .optional(),
    /** Village POI where it stands (the build view on the map). */
    poi: Id.optional(),
    levels: z
      .array(
        z.strictObject({
          level: z.int().min(1).max(5),
          descKey: LocKey,
          cost: z.strictObject({
            materials: z.array(ItemStack),
            labourDays: z.int().min(0),
          }),
          requires: Condition.optional(),
          /** Lowest village prosperity level (1–5) that allows this level. */
          minProsperity: z.int().min(1).max(5).default(1),
          /** Prosperity score the level adds. */
          prosperity: z.int().min(0).max(100).default(10),
          /** A blood price: the sacrifice (fear rules) made when the work starts. */
          blood: z
            .string()
            .regex(/^[a-z-]+$/)
            .optional(),
          effects: Effects.min(1),
        }),
      )
      .min(1),
  })
  .meta({ id: 'VillageBuilding' });

/** Month-day in the real-world Gregorian calendar, "MM-DD". */

export const SeasonalEvent = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    /** Real-world (Gregorian, UTC) window; may wrap the new year. */
    window: z.strictObject({ start: MonthDay, end: MonthDay }),
    recurring: z.boolean().default(true),
    entitlement: z.union([z.literal('free'), z.string().regex(/^sku-[a-z0-9-]+$/)]),
    festival: ref('festival').optional(),
    effects: Effects.min(1),
    /** Rewards on activation: Legacy for the family and a cosmetic title (never power). */
    legacy: z.int().min(0).max(100).default(0),
    cosmeticKey: LocKey.optional(),
  })
  .meta({ id: 'SeasonalEvent' });

// Inferred types (output side: defaults applied).
export type Villager = z.infer<typeof Villager>;
export type Demon = z.infer<typeof Demon>;
export type Creature = z.infer<typeof Creature>;
export type Zone = z.infer<typeof Zone>;
export type Poi = z.infer<typeof Poi>;
export type PoiKind = z.infer<typeof PoiKind>;
export type PathGraph = z.infer<typeof PathGraph>;
export type Start = z.infer<typeof Start>;
export type Festival = z.infer<typeof Festival>;
export type Rite = z.infer<typeof Rite>;
export type VillageBuilding = z.infer<typeof VillageBuilding>;
export type SeasonalEvent = z.infer<typeof SeasonalEvent>;
