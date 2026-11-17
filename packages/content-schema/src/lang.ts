/**
 * The condition & effect mini-language. Spec: docs/systems/conditions-effects.md.
 *
 * Conditions and effects are JSON objects identified by their operator key, e.g.
 *   condition {"all":[{"flag":"witch-allied"},{"stat":"corruption",">=":40}]}
 *   effect    {"setFlag":"bridge-burned"}  /  {"addStat":"hysteria","value":10}
 */
import { z } from 'zod';
import {
  CheckSpec,
  CollectionCategory,
  DayPhase,
  Id,
  ItemPlace,
  LocKey,
  MonthDay,
  MoonPhase,
  Quantity,
  UsePeriod,
  ref,
} from './primitives';

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------

export const COMPARATORS = ['>=', '>', '<=', '<', '==', '!='] as const;
export type Comparator = (typeof COMPARATORS)[number];

const comparatorFields = {
  '>=': z.number().optional(),
  '>': z.number().optional(),
  '<=': z.number().optional(),
  '<': z.number().optional(),
  '==': z.number().optional(),
  '!=': z.number().optional(),
};

function exactlyOneComparator(value: { [K in Comparator]?: number | undefined }): boolean {
  return COMPARATORS.filter((op) => value[op] !== undefined).length === 1;
}

const exactlyOneMessage = { message: `exactly one comparator (${COMPARATORS.join(' ')}) required` };

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export const StatCondition = z
  .strictObject({
    stat: ref('stat'),
    /** Required when the stat has scope "villager". */
    villager: ref('villager').optional(),
    ...comparatorFields,
  })
  .refine(exactlyOneComparator, exactlyOneMessage);

export const Condition = z
  .union([
    z.strictObject({
      get all(): z.ZodArray<typeof Condition> {
        return z.array(Condition).min(1);
      },
    }),
    z.strictObject({
      get any(): z.ZodArray<typeof Condition> {
        return z.array(Condition).min(1);
      },
    }),
    z.strictObject({
      get not(): typeof Condition {
        return Condition;
      },
    }),
    z.strictObject({ flag: ref('flag') }),
    StatCondition,
    z.strictObject({ hasItem: ref('item'), qty: Quantity.optional(), in: ItemPlace.optional() }),
    z.strictObject({ clue: ref('clue') }),
    z.strictObject({ talent: ref('talent') }),
    z.strictObject({ calling: ref('calling') }),
    z.strictObject({ pactSigned: ref('pact') }),
    z.strictObject({ chapter: ref('festival') }),
    z.strictObject({ phase: DayPhase }),
    z.strictObject({ villagerAlive: ref('villager') }),
    z.strictObject({ possessionRevealed: ref('villager') }),
    z.strictObject({
      quest: ref('quest'),
      status: z.enum(['active', 'done', 'failed']).optional(),
      /** Stage id inside that quest (checked by the validator). */
      stage: Id.optional(),
    }),
    z.strictObject({
      mysteryConcluded: ref('mystery'),
      correct: z.boolean().optional(),
      culprit: ref('villager').optional(),
    }),
    /** Seeded random roll (IRandom "director" stream). */
    z.strictObject({ chance: z.number().min(0).max(1) }),
    /** Today (Julian) is within the range, inclusive; wraps the new year when `from` > `to`. */
    z.strictObject({ date: z.strictObject({ from: MonthDay, to: MonthDay }) }),
    /** Tonight's moon phase is one of these. */
    z.strictObject({ moon: z.array(MoonPhase).min(1) }),
    /** Today is the first day of the festival. */
    z.strictObject({ festivalDay: ref('festival') }),
    /** Collection progress of a category ("all" = complete). */
    z
      .strictObject({
        collection: CollectionCategory,
        ...comparatorFields,
        '>=': z.union([z.number(), z.literal('all')]).optional(),
      })
      .refine(
        (v) => COMPARATORS.filter((op) => v[op] !== undefined).length === 1,
        exactlyOneMessage,
      ),
  ])
  .meta({
    id: 'Condition',
    description: 'Condition mini-language (docs/systems/conditions-effects.md)',
  });
export type Condition = z.infer<typeof Condition>;

// ---------------------------------------------------------------------------
// Modifiers (passive effects while their source is active)
// ---------------------------------------------------------------------------

const modifierScope = {
  skill: ref('skill').optional(),
  context: ref('context').optional(),
};

