/**
 * Village life: traits, day/night tasks, routines and the tunable numbers of the village
 * simulation (docs/systems/villagers.md, docs/systems/tasks.md).
 */
import { z } from 'zod';
import { Condition, Effects } from '../lang';
import { Id, ItemStack, LocKey, entityBase, ref } from '../primitives';

/** A colour as "#rrggbb". */
export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'expected #rrggbb');

/** How a villager is drawn (world sprite and portrait come from the same data). */
export const VillagerLook = z.strictObject({
  skin: HexColor,
  hair: HexColor,
  clothes: HexColor,
  accent: HexColor,
  headwear: z.enum(['none', 'kerchief', 'cap', 'kalpak', 'kalimavkion']).default('none'),
  beard: z.boolean().default(false),
  build: z.enum(['slim', 'broad', 'stooped']).default('slim'),
});

/** Multiplier in a sane range (0.25 – 3). */
const Factor = z.number().min(0.25).max(3);

export const Trait = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    /** Task id → efficiency multiplier (trade traits act as the "trade match"). */
    taskEfficiency: z.record(Id, Factor).default({}),
    /** Multiplies every fear gain of the villager. */
    fearGain: Factor.default(1),
    /** Multiplies how much fear the villager spreads to others. */
    spread: Factor.default(1),
    hungerRate: Factor.default(1),
    coldRate: Factor.default(1),
  })
  .meta({ id: 'Trait' });

/** Where something happens: the villager's home, their trade place, or a village POI id. */
export const PlaceRef = z.union([z.literal('home'), z.literal('work'), Id]);

export const Task = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    /** UI icon name (ui-kit icon set; checked by the game's tests). */
    icon: z.string().regex(/^[a-z-]+\.[a-z0-9-]+$/),
    slot: z.enum(['day', 'night']),
    /** Hours of work (at efficiency 1) per batch; night tasks run the whole night. */
    hours: z.number().positive().max(24).default(4),
    /** Where the work happens: "home" or a village POI id. */
    place: z.union([z.literal('home'), Id]),
    /** Taken from the stores when a batch finishes (or, for night tasks, at nightfall). */
    consumes: z.array(ItemStack).default([]),
    /** Applied once per finished batch, at dusk. */
    output: Effects.default([]),
    /** Night watch defence per watcher at efficiency 1. */
    defence: z.number().min(0).max(100).default(0),
    /** Faith the worker gains per hour of this work (e.g. preparing rites at the church). */
    faith: z.number().min(0).max(20).default(0),
    requires: Condition.optional(),
  })
  .meta({ id: 'Task' });

export const Activity = z.enum([
  'sleep',
  'eat',
  'work',
  'pray',
  'socialize',
  'chores',
  'rest',
  'wander',
]);

/** "HH:MM", 00:00 – 23:59. */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

export const Routine = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    /** Blocks in time order; the last block whose `at` has passed is in force (wraps midnight). */
    blocks: z
      .array(z.strictObject({ at: ClockTime, activity: Activity, place: PlaceRef }))
      .min(1)
      .max(48),
    /** 0 = a base routine; > 0 = an override (highest wins while it applies). */
    priority: z.int().min(0).max(100).default(0),
    /** Villagers it applies to (overrides only; omitted = everyone). */
    villagers: z.array(ref('villager')).optional(),
    /** Weekdays it applies on (0 = Sunday … 6 = Saturday; overrides only). */
    days: z.array(z.int().min(0).max(6)).min(1).max(7).optional(),
    /**
     * Overrides only: the hours it covers (`from` inclusive, `to` exclusive, may wrap midnight).
     * Outside the window the base routine applies. Omitted = the whole day.
     */
    window: z.strictObject({ from: ClockTime, to: ClockTime }).optional(),
    when: Condition.optional(),
  })
  .meta({ id: 'Routine' });

const Rate = z.number().min(0).max(100);

