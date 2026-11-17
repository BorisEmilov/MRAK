/**
 * Death, burial and the returned (docs/systems/villagers.md rules 10–11).
 */
import type { VillageRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent, type GameTime } from '../events';
import { getStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { dayPhaseAt, jdnToJulian } from '../time/calendar';
import {
  fearGainOf,
  hasItems,
  livingVillagers,
  takeItems,
  villageRules,
  VillageRuleError,
} from './common';

function addFear(draft: WorldState, db: ContentDatabase, villager: string, amount: number): void {
  if (amount === 0) return;
  setStat(draft, db, 'fear', getStat(draft, db, 'fear', villager) + amount, villager);
}

/**
 * A villager dies: tasks cleared, relationship edges removed both ways, grief spreads as fear.
 * Works without village rules too (no grief then).
 */
export function killVillager(
  draft: WorldState,
  db: ContentDatabase,
  villager: string,
  cause: string,
  at: GameTime,
): CoreEvent[] {
  const v = draft.villagers[villager];
  if (!v) throw new VillageRuleError(`unknown villager "${villager}"`);
  if (!v.alive) return [];
  const events: CoreEvent[] = [];
  for (const slot of ['day', 'night'] as const) {
    const task = v.tasks[slot];
    if (task) events.push(event('task/interrupted', { villager, task, cause: 'died' }));
  }
  const from = v.status;
  v.alive = false;
  v.status = 'dead';
  v.tasks = { day: null, night: null };
  v.progress = { day: 0, night: 0 };
  v.pending = {};
  v.stalled = false;
  v.panicked = false;
  v.death = { day: at.day, minute: at.minute, cause, burial: 'pending', nightsReturned: 0 };
  events.push(event('villager/statusChanged', { villager, from, to: 'dead' }));
  events.push(event('villager/died', { villager, cause }));

  const rules = villageRules(db);
  for (const other of livingVillagers(draft, db)) {
    const o = draft.villagers[other.id];
    if (!o) continue;
    if (rules) {
      const close = (o.affinity[villager] ?? v.affinity[other.id] ?? 0) >= rules.fear.closeAffinity;
      const base = close ? rules.fear.deathOfCloseRelation : rules.fear.deathInVillage;
      const tag = other.fears.includes('death') ? rules.fear.tagMultiplier : 1;
      addFear(draft, db, other.id, base * tag * fearGainOf(draft, db, rules, other));
    }
    const { [villager]: _edge, ...rest } = o.affinity;
    o.affinity = rest;
  }
  v.affinity = {};
  return events;
}

/** At dawn: the dead awaiting burial are buried, properly only by a sexton and a priest. */
export function buryAtDawn(
  draft: WorldState,
  db: ContentDatabase,
  rules: VillageRules,
): CoreEvent[] {
  const events: CoreEvent[] = [];
  const living = livingVillagers(draft, db);
  const able = (trait: string, fearOk: boolean): boolean =>
    living.some((l) => {
      const s = draft.villagers[l.id]?.status;
      return l.traits.includes(trait) && s !== 'sick' && (fearOk || s !== 'terrified');
    });
  const sexton = able(rules.death.sextonTrait, false);
  const priest = able(rules.death.priestTrait, true);
  for (const id of Object.keys(draft.villagers).sort()) {
    const death = draft.villagers[id]?.death;
    if (!death || death.burial !== 'pending') continue;
    const proper = sexton && priest && !rules.death.unquietCauses.includes(death.cause);
    death.burial = proper ? 'proper' : 'improper';
    events.push(event('villager/buried', { villager: id, proper }));
  }
  return events;
}

/** At nightfall: the badly buried rise, and every returned walking frightens the living. */
export function returnAtNightfall(
  draft: WorldState,
  db: ContentDatabase,
  rules: VillageRules,
  day: number,
): CoreEvent[] {
  const events: CoreEvent[] = [];
  let walking = 0;
  for (const id of Object.keys(draft.villagers).sort()) {
    const v = draft.villagers[id];
    const death = v?.death;
    if (!v || !death) continue;
    if (
      v.status === 'dead' &&
      death.burial === 'improper' &&
      day - death.day >= rules.death.returnAfterNights
    ) {
      v.status = 'returned';
      events.push(event('villager/statusChanged', { villager: id, from: 'dead', to: 'returned' }));
      events.push(event('villager/returned', { villager: id }));
    }
    if (v.status === 'returned') {
      death.nightsReturned += 1;
      walking += 1;
    }
  }
  if (walking > 0)
    for (const l of livingVillagers(draft, db)) {
      const tag = l.fears.includes('death') ? rules.fear.tagMultiplier : 1;
      addFear(
        draft,
        db,
        l.id,
        walking * rules.fear.returnedSighting * tag * fearGainOf(draft, db, rules, l),
      );
    }
  return events;
}

function isNight(draft: WorldState): boolean {
  const { day, minute } = draft.clock;
  return dayPhaseAt(minute, jdnToJulian(day).month) === 'night';
}

/**
 * The guardian buries a villager properly (by day): with rite items for the dead, with the
 * lay-to-rest items for a returned one.
 */
export function buryVillager(
  draft: WorldState,
  db: ContentDatabase,
  rules: VillageRules,
  villager: string,
): CoreEvent[] {
  const v = draft.villagers[villager];
  if (!v) throw new VillageRuleError(`unknown villager "${villager}"`);
  if (!v.death) throw new VillageRuleError('not dead');
  if (isNight(draft)) throw new VillageRuleError('not at night');
  const returned = v.status === 'returned';
  if (!returned && v.death.burial === 'proper') throw new VillageRuleError('already at rest');
  const items = returned ? rules.death.layToRestItems : rules.death.riteItems;
  // The guardian brings the rites: from the pack or the house store.
  const missing = hasItems(draft, items, 'any');
  if (missing) throw new VillageRuleError(`missing ${missing}`);
  takeItems(draft, db, items, 'any');
  const events: CoreEvent[] = items.map((s) =>
    event('inventory/itemRemoved', { item: s.item, qty: s.qty }),
  );
  v.death.burial = 'proper';
  if (returned) {
    v.status = 'dead';
    events.push(event('villager/statusChanged', { villager, from: 'returned', to: 'dead' }));
    events.push(event('villager/laidToRest', { villager }));
  } else events.push(event('villager/buried', { villager, proper: true }));
  return events;
}

/** A returned dead touched the guardian (reported by the presentation, at night only). */
export function encounterReturned(
  draft: WorldState,
  db: ContentDatabase,
  rules: VillageRules,
  villager: string,
): CoreEvent[] {
  if (draft.villagers[villager]?.status !== 'returned')
    throw new VillageRuleError('not one of the returned');
  if (!isNight(draft)) throw new VillageRuleError('the returned walk only at night');
  const [from, to] = setStat(
    draft,
    db,
    'sanity',
    getStat(draft, db, 'sanity') - rules.death.returnedSanityHit,
  );
  return [
    event('state/statChanged', { stat: 'sanity', from, to }),
    event('villager/returnedAttacked', { villager, sanity: to }),
  ];
}
