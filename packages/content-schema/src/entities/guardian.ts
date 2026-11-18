/** Guardian-side content: attributes, skills, virtues/sins, callings, trees, talents, bloodline. */
import { z } from 'zod';
import { Condition, Effects } from '../lang';
import { ContentTier, Difficulty, Id, ItemStack, LocKey, entityBase, ref } from '../primitives';

const named = { nameKey: LocKey, descKey: LocKey };

export const Attribute = z.strictObject({ ...entityBase, ...named }).meta({ id: 'Attribute' });

export const Skill = z
  .strictObject({ ...entityBase, ...named, attribute: ref('attribute') })
  .meta({ id: 'Skill' });

export const Virtue = z.strictObject({ ...entityBase, ...named }).meta({ id: 'Virtue' });
export const Sin = z
  .strictObject({
    ...entityBase,
    ...named,
    /** Virtues this sin forbids when Corruption is high (docs/systems/progression.md V5). */
    blocks: z.array(ref('virtue')).default([]),
  })
  .meta({ id: 'Sin' });

export const Talent = z
  .strictObject({
    ...entityBase,
    ...named,
    /** Ranked talents (e.g. Grit) can be bought in several trees and stack. */
    ranked: z.boolean().default(false),
    effects: Effects.min(1),
  })
  .meta({ id: 'Talent' });

/** Grid cell: column letter + row number, e.g. "A1" … "C4". */
export const CELL_PATTERN = /^[A-F][1-6]$/;
export const Cell = z.string().regex(CELL_PATTERN, 'cell must look like "A1"');

export const TreeNode = z.strictObject({
  cell: Cell,
  talent: ref('talent'),
  /** Overrides the row cost (must keep row costs increasing). */
  cost: z.int().positive().optional(),
  /** Prerequisite cells — owning ANY one of them is enough. Empty = row-1 entry point. */
  requires: z.array(Cell).default([]),
  /** Node tier; defaults to the tree's. A demo tree may contain full-game nodes (e.g. rows 3–4). */
  tier: ContentTier.optional(),
});

export const SpecializationTree = z
  .strictObject({
    ...entityBase,
    ...named,
    kind: z.enum(['calling', 'dark']),
    /** Owning calling (calling trees only). */
    calling: ref('calling').optional(),
    /** Unlock condition (dark trees: a pact or betrothal). */
    unlock: Condition.optional(),
    /** Revelation cost per row, index 0 = row 1. Must increase strictly. */
    rowCosts: z.array(z.int().positive()).min(1).max(6),
    /** Corruption added per purchase, per row (dark trees). */
    rowCorruption: z.array(z.int().min(0)).optional(),
    /** Debt added per purchase, per row (dark trees), recorded under `debtSource`. */
    rowDebt: z.array(z.int().min(0)).optional(),
    debtSource: ref('debt-source').optional(),
    /** Effects applied on every purchase in this tree (e.g. erase a memory). */
    onEachPurchase: Effects.optional(),
    columns: z.int().min(1).max(6),
    nodes: z.array(TreeNode).min(1),
  })
  .meta({ id: 'SpecializationTree' });

export const Calling = z
  .strictObject({
    ...entityBase,
    ...named,
    attributeBonuses: z.array(ref('attribute')).length(2),
    callingSkills: z.array(ref('skill')).min(3).max(6),
    startingRanks: z.array(ref('skill')).length(3),
    trees: z.array(ref('tree')).min(1).max(3),
    startingGear: z.array(ItemStack),
    /** Gear owned and equipped at creation. */
    startingEquipment: z.array(ref('gear')).default([]),
    ability: z.strictObject({ nameKey: LocKey, descKey: LocKey, effects: Effects.min(1) }),
    defaultVirtue: ref('virtue'),
    defaultSin: ref('sin'),
    /** Starting Faith (docs/systems/corruption.md). */
    startingFaith: z.int().min(0).max(100),
    /** Locked until this Bloodline node is owned (an extra calling for the heirs). */
    bloodline: ref('bloodline-node').optional(),
  })
  .meta({ id: 'Calling' });

export const BloodlineNode = z
  .strictObject({
    ...entityBase,
    ...named,
    level: z.int().min(1).max(5),
    cost: z.int().positive(),
    requires: z.array(ref('bloodline-node')).default([]),
    exclusiveWith: z.array(ref('bloodline-node')).default([]),
    effects: Effects.min(1),
  })
  .meta({ id: 'BloodlineNode' });