/** Every number of the village simulation (one entry, id "default"). */
export const VillageRules = z
  .strictObject({
    ...entityBase,
    /** Zone whose POIs are the villagers' places. */
    zone: ref('zone'),
    fear: z.strictObject({
      contagionRate: z.number().min(0).max(1),
      contagionCap: Rate,
      proximityWeight: z.number().min(0).max(1),
      faithDamping: z.number().min(0).max(1),
      tagMultiplier: z.number().min(1).max(5),
      needFearPerHour: Rate,
      darkFearPerHour: Rate,
      solitudeFearPerHour: Rate,
      deathOfCloseRelation: Rate,
      deathInVillage: Rate,
      closeAffinity: z.int().min(0).max(100),
      returnedSighting: Rate,
      decayPerDawn: Rate,
      decayWhenHysterical: Rate,
      hysteriaThreshold: Rate,
      terrifiedAt: Rate,
      calmBelow: Rate,
      panicAt: Rate,
      nightTaskMaxFear: Rate,
      /** Shown fear of a villager with a hidden possession = true fear × this. */
      maskedFactor: z.number().min(0).max(1),
    }),
    needs: z.strictObject({
      hungerPerHour: Rate,
      mealRelief: Rate,
      mealItem: ref('item'),
      portionsPerItem: z.int().min(1).max(20),
      coldReliefByDay: Rate,
      coldPerNightHour: z.strictObject({
        winter: Rate,
        spring: Rate,
        summer: Rate,
        autumn: Rate,
      }),
      warmthAtHome: Rate,
      unheatedFactor: z.number().min(0).max(2),
      firewoodItem: ref('item'),
      firewoodPerHome: z.int().min(0).max(10),
      faithDecayPerDay: Rate,
      prayFaithPerHour: Rate,
      threshold: Rate,
    }),
    health: z.strictObject({
      lossPerHour: Rate,
      critical: Rate,
      regenPerHour: Rate,
      sickBelow: Rate,
      recoveredAt: Rate,
    }),
    tasks: z.strictObject({
      carryOver: z.number().min(0).max(1),
      repairStat: ref('stat'),
      repairDecayPerDawn: Rate,
      watchStat: ref('stat'),
    }),
    death: z.strictObject({
      unquietCauses: z.array(Id),
      returnAfterNights: z.int().min(0).max(40),
      sextonTrait: ref('trait'),
      priestTrait: ref('trait'),
      riteItems: z.array(ItemStack),
      layToRestItems: z.array(ItemStack),
      returnedSanityHit: Rate,
      /** POI where the dead lie (returned walk from here). */
      grave: Id,
    }),
    /** A hidden possession walks its host at night (a visible symptom; possession.md). */
    possession: z.strictObject({
      sleepwalkPlace: Id,
      sleepwalkFrom: ClockTime,
      sleepwalkTo: ClockTime,
    }),
    /** Growth over the years (docs/systems/village-growth.md → Implementation). */
    growth: z
      .strictObject({
        /** Villager task whose finished batches add labour days to construction. */
        constructionTask: ref('task'),
        /** Prosperity score thresholds of levels 1–5. */
        prosperityLevels: z.array(z.int().min(0).max(500)).length(5),
        /** Applied once when a prosperity level is first reached (traders, events, newcomers). */
        levelEffects: z
          .array(z.strictObject({ level: z.int().min(2).max(5), effects: Effects.min(1) }))
          .default([]),
        prosperity: z.strictObject({
          perResident: z.number().min(0).max(10),
          chapterObserved: z.int().min(0).max(100),
          death: z.int().min(0).max(100),
          lynching: z.int().min(0).max(100),
          debtCollected: z.int().min(0).max(100),
          /** Lost each year (upkeep): the village must keep growing. */
          decayPerYear: z.int().min(0).max(100),
        }),
        population: z.strictObject({
          adultAge: z.int().min(12).max(21),
          elderAge: z.int().min(40).max(80),
          maxAge: z.int().min(60).max(110),
          /** Yearly death chance per year above `elderAge`. */
          oldAgeDeath: z.number().min(0).max(1),
          marriageChance: z.number().min(0).max(1),
          /** Per couple per year, mother aged adultAge+2..42. */
          birthChance: z.number().min(0).max(1),
          /** Newcomers per year, by prosperity level 1–5. */
          outsiderChance: z.array(z.number().min(0).max(1)).length(5),
          /** Yearly flight chance per family while prosperity is level 1. */
          flightChance: z.number().min(0).max(1),
          cap: z.int().min(10).max(500),
        }),
        names: z.strictObject({
          female: z.array(LocKey).min(4),
          male: z.array(LocKey).min(4),
        }),
        trades: z.array(LocKey).min(1),
        /** Secrets newcomers bring (revealed by talking, or by the years). */
        secrets: z
          .array(
            z.strictObject({
              id: Id,
              descKey: LocKey,
              minProsperity: z.int().min(1).max(5).default(1),
            }),
          )
          .min(1),
      })
      .optional(),
  })
  .meta({ id: 'VillageRules' });

export type VillagerLook = z.infer<typeof VillagerLook>;
export type Trait = z.infer<typeof Trait>;
export type Task = z.infer<typeof Task>;
export type Activity = z.infer<typeof Activity>;
export type PlaceRef = z.infer<typeof PlaceRef>;
export type Routine = z.infer<typeof Routine>;
export type VillageRules = z.infer<typeof VillageRules>;
