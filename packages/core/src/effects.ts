/**
 * EffectApplier: applies effect-language expressions (docs/systems/conditions-effects.md) to a
 * mutable draft of the WorldState and returns the domain events they produced. Callers clone the
 * snapshot first and commit the draft afterwards — snapshots themselves are never mutated.
 */
import type { Effect } from '@mrak/content-schema';
import { ConditionEvaluator } from './conditions';
import type { ContentDatabase } from './content/database';
import { event, type CoreEvent, type GameTime } from './events';
import type { RandomStreams } from './random';
import { getStat, setStat } from './state/stats';
import { giveItem, takeItem } from './items/inventory';
import { itemRules } from './items/rules';
import { emptyZoneState, type WorldState } from './state/world-state';
import { VillageRuleError } from './village/common';
import { killVillager } from './village/death';
import { startQuest } from './quests';
import { learn } from './guardian/journal';
import { awardMilestone } from './guardian/revelation';
import { progressionRules } from './guardian/rules';
import { chooseHost, learnFragment } from './occult/possession';

export class EffectError extends Error {
  override readonly name = 'EffectError';
}

export type RuleParams = Readonly<Record<string, string | number | boolean>>;

/** A named engine rule (declared in flags.json "rules"), implemented in core. */
export type RuleHandler = (
  draft: WorldState,
  params: RuleParams,
  ctx: EffectContext,
) => CoreEvent[] | undefined;
export type RuleRegistry = ReadonlyMap<string, RuleHandler>;

export interface EffectContext {
  db: ContentDatabase;
  random: RandomStreams;
  rules: RuleRegistry;
  /** In-world time the effects happen at (for logs). */
  now: GameTime;
  /** What produced the effects (talent id, event id, "command"…), used for modifiers/abilities. */
  source: string;
  /** Where `giveItem` without `to` sends items (village work: the house store). */
  itemTarget?: 'pack' | 'storage';
  /** Potency of given items (gathering). */
  potency?: number;
}

/** Guards against content loops (an event that triggers itself). */
export const MAX_EFFECT_DEPTH = 16;

const AFFINITY_MIN = -100;
const AFFINITY_MAX = 100;

function addUnique(list: string[], id: string): boolean {
  if (list.includes(id)) return false;
  list.push(id);
  return true;
}

export class EffectApplier {
  /** A cursed object found for the first time applies its `effects` (collection.md). */
  foundEffects(
    draft: WorldState,
    item: string,
    firstFound: boolean,
    ctx: EffectContext,
    depth = 0,
  ): CoreEvent[] {
    if (!firstFound) return [];
    const cursed = ctx.db.find('items', item)?.cursed;
    const def = cursed ? ctx.db.find('cursed-objects', cursed) : undefined;
    if (!def || def.effects.length === 0) return [];
    return this.apply(draft, def.effects, { ...ctx, source: def.id }, depth + 1);
  }

  apply(draft: WorldState, effects: readonly Effect[], ctx: EffectContext, depth = 0): CoreEvent[] {
    if (depth > MAX_EFFECT_DEPTH) {
      throw new EffectError(
        `effect chain deeper than ${String(MAX_EFFECT_DEPTH)} (loop in content?)`,
      );
    }
    const events: CoreEvent[] = [];
    effects.forEach((effect, index) => {
      events.push(...this.applyOne(draft, effect, ctx, depth, index));
    });
    return events;
  }