export const DarknessLevel = z
  .strictObject({
    ...entityBase,
    ...named,
    level: z.int().min(1).max(10),
    legacyMultiplier: z.number().min(1).max(5),
    effects: Effects.min(1),
  })
  .meta({ id: 'DarknessLevel' });

export const Achievement = z
  .strictObject({
    ...entityBase,
    ...named,
    iconId: Id.optional(),
    hidden: z.boolean().default(false),
    condition: Condition,
  })
  .meta({ id: 'Achievement' });

/** Revelation milestones (docs/systems/progression.md R1–R3). Kill events can never be triggers. */
export const MILESTONE_TRIGGERS = [
  'time/dawn',
  'time/chapterEnded',
  'world/zoneEntered',
  'photo/layerRevealed',
  'journal/learned',
  'alchemy/discovered',
  'mystery/clueFound',
  'journal/collectibleGranted',
  'collection/memoryRecalled',
  'cabinet/setCompleted',
  'collection/completed',
] as const;

export const Milestone = z
  .strictObject({
    ...entityBase,
    /** Reason shown in the journal's Revelation ledger. */
    reasonKey: LocKey,
    amount: z.int().min(1).max(100),
    /** Granted automatically on this core event (payload fields must equal `match`). */
    on: z
      .strictObject({
        event: z.enum(MILESTONE_TRIGGERS),
        match: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      })
      .optional(),
    repeat: z.enum(['once', 'per-target', 'always']).default('once'),
  })
  .meta({ id: 'Milestone' });

const Derived = z.strictObject({
  stat: ref('stat'),
  attribute: ref('attribute'),
  per: z.number().min(-50).max(50),
});

