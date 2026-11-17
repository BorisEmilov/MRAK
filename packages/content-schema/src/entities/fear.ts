/**
 * Fear engine rules: sanity tiers and shocks, hysteria and witch hunts, the event director and
 * evidence (docs/systems/sanity.md, hysteria.md, event-director.md → Implementation).
 */
import { z } from 'zod';
import { Effects } from '../lang';
import { Difficulty, Id, LocKey, entityBase, ref } from '../primitives';
import { ItemTag } from './items';
import { ClockTime } from './village';

export const PacingPhase = z.enum(['settle', 'build', 'peak', 'release']);
export type PacingPhase = z.infer<typeof PacingPhase>;

/** Perception effects of a sanity tier, applied by the presentation layer. */
export const PerceptionEffect = z.enum(['filter', 'whispers', 'moving-objects', 'staring']);
export type PerceptionEffect = z.infer<typeof PerceptionEffect>;

export const EvidenceMethod = z.enum(['photograph', 'witness', 'relic']);
export type EvidenceMethod = z.infer<typeof EvidenceMethod>;

const Chance = z.number().min(0).max(1);
const Factor = z.number().min(0).max(100);
const PerPhase = <T extends z.ZodType>(t: T) =>
  z.strictObject({ settle: t, build: t, peak: t, release: t });

/** Evidence odds: chance of "presence" for a real event and for a hallucination. */
const Odds = z.strictObject({ real: Chance, hallucination: Chance });

/** A procedural mystery: its roles are bound to living villagers when it is generated. */
export const MysteryTemplate = z.strictObject({
  id: Id,
  nameKey: LocKey,
  questionKey: LocKey,
  suspects: z.int().min(2).max(4),
  /** Villagers with these traits are preferred as the culprit. */
  culpritTraits: z.array(ref('trait')).default([]),
  whyGuiltyKey: LocKey,
  whyInnocentKey: LocKey,
  causes: z.array(z.strictObject({ id: Id, nameKey: LocKey })).min(1),
  remedies: z
    .array(
      z.strictObject({
        id: Id,
        nameKey: LocKey,
        action: z.enum(['accuse', 'exorcise', 'burn', 'exhume', 'confront']).default('accuse'),
      }),
    )
    .min(1),
  solution: z.strictObject({ cause: Id, remedy: Id }),
  clues: z
    .array(
      z.strictObject({
        id: Id,
        nameKey: LocKey,
        descKey: LocKey,
        reliability: z.enum(['solid', 'doubtful']),
        /** culprit: points at the culprit; innocent: clears each false suspect (one per suspect);
         *  cause: names the cause; liar: a suspect with a secret accuses another falsely. */
        about: z.enum(['culprit', 'innocent', 'cause', 'liar']),
        /** Where it is found; without it, from a witness (talking to a villager). */
        place: z.strictObject({ zone: ref('zone'), poi: Id }).optional(),
        check: z.strictObject({ skill: ref('skill'), difficulty: Difficulty }).optional(),
      }),
    )
    .min(3),
  deadlineNight: z.int().min(1),
  right: z.strictObject({ descKey: LocKey, effects: Effects.min(1) }),
  wrong: z.strictObject({ descKey: LocKey, effects: Effects.min(1) }),
  unsolved: z.strictObject({ descKey: LocKey, effects: Effects.min(1) }),
});
export type MysteryTemplate = z.infer<typeof MysteryTemplate>;