export const Modifier = z
  .union([
    /** Add (or remove, if negative) Fate dice on matching checks. */
    z.strictObject({
      fateDice: z.int().min(-3).max(3),
      ...modifierScope,
      /** Dark talents: dice × min(cap, floor(debt / perDebt)) (progression.md T6). */
      perDebt: z.int().min(1).max(100).optional(),
    }),
    /** Add (or remove, if negative) Shadow dice on matching checks. */
    z.strictObject({ shadowDice: z.int().min(-3).max(3), ...modifierScope }),
    /** Flat bonus to a stat (e.g. +5 "sanity-max"). */
    z.strictObject({ statBonus: ref('stat'), value: z.number() }),
    /** Multiply a rate stat (e.g. "oil-consumption-rate" × 0.9). */
    z.strictObject({ multiply: ref('stat'), factor: z.number().positive().max(10) }),
    /** Convert one omen symbol on matching checks. */
    z.strictObject({
      convertOmen: z.enum(['bad-to-none', 'none-to-good', 'good-to-bad']),
      context: ref('context').optional(),
    }),
  ])
  .meta({ id: 'Modifier' });
export type Modifier = z.infer<typeof Modifier>;

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

const statTarget = { value: z.number(), villager: ref('villager').optional() };

export const Effect = z
  .union([
    z.strictObject({ setFlag: ref('flag') }),
    z.strictObject({ clearFlag: ref('flag') }),
    z.strictObject({ addStat: ref('stat'), ...statTarget }),
    z.strictObject({ setStat: ref('stat'), ...statTarget }),
    z.strictObject({ giveItem: ref('item'), qty: Quantity, to: ItemPlace.optional() }),
    z.strictObject({ takeItem: ref('item'), qty: Quantity, from: ItemPlace.optional() }),
    z.strictObject({ addClue: ref('clue') }),
    z.strictObject({ grantCollectible: ref('collectible') }),
    z.strictObject({ startQuest: ref('quest') }),
    z.strictObject({ startMystery: ref('mystery') }),
    z.strictObject({ failQuest: ref('quest') }),
    z.strictObject({ addDebt: ref('debt-source') }),
    z.strictObject({
      changeAffinity: ref('villager'),
      /** Omitted = affinity toward the guardian. */
      with: ref('villager').optional(),
      value: z.number().min(-100).max(100),
    }),
    /** Without a host, the demon picks the most vulnerable villager. */
    z.strictObject({ startPossession: ref('demon'), host: ref('villager').optional() }),
    /** A piece of a demon's true name, written into the journal. */
    z.strictObject({ nameFragment: ref('demon'), fragment: Id }),
    /** A villager dies (`cause`: cold, hunger, sickness, violence, drowning, suicide…). */
    z.strictObject({ killVillager: ref('villager'), cause: Id }),
    z.strictObject({ triggerEvent: ref('event') }),
    z.strictObject({ unlockTree: ref('tree') }),
    z.strictObject({ unlockRecipe: ref('recipe') }),
    /** `variant` is a variant id of that zone (checked by the validator). */
    z.strictObject({ setZoneVariant: ref('zone'), variant: Id }),
    /** A passive modifier active while the source (talent, gear, node…) is owned. */
    z.strictObject({ modifier: Modifier }),
    /** An activated ability with limited uses. */
    z.strictObject({
      ability: z.strictObject({
        uses: z.int().min(1).max(9),
        per: UsePeriod,
        check: CheckSpec.optional(),
        /** In-world minutes before it can be used again. */
        cooldown: z.int().min(1).max(10_080).optional(),
        /** Paid on use: Sanity points and/or lantern fuel (0–1 of a unit). */
        cost: z
          .strictObject({
            sanity: z.int().min(1).max(100).optional(),
            light: z.number().min(0.05).max(1).optional(),
          })
          .optional(),
        get effects(): z.ZodArray<typeof Effect> {
          return z.array(Effect).min(1);
        },
      }),
    }),
    /** Named engine rule implemented in core and declared in flags.json "rules". */
    z.strictObject({
      rule: ref('rule'),
      params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
    }),
    /** Grants a Revelation milestone (docs/systems/progression.md R1). */
    z.strictObject({ milestone: ref('milestone') }),
    /** Journal entries on demons and creatures (progression.md J2). */
    z.strictObject({ learnDemon: ref('demon') }),
    z.strictObject({ learnCreature: ref('creature') }),
    /** Show a narrative line (journal / dawn report). */
    z.strictObject({ narrate: LocKey }),
    z.strictObject({
      get if(): typeof Condition {
        return Condition;
      },
      get then(): z.ZodArray<typeof Effect> {
        return z.array(Effect).min(1);
      },
      get else(): z.ZodOptional<z.ZodArray<typeof Effect>> {
        return z.array(Effect).min(1).optional();
      },
    }),
  ])
  .meta({ id: 'Effect', description: 'Effect mini-language (docs/systems/conditions-effects.md)' });
export type Effect = z.infer<typeof Effect>;

export const Effects = z.array(Effect);