/** Every number of guardian progression (docs/systems/progression.md). */
export const ProgressionRules = z
  .strictObject({
    ...entityBase,
    /** End of the free demo (docs/systems/store.md): nights survived before the demo-end card. */
    demo: z.strictObject({ nights: z.int().min(1).max(100) }).optional(),
    attributes: z.strictObject({
      base: z.int().min(1).max(6),
      playerPoints: z.int().min(0).max(3),
      creationMax: z.int().min(1).max(6),
      cap: z.int().min(1).max(6),
      absoluteMax: z.int().min(1).max(6),
      costPerRating: z.int().min(1).max(100),
      derived: z.array(Derived).default([]),
    }),
    skills: z.strictObject({
      callingCap: z.int().min(0).max(5),
      otherCap: z.int().min(0).max(5),
      maxCap: z.int().min(1).max(5),
      thresholdFactor: z.int().min(1).max(50),
      capCost: z.int().min(1).max(50),
      foreignCapExtra: z.int().min(0).max(50),
      practice: z.strictObject({
        failure: z.int().min(0).max(10),
        success: z.int().min(0).max(10),
        goodOmen: z.int().min(0).max(10),
        hardBonus: z.int().min(0).max(10),
        use: z.int().min(0).max(10),
      }),
      repeatMinutes: z.int().min(0).max(1440),
      dailyUseCap: z.int().min(0).max(100),
      /** Skill practiced by each plain use (S1). */
      uses: z.partialRecord(z.enum(['gather', 'talk', 'photograph', 'grind']), ref('skill')),
    }),
    trees: z.strictObject({
      secondNativeCost: z.int().min(0).max(500),
      foreignAccess: z.int().min(0).max(500),
      foreignPerTalent: z.int().min(0).max(100),
      softCapLifetime: z.int().min(0).max(100_000),
      softCapFactor: z.number().min(1).max(5),
    }),
    checks: z.strictObject({
      maxFate: z.int().min(1).max(20),
      difficulty: z.record(Difficulty, z.int().min(0).max(10)),
      lowSanity: z.strictObject({ below: z.number(), shadow: z.int().min(0).max(5) }),
      veryLowSanity: z.strictObject({ below: z.number(), shadow: z.int().min(0).max(5) }),
      darkness: z.int().min(0).max(5),
      sacred: z.int().min(-5).max(0),
      sacredZones: z.array(ref('zone')).default([]),
      faithCancels: z.number().min(0).max(100),
      corruptionTurns: z.number().min(0).max(100),
      extremeOmen: z.int().min(2).max(10),
    }),
    debt: z.strictObject({
      chancePer5: z.number().min(0).max(1),
      maxChance: z.number().min(0).max(1),
      major: z.int().min(1).max(500),
      grave: z.int().min(1).max(500),
      darkScalingMax: z.int().min(0).max(10),
    }),
    virtue: z.strictObject({
      faith: z.int().min(0).max(20),
      boonFate: z.int().min(0).max(3),
      virtuousAfter: z.int().min(1).max(20),
      virtuousFlag: ref('flag'),
      /** Applied (source "virtuous") while the flag holds; removed when the chapter ends. */
      virtuousEffects: Effects.default([]),
    }),
    sin: z.strictObject({
      corruption: z.int().min(0).max(20),
      takeoverMax: z.number().min(0).max(1),
      blockAt: z.number().min(0).max(100),
    }),
    notice: z.strictObject({
      learnDemon: z.int().min(0).max(50),
      forbiddenCollectible: z.int().min(0).max(50),
      occultismCheck: z.int().min(0).max(50),
      /** Skills whose checks are "studying the occult". */
      occultSkills: z.array(ref('skill')).default([]),
      darkTalent: z.int().min(0).max(50),
      dawnDecay: z.int().min(0).max(50),
      directorDivisor: z.number().min(1).max(1000),
    }),
    journal: z.strictObject({
      noteLength: z.int().min(10).max(2000),
      maxNotes: z.int().min(1).max(500),
    }),
    gear: z.strictObject({
      /** Zone with the village workshop and the chapel (blessing stations). */
      workshopZone: ref('zone'),
    }),
    /** Generations (docs/systems/lineage.md → Implementation). */
    lineage: z
      .strictObject({
        guardianStartAge: z.int().min(14).max(60),
        heirAge: z.int().min(12).max(21),
        retireAge: z.int().min(30).max(90),
        apprenticeMinAge: z.int().min(8).max(20),
        maxChildren: z.int().min(0).max(8),
        childChance: z.number().min(0).max(1),
        /** Each pact signed by a forebear is collected from the heir as this debt. */
        inheritedPactDebt: ref('debt-source'),
        /** Legacy = revelation ÷ perRevelation + Σ weight × deeds of the generation. */
        legacy: z.strictObject({
          perRevelation: z.int().min(1).max(100),
          chapter: z.int().min(0).max(50),
          mystery: z.int().min(0).max(50),
          building: z.int().min(0).max(50),
          route: z.int().min(0).max(50),
          year: z.int().min(0).max(50),
        }),
      })
      .optional(),
  })
  .meta({ id: 'ProgressionRules' });

/** A way of speaking to a villager (v1 dialogue surface for virtues and sins). */
export const TalkTone = z
  .strictObject({
    ...entityBase,
    textKey: LocKey,
    /** "virtue:<id>" / "sin:<id>" tags. */
    tags: z.array(z.string().regex(/^(virtue|sin):[a-z0-9-]+$/)).default([]),
    /** Affinity change toward the guardian (on top of the daily talk). */
    affinity: z.int().min(-20).max(20).default(0),
    /** Fear change of the villager. */
    fear: z.int().min(-20).max(20).default(0),
    effects: Effects.default([]),
    noSinTakeover: z.boolean().default(false),
    /** Offered only while this holds (e.g. a dark talent's mark). */
    when: Condition.optional(),
    order: z.int().min(0).max(100).default(0),
  })
  .meta({ id: 'TalkTone' });

// Inferred types (output side: defaults applied).
export type Attribute = z.infer<typeof Attribute>;
export type Skill = z.infer<typeof Skill>;
export type Virtue = z.infer<typeof Virtue>;
export type Sin = z.infer<typeof Sin>;
export type Talent = z.infer<typeof Talent>;
export type TreeNode = z.infer<typeof TreeNode>;
export type SpecializationTree = z.infer<typeof SpecializationTree>;
export type Calling = z.infer<typeof Calling>;
export type BloodlineNode = z.infer<typeof BloodlineNode>;
export type DarknessLevel = z.infer<typeof DarknessLevel>;
export type Achievement = z.infer<typeof Achievement>;
export type Milestone = z.infer<typeof Milestone>;
export type ProgressionRules = z.infer<typeof ProgressionRules>;
export type TalkTone = z.infer<typeof TalkTone>;
