/** Narrative content: director events, quests, mysteries, pacts, debt sources, omen tables. */
import { z } from 'zod';
import { Condition, Effects } from '../lang';
import { Id, LocKey, entityBase, ref } from '../primitives';
import { ClockTime } from './village';

const Season = z.enum(['winter', 'spring', 'summer', 'autumn']);
const Bias = z.number().min(-5).max(5);

export const DirectorEvent = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    textKey: LocKey,
    category: z.enum(['noise', 'seed', 'hallucination', 'set-piece']),
    tags: z.array(Id).default([]),
    conditions: Condition.optional(),
    weight: z.number().positive().max(100),
    cooldownMinutes: z.int().min(0).max(100_000),
    tensionCost: z.int().min(0).max(100),
    zone: ref('zone').optional(),
    /** Who the event is aimed at: guardian-targeted events weigh more with Notice. */
    target: z.enum(['guardian', 'village']).default('guardian'),
    /** Hard time-of-day window (e.g. the bell at 03:33). */
    window: z.strictObject({ from: ClockTime, to: ClockTime }).optional(),
    /** Soft weighting by season, hour and the state of the world (event-director.md rule 6). */
    bias: z
      .strictObject({
        seasons: z.partialRecord(Season, z.number().min(0).max(20)).optional(),
        hours: z
          .array(
            z.strictObject({
              from: ClockTime,
              to: ClockTime,
              factor: z.number().min(0).max(100),
            }),
          )
          .optional(),
        corruption: Bias.optional(),
        hysteria: Bias.optional(),
        lowSanity: Bias.optional(),
      })
      .optional(),
    effects: Effects.default([]),
  })
  .refine((e) => e.category !== 'hallucination' || !e.effects.some((fx) => 'setFlag' in fx), {
    message:
      'hallucination events must not set world flags (docs/systems/event-director.md rule 5)',
  })
  .meta({ id: 'DirectorEvent' });

export const Quest = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    kind: z.enum(['chapter', 'villager', 'night', 'route', 'endless']),
    /** Quest log icon (an icon name of the ui-kit sprite). */
    icon: z
      .string()
      .regex(/^[a-z-]+\.[a-z0-9-]+$/)
      .optional(),
    /** Rival routes: neither can start while the other is active or done (docs/systems/quests.md). */
    excludes: z.array(ref('quest')).default([]),
    /** Starts by itself when this holds (and no rival route blocks it). */
    startWhen: Condition.optional(),
    stages: z
      .array(
        z.strictObject({
          id: Id,
          descKey: LocKey,
          objectives: z
            .array(
              z.strictObject({
                id: Id,
                descKey: LocKey,
                condition: Condition,
                optional: z.boolean().default(false),
                /** Map marker of the objective. */
                marker: z.strictObject({ zone: ref('zone'), poi: Id }).optional(),
              }),
            )
            .min(1),
          onComplete: Effects.default([]),
          /** Entering this stage cannot be undone (a candle goes out in the UI). */
          noReturn: z.boolean().default(false),
        }),
      )
      .min(1),
    failWhen: Condition.optional(),
  })
  .meta({ id: 'Quest' });

/** Proposition on the deduction board: "culprit:<villager>", "cause:<id>", "remedy:<id>". */
export const PROPOSITION_PATTERN =
  // eslint-disable-next-line security/detect-unsafe-regex -- separator-delimited id: linear (timed in docs/security/test-report.md)
  /^(culprit|cause|remedy|motive|opportunity):[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const Proposition = z
  .string()
  .regex(PROPOSITION_PATTERN, 'expected "culprit:<id>", "cause:<id>"…');

export const ClueSource = z.strictObject({
  kind: z.enum(['zone', 'villager', 'event', 'collectible']),
  ref: Id,
  /** Zone sources: the point of interest to investigate (any POI of the zone if absent). */
  poi: Id.optional(),
  check: z
    .strictObject({
      skill: ref('skill'),
      difficulty: z.enum(['easy', 'average', 'hard', 'daunting', 'dire']),
    })
    .optional(),
  when: Condition.optional(),
});

export const Clue = z.strictObject({
  id: Id,
  nameKey: LocKey,
  descKey: LocKey,
  reliability: z.enum(['solid', 'doubtful']),
  forbidden: z.boolean().default(false),
  sources: z.array(ClueSource).min(1),
  supports: z.array(Proposition).default([]),
  refutes: z.array(Proposition).default([]),
  /** A lying witness: the clue is retracted when this villager's secret is revealed. */
  liar: z.strictObject({ villager: ref('villager'), secret: Id }).optional(),
});

export const Mystery = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    questionKey: LocKey,
    chapter: ref('festival'),
    deadlineNight: z.int().min(1),
    suspects: z
      .array(
        z.strictObject({
          villager: ref('villager'),
          whyGuiltyKey: LocKey,
          whyInnocentKey: LocKey.optional(),
        }),
      )
      .min(2),
    causes: z.array(z.strictObject({ id: Id, nameKey: LocKey })).min(1),
    remedies: z
      .array(
        z.strictObject({
          id: Id,
          nameKey: LocKey,
          /** The final act that carries the conclusion out, right or wrong. */
          action: z.enum(['accuse', 'exorcise', 'burn', 'exhume', 'confront']).default('accuse'),
        }),
      )
      .min(1),
    clues: z.array(Clue).min(1),
    solution: z.strictObject({ culprit: ref('villager'), cause: Id, remedy: Id }),
    /** Consequences of committing a conclusion naming each suspect. */
    outcomes: z
      .array(
        z.strictObject({
          culprit: ref('villager'),
          descKey: LocKey,
          effects: Effects.min(1),
        }),
      )
      .min(1),
    unsolved: z.strictObject({ descKey: LocKey, effects: Effects.min(1) }),
    /** The right culprit but the wrong cause or remedy (replaces the culprit's outcome). */
    partial: z.strictObject({ descKey: LocKey, effects: Effects.min(1) }).optional(),
  })
  .meta({ id: 'Mystery' });