export const FearRules = z
  .strictObject({
    ...entityBase,
    sanity: z.strictObject({
      /** Ordered from mildest to worst; `below` is a fraction of max Sanity. */
      tiers: z
        .array(
          z.strictObject({
            below: z.number().gt(0).max(1),
            effects: z.array(PerceptionEffect).min(1),
            whisperKeys: z.array(LocKey).default([]),
          }),
        )
        .min(1),
      shocks: z.strictObject({
        demonLearned: z.int().min(0).max(100),
        forbiddenPerNotice: z.number().min(0).max(10),
        /** Losses of the `sanity-shock` engine rule by cause. */
        causes: z.record(z.string().regex(/^[a-z-]+$/), z.int().min(1).max(100)),
      }),
      restore: z.strictObject({
        homeZones: z.array(ref('zone')).min(1),
        dawnAtHome: z.int().min(0).max(100),
        faithDivisor: z.int().min(1).max(1000),
        lightPerHour: z.number().min(0).max(20),
        restPerHour: z.number().min(0).max(50),
      }),
    }),
    hysteria: z.strictObject({
      stages: z.strictObject({
        rumours: z.int().min(1).max(100),
        accusations: z.int().min(1).max(100),
        mob: z.int().min(1).max(100),
      }),
      decayPerDawn: z.number().min(0).max(50),
      lowVillageSanity: z.strictObject({ below: z.number().min(0).max(100), factor: Factor }),
      incidents: z.strictObject({
        death: z.number().min(0).max(100),
        absentAtDawn: z.number().min(0).max(100),
      }),
      suspicionStat: ref('stat'),
      guardianStat: ref('stat'),
      guardianSuspicion: z.strictObject({
        absentAtDawn: z.number().min(0).max(100),
        broken: z.number().min(0).max(100),
        failedConfrontation: z.number().min(0).max(100),
      }),
      rumourStrength: z.number().min(0).max(100),
      /** Suspicion multiplier per trait (the "odd": widows, herb-women, outsiders). */
      traitMultipliers: z.record(ref('trait'), z.number().min(0).max(10)),
      /** Rumour weight multiplier of the guardian. */
      guardianRumourWeight: z.number().min(0).max(10),
      accusationSuspicion: z.number().min(0).max(100),
      guardianAccusableAt: z.number().min(0).max(100),
      mob: z.strictObject({
        skill: ref('skill'),
        context: ref('context'),
        difficulty: Difficulty,
        /** Fear at which a villager joins the mob (its size). */
        joinFear: z.number().min(0).max(100),
        lynchAt: z.number().min(0).max(100),
        beatAt: z.number().min(0).max(100),
        calmRelief: z.number().min(0).max(100),
        sparedRelief: z.number().min(0).max(100),
        targetDiedRelief: z.number().min(0).max(100),
        /** A beaten villager: fear gained and health lost. */
        beaten: z.strictObject({
          fear: z.number().min(0).max(100),
          health: z.number().min(0).max(100),
        }),
        guardianBeatenEffects: Effects.min(1),
        exploitEffects: Effects.min(1),
      }),
      lynching: z.strictObject({
        cause: z.string().regex(/^[a-z-]+$/),
        aftermathRelief: z.number().min(0).max(100),
        innocentEffects: Effects.min(1),
        complicitEffects: Effects.default([]),
      }),
    }),
    director: z.strictObject({
      /** Relative weights of noise and seeds; the hallucination share comes from Sanity. */
      mix: z.strictObject({ noise: Factor, seed: Factor }),
      hallucination: z.strictObject({
        base: Chance,
        /** Sanity under which the share grows by 1% per point. */
        pivot: z.number().min(0).max(200),
        max: Chance,
        /** Extra share per point of (Corruption − Faith) above 0, /100. */
        perCorruption: Chance,
      }),
      fire: z.strictObject({
        base: Chance,
        tensionDivisor: z.number().positive().max(1000),
        recentPenalty: Chance,
        min: Chance,
        max: Chance,
      }),
      targets: z.strictObject({
        settle: z.number().min(0).max(100),
        buildFrom: z.number().min(0).max(100),
        buildTo: z.number().min(0).max(100),
        peak: z.number().min(0).max(100),
        release: z.number().min(0).max(100),
      }),
      settleShare: z.number().min(0).max(0.9),
      peakAround: ClockTime,
      peakHalfWidth: z.int().min(0).max(240),
      /** Tension lost per tick, by phase (slow while building, fast in the release). */
      decayPerTick: PerPhase(z.number().min(0).max(100)),
      budget: z.strictObject({
        perNight: z.number().min(0).max(1000),
        shares: PerPhase(Chance),
        chapterIntensity: z.record(ref('festival'), z.number().min(0).max(5)).default({}),
      }),
      peakCost: z.int().min(1).max(100),
      quiet: z.strictObject({ min: z.int().min(0).max(240), max: z.int().min(0).max(240) }),
      zoneFactor: Factor,
      offZoneFactor: Factor,
      logSize: z.int().min(0).max(1000),
    }),
    possession: z.strictObject({
      /** Nightly (03:33) advance chance: base + perRank × rank, clamped. */
      advance: z.strictObject({ base: Chance, perRank: Chance, min: Chance, max: Chance }),
      /** Host weight = 1 + fear × fear/100 + lowFaith × (1 − faith/100). */
      vulnerability: z.strictObject({ fear: Factor, lowFaith: Factor, faithStat: ref('stat') }),
      /** Chance per dawn that an unpossessed villager shows a false symptom. */
      falseSymptomChance: Chance,
    }),
    exorcism: z.strictObject({
      skill: ref('skill'),
      context: ref('context'),
      difficulty: Difficulty,
      preparation: z.strictObject({
        maxItems: z.int().min(1).max(8),
        holyTag: ItemTag,
        circleItem: ref('item'),
      }),
      sanityPerTaunt: z.number().min(0).max(50),
      maxTaunts: z.int().min(1).max(8),
      expulsion: z.strictObject({
        rounds: z.int().min(1).max(20),
        goal: z.number().min(1).max(1000),
        press: z.strictObject({ progress: z.number().min(0), sanity: z.number().min(0) }),
        hold: z.strictObject({ progress: z.number().min(0), sanity: z.number().min(0) }),
        /** The demon pushes back rank × this × (0.5–1.5) each round. */
        pushPerRank: z.number().min(0).max(100),
        /** The rite fails when Sanity falls under this fraction of max. */
        breakBelow: Chance,
      }),
      success: z.strictObject({ hostFear: z.number().min(0).max(100) }),
      failure: z.strictObject({ guardianJumpChance: Chance, sanity: z.number().min(0).max(100) }),
      /** Binding instead of casting out: the guardian owes the demon. */
      bindDebt: ref('debt-source'),
    }),
    /** Dark powers and the Church: reputation stats and who hates whom. */
    factions: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z-]+$/),
          nameKey: LocKey,
          stat: ref('stat'),
          /** Factions that lose `hostility` × each reputation point this one gains. */
          hostileTo: z.array(z.string().regex(/^[a-z-]+$/)).default([]),
          hostility: z.number().min(0).max(2),
        }),
      )
      .min(1),
    pacts: z.strictObject({ sinReinforce: z.number().min(0).max(50) }),
    sacrifices: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z-]+$/),
          nameKey: LocKey,
          zone: ref('zone'),
          /** Offered goods; the quantity grows by `escalation` × times already made. */
          items: z.array(z.strictObject({ item: ref('item'), qty: z.int().min(1).max(99) })),
          escalation: z.number().min(0).max(5),
          /** Needs a target villager (never a child) who dies after `doomDays`. */
          targeted: z.boolean().default(false),
          doomDays: z.strictObject({ min: z.int().min(1), max: z.int().min(1) }).optional(),
          effects: Effects.min(1),
          witnessChance: Chance,
          witnessedHysteria: z.number().min(0).max(100),
          witnessedSuspicion: z.number().min(0).max(100),
        }),
      )
      .min(1),
    /** Night exploration (docs/systems/night-exploration.md, combat.md → Implementation). */
    night: z.strictObject({
      homeZone: ref('zone'),
      healthStat: ref('stat'),
      spawns: z.array(z.strictObject({ zone: ref('zone'), poi: Id })).min(1),
      /** Places the evil may come from tonight; one is chosen at nightfall. */
      originCandidates: z.array(z.strictObject({ zone: ref('zone'), poi: Id })).min(2),
      originEffects: Effects.default([]),
      returnEffects: Effects.default([]),
      /** Encounter chance per director tick, by pacing phase; at most `maxActive` at once. */
      spawnChance: z.strictObject({ settle: Chance, build: Chance, peak: Chance, release: Chance }),
      maxActive: z.int().min(1).max(10),
      flashFuel: Chance,
      strikeDamage: z.number().min(0).max(200),
      skills: z.strictObject({
        strike: ref('skill'),
        dodge: ref('skill'),
        flee: ref('skill'),
        sneak: ref('skill'),
        ritual: ref('skill'),
        lastBreath: ref('skill'),
      }),
      /** Health after surviving the Last Breath (wakes at home). */
      lastBreathHealth: z.number().min(1).max(100),
    }),
    evidence: z.strictObject({
      windowMinutes: z.int().min(1).max(10_080),
      photograph: Odds,
      witness: Odds.extend({ minAffinity: z.number().min(-100).max(100) }),
      relic: Odds.extend({ tag: ItemTag }),
    }),
    /** The Endless Chronicle (docs/systems/endless-chronicle.md → Implementation). */
    endless: z
      .strictObject({
        maxDarkness: z.int().min(1).max(10),
        /** Procedural mysteries: roles bound to living villagers each year. */
        mysteries: z.array(MysteryTemplate).min(1),
        possessions: z.strictObject({
          maxRank: z.int().min(1).max(4),
          perYear: z.strictObject({ min: z.int().min(0).max(5), max: z.int().min(0).max(5) }),
          /** From this Darkness level two lesser demons share one host. */
          combineFrom: z.int().min(1).max(10),
        }),
        /** Harvests and disasters: one is drawn each year. */
        harvests: z
          .array(
            z.strictObject({
              id: Id,
              nameKey: LocKey,
              weight: z.number().positive().max(100),
              minDarkness: z.int().min(0).max(10).default(0),
              effects: Effects.min(1),
            }),
          )
          .min(1),
        /** Long-term goals on the Chronicle board. */
        goals: z
          .array(
            z.strictObject({
              id: Id,
              category: z.enum(['village', 'lineage', 'collection']),
              nameKey: LocKey,
              metric: z.enum([
                'prosperity',
                'population',
                'building-levels',
                'generation',
                'mysteries-solved',
                'collection-found',
                'darkness-best',
                'endless-years',
              ]),
              target: z.number().positive(),
              legacy: z.int().min(0).max(500).default(0),
            }),
          )
          .min(1),
        /** Relic talents: an alternative for one tree cell, unlocked at a Darkness level. */
        relics: z
          .array(
            z.strictObject({
              id: Id,
              darkness: z.int().min(1).max(10),
              tree: ref('tree'),
              cell: z.string().regex(/^[A-F][1-6]$/),
              talent: ref('talent'),
            }),
          )
          .default([]),
      })
      .optional(),
  })
  .refine((r) => r.director.quiet.min <= r.director.quiet.max, {
    message: 'director.quiet.min must not exceed max',
  })
  .refine(
    (r) =>
      r.hysteria.stages.rumours < r.hysteria.stages.accusations &&
      r.hysteria.stages.accusations < r.hysteria.stages.mob,
    { message: 'hysteria stages must rise: rumours < accusations < mob' },
  )
  .refine((r) => r.sanity.tiers.every((t, i, a) => i === 0 || t.below < (a[i - 1]?.below ?? 1)), {
    message: 'sanity tiers must go from mildest (highest `below`) to worst',
  })
  .meta({ id: 'FearRules' });

export type FearRules = z.infer<typeof FearRules>;