  private applyOne(
    draft: WorldState,
    effect: Effect,
    ctx: EffectContext,
    depth: number,
    index: number,
  ): CoreEvent[] {
    const { db } = ctx;

    if ('setFlag' in effect) {
      db.assertFlag(effect.setFlag);
      if (draft.flags[effect.setFlag]) return [];
      draft.flags[effect.setFlag] = true;
      return [event('state/flagSet', { flag: effect.setFlag })];
    }
    if ('clearFlag' in effect) {
      db.assertFlag(effect.clearFlag);
      if (!draft.flags[effect.clearFlag]) return [];
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- flags is a plain record
      delete draft.flags[effect.clearFlag];
      return [event('state/flagCleared', { flag: effect.clearFlag })];
    }
    if ('addStat' in effect || 'setStat' in effect) {
      const stat = 'addStat' in effect ? effect.addStat : effect.setStat;
      const base = 'addStat' in effect ? getStat(draft, db, stat, effect.villager) : 0;
      const [from, to] = setStat(draft, db, stat, base + effect.value, effect.villager);
      if (from === to) return [];
      return [
        event('state/statChanged', {
          stat,
          ...(effect.villager !== undefined ? { villager: effect.villager } : {}),
          from,
          to,
        }),
      ];
    }
    if ('giveItem' in effect) {
      const to = effect.to ?? ctx.itemTarget;
      const given = giveItem(draft, db, itemRules(db), effect.giveItem, effect.qty, {
        ...(to ? { to } : {}),
        ...(ctx.potency !== undefined ? { potency: ctx.potency } : {}),
      });
      return [
        ...given.events,
        ...this.foundEffects(draft, effect.giveItem, given.firstFound, ctx, depth),
      ];
    }
    if ('takeItem' in effect) {
      const taken = takeItem(draft, db, effect.takeItem, effect.qty, effect.from ?? 'any');
      const qty = taken.reduce((sum, t) => sum + t.qty, 0);
      return qty === 0 ? [] : [event('inventory/itemRemoved', { item: effect.takeItem, qty })];
    }
    if ('addClue' in effect) {
      const mysteryId = db.mysteryOfClue(effect.addClue);
      const mystery = (draft.mysteries[mysteryId] ??= {
        status: 'active',
        links: [],
        board: {},
        retracted: [],
        clues: [],
        conclusion: null,
      });
      if (!addUnique(mystery.clues, effect.addClue)) return [];
      return [event('mystery/clueFound', { mystery: mysteryId, clue: effect.addClue })];
    }
    if ('grantCollectible' in effect) {
      const collectible = db.get('collectibles', effect.grantCollectible);
      if (!addUnique(draft.guardian.collectibles, collectible.id)) return [];
      return [
        event('journal/collectibleGranted', { collectible: collectible.id }),
        ...this.apply(draft, collectible.grants, { ...ctx, source: collectible.id }, depth + 1),
      ];
    }
    if ('startQuest' in effect) return startQuest(draft, db, effect.startQuest);
    if ('failQuest' in effect) {
      const quest = draft.quests[effect.failQuest];
      if (!quest || quest.status !== 'active') return [];
      quest.status = 'failed';
      return [event('quest/failed', { quest: effect.failQuest })];
    }
    if ('startMystery' in effect) {
      db.get('mysteries', effect.startMystery);
      const existing = draft.mysteries[effect.startMystery];
      if (existing) return [];
      draft.mysteries[effect.startMystery] = {
        status: 'active',
        clues: [],
        conclusion: null,
        links: [],
        board: {},
        retracted: [],
      };
      return [event('mystery/started', { mystery: effect.startMystery })];
    }
    if ('addDebt' in effect) {
      const source = db.get('debt-sources', effect.addDebt);
      draft.debt.entries.push({
        source: source.id,
        amount: source.amount,
        creditor: source.creditor,
        at: ctx.now,
      });
      const total = draft.debt.entries.reduce((sum, e) => sum + e.amount, 0);
      const events = [event('debt/added', { source: source.id, amount: source.amount, total })];
      if (db.hasStat('debt')) {
        const [from, to] = setStat(draft, db, 'debt', total);
        if (from !== to) events.push(event('state/statChanged', { stat: 'debt', from, to }));
      }
      return events;
    }
    if ('changeAffinity' in effect) {
      const villager = draft.villagers[effect.changeAffinity];
      if (!villager) throw new EffectError(`unknown villager "${effect.changeAffinity}"`);
      const other = effect.with ?? 'guardian';
      const from = villager.affinity[other] ?? 0;
      const to = Math.min(AFFINITY_MAX, Math.max(AFFINITY_MIN, from + effect.value));
      if (from === to) return [];
      villager.affinity[other] = to;
      return [
        event('villager/affinityChanged', {
          villager: effect.changeAffinity,
          with: other,
          from,
          to,
        }),
      ];
    }
    if ('startPossession' in effect) {
      db.get('demons', effect.startPossession);
      const host = effect.host ?? chooseHost(draft, db, ctx.random.get('villagers'));
      if (host === null || !draft.villagers[host]?.alive) return [];
      if (draft.possessions.some((p) => p.host === host && p.demon === effect.startPossession))
        return [];
      draft.possessions.push({ demon: effect.startPossession, host, stage: 1, revealed: false });
      return [event('possession/began', { demon: effect.startPossession, host })];
    }
    if ('nameFragment' in effect) {
      try {
        return learnFragment(draft, db, effect.nameFragment, effect.fragment);
      } catch (err) {
        if (err instanceof RangeError) throw new EffectError(err.message);
        throw err;
      }
    }
    if ('killVillager' in effect) {
      try {
        return killVillager(draft, db, effect.killVillager, effect.cause, ctx.now);
      } catch (err) {
        if (err instanceof VillageRuleError) throw new EffectError(err.message);
        throw err;
      }
    }
    if ('triggerEvent' in effect) {
      const directorEvent = db.get('events', effect.triggerEvent);
      return [
        event('director/eventTriggered', { event: directorEvent.id }),
        ...this.apply(
          draft,
          directorEvent.effects,
          { ...ctx, source: directorEvent.id },
          depth + 1,
        ),
      ];
    }
    if ('unlockTree' in effect) {
      db.get('trees', effect.unlockTree);
      return addUnique(draft.guardian.unlockedTrees, effect.unlockTree)
        ? [event('unlock/tree', { tree: effect.unlockTree })]
        : [];
    }
    if ('unlockRecipe' in effect) {
      db.get('recipes', effect.unlockRecipe);
      return addUnique(draft.guardian.unlockedRecipes, effect.unlockRecipe)
        ? [event('unlock/recipe', { recipe: effect.unlockRecipe })]
        : [];
    }
    if ('setZoneVariant' in effect) {
      const zone = db.get('zones', effect.setZoneVariant);
      if (!zone.variants.some((v) => v.id === effect.variant)) {
        throw new EffectError(`zone "${zone.id}" has no variant "${effect.variant}"`);
      }
      const state = (draft.zones[zone.id] ??= emptyZoneState());
      if (state.variant === effect.variant) return [];
      state.variant = effect.variant;
      return [event('world/zoneVariantChanged', { zone: zone.id, variant: effect.variant })];
    }
    if ('milestone' in effect) return awardMilestone(draft, db, effect.milestone, ctx.source);
    if ('learnDemon' in effect || 'learnCreature' in effect) {
      const rules = progressionRules(db);
      if (!rules) return [];
      return 'learnDemon' in effect
        ? learn(draft, db, rules, 'demon', effect.learnDemon)
        : learn(draft, db, rules, 'creature', effect.learnCreature);
    }
    if ('narrate' in effect) {
      draft.narrations.push({ key: effect.narrate, at: ctx.now });
      return [event('state/narrated', { key: effect.narrate })];
    }
    if ('if' in effect) {
      const evaluator = new ConditionEvaluator(db, ctx.random.get('director'));
      const branch = evaluator.evaluate(effect.if, draft) ? effect.then : (effect.else ?? []);
      return this.apply(draft, branch, ctx, depth + 1);
    }
    if ('modifier' in effect) {
      const json = JSON.stringify(effect.modifier);
      const exists = draft.modifiers.some(
        (m) => m.source === ctx.source && JSON.stringify(m.modifier) === json,
      );
      if (exists) return [];
      draft.modifiers.push({ source: ctx.source, modifier: effect.modifier });
      return [event('state/modifierAdded', { source: ctx.source })];
    }
    if ('ability' in effect) {
      const id = `${ctx.source}#${String(index)}`;
      if (draft.abilities[id]) return [];
      const { uses, per, effects, cooldown, cost } = effect.ability;
      draft.abilities[id] = {
        source: ctx.source,
        uses,
        per,
        usesLeft: uses,
        effects,
        ...(cooldown !== undefined ? { cooldown } : {}),
        ...(cost !== undefined ? { cost } : {}),
      };
      return [event('state/abilityGranted', { ability: id, uses, per })];
    }
    // rule
    const params = effect.params ?? {};
    const handler = ctx.rules.get(effect.rule);
    const produced = handler ? (handler(draft, params, ctx) ?? []) : [];
    return [
      event('rule/invoked', { rule: effect.rule, params, handled: handler !== undefined }),
      ...produced,
    ];
  }
}