export const Creditor = z.enum(['horned-one', 'forest-spirit', 'aga', 'village', 'named-demon']);

export const DebtSource = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    creditor: Creditor,
    /** What kind of debt it is (docs/systems/progression.md D1). */
    kind: z.enum(['pact', 'favour', 'loan', 'promise', 'talent']),
    amount: z.int().min(1).max(100),
  })
  .meta({ id: 'DebtSource' });

export const DebtTier = z.enum(['minor', 'major', 'grave']);

/** A collection: what a creditor takes when the debt is called in (progression.md D4). */
export const DebtCollection = z
  .strictObject({
    ...entityBase,
    creditor: Creditor,
    severity: DebtTier,
    descKey: LocKey,
    weight: z.number().positive().max(100).default(1),
    when: Condition.optional(),
    effects: Effects.min(1),
  })
  .meta({ id: 'DebtCollection' });

/** A way to reduce a creditor's debt, at a cost (progression.md D5). */
export const DebtRemedy = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    descKey: LocKey,
    creditor: Creditor,
    reduce: z.int().min(1).max(100),
    /** Must hold to offer it (e.g. owning silver, being at the chapel by day). */
    when: Condition.optional(),
    /** The price: items taken, Sanity, Corruption… */
    cost: Effects.min(1),
  })
  .meta({ id: 'DebtRemedy' });

export const Pact = z
  .strictObject({
    ...entityBase,
    nameKey: LocKey,
    offerKey: LocKey,
    creditor: Creditor,
    zone: ref('zone'),
    window: z.strictObject({ from: ClockTime, to: ClockTime }),
    offerEffects: Effects.min(1),
    visibleTerms: z.array(LocKey).min(1),
    hiddenClauses: z.array(
      z.strictObject({
        id: Id,
        descKey: LocKey,
        trigger: z.union([
          z.strictObject({
            delayNights: z.strictObject({ min: z.int().min(1), max: z.int().min(1) }),
          }),
          z.strictObject({ when: Condition }),
        ]),
        effects: Effects.min(1),
      }),
    ),
    debt: ref('debt-source'),
    unlocksTree: ref('tree').optional(),
    /** Imposed on a guardian without a sin; reinforced (Corruption) if it is already theirs. */
    sin: ref('sin').optional(),
    /** Signed in blood: the price in Sanity or maximum Sanity. */
    blood: z.strictObject({
      stat: z.enum(['sanity', 'sanity-max']),
      amount: z.int().min(1).max(100),
    }),
  })
  .meta({ id: 'Pact' });

const OmenOutcome = z.strictObject({ descKey: LocKey, effects: Effects.default([]) });

export const OmenTable = z
  .strictObject({
    ...entityBase,
    context: ref('context'),
    successGood: OmenOutcome,
    successNone: OmenOutcome,
    successBad: OmenOutcome,
    failureGood: OmenOutcome,
    failureNone: OmenOutcome,
    failureBad: OmenOutcome,
    /** Extreme omens (rare); fall back to successGood / failureBad. */
    successGreat: OmenOutcome.optional(),
    failureDire: OmenOutcome.optional(),
  })
  .meta({ id: 'OmenTable' });

// Inferred types (output side: defaults applied).
export type DirectorEvent = z.infer<typeof DirectorEvent>;
export type Quest = z.infer<typeof Quest>;
export type Mystery = z.infer<typeof Mystery>;
export type Clue = z.infer<typeof Clue>;
export type Pact = z.infer<typeof Pact>;
export type DebtSource = z.infer<typeof DebtSource>;
export type OmenTable = z.infer<typeof OmenTable>;
export type DebtCollection = z.infer<typeof DebtCollection>;
export type DebtRemedy = z.infer<typeof DebtRemedy>;
export type DebtTier = z.infer<typeof DebtTier>;
