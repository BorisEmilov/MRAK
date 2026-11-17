/**
 * The night expedition (docs/systems/night-exploration.md, combat.md → Implementation): the
 * night's origin of evil among candidates, encounters the director places on the map's spawn
 * points, combat and stealth actions resolved by checks (attributes, skills, talents, blessed
 * gear, omens), creature blows, the Last Breath — and death, which hands over to the lineage.
 */
import type { Creature, FearRules } from '@mrak/content-schema';
import { event, type CoreEvent, type GameTime } from '../events';
import { resolveCheck, type Difficulty } from '../guardian/checks';
import { progressionRules } from '../guardian/rules';
import { itemCount, takeItem } from '../items/inventory';
import { getStat, setStat } from '../state/stats';
import type { Encounter, WorldState } from '../state/world-state';
import { evaluatorAt } from '../village/common';
import { FearRuleError, isNightAt, weightedIndex, type FearContext } from '../fear/common';
import { pacingAt } from '../fear/director';
import { changeSanity } from '../fear/sanity';

export type NightAction = 'flash' | 'ritual' | 'strike' | 'dodge' | 'flee' | 'sneak';
const STEPS: readonly Difficulty[] = ['easy', 'average', 'hard', 'daunting', 'dire'];
const key = (p: { zone: string; poi: string }): string => `${p.zone}/${p.poi}`;

function nightRules(ctx: FearContext): FearRules['night'] {
  return ctx.rules.night;
}

/** Nightfall: a new objective — the origin is one of the candidates. */
export function startNight(draft: WorldState, ctx: FearContext, day: number): CoreEvent[] {
  const n = nightRules(ctx);
  const candidates = n.originCandidates.map(key);
  const origin = candidates[ctx.random('director').int(0, candidates.length - 1)] ?? null;
  draft.night = {
    ...draft.night,
    day,
    candidates,
    origin,
    checked: [],
    found: false,
    completed: false,
    encounters: [],
  };
  return [event('night/started', { candidates: candidates.length })];
}

/** Director tick at night: maybe an encounter at a spawn point of the guardian's zone. */
export function spawnTick(draft: WorldState, ctx: FearContext, a: number): CoreEvent[] {
  if (!isNightAt(a) || draft.currentZone === null) return [];
  const n = nightRules(ctx);
  const active = draft.night.encounters.filter((e) => e.state === 'active');
  if (active.length >= n.maxActive) return [];
  const spawns = n.spawns.filter((s) => s.zone === draft.currentZone);
  if (spawns.length === 0) return [];
  const rng = ctx.random('director');
  if (rng.next() >= n.spawnChance[pacingAt(a, ctx.rules).phase]) return [];
  const t = { day: Math.floor(a / 1440), minute: a % 1440 };
  const holds = evaluatorAt(draft, ctx.db, t.day, t.minute);
  const creatures = ctx.db
    .all('creatures')
    .filter(
      (c) => c.zones.includes(draft.currentZone ?? '') && (!c.activeWhen || holds(c.activeWhen)),
    );
  // Tension calls for the stronger ones.
  const weights = creatures.map((c) => 1 + (c.threat * draft.director.tension) / 100);
  const creature = creatures[weightedIndex(weights, rng)];
  const spawn = spawns[rng.int(0, spawns.length - 1)];
  if (!creature || !spawn) return [];
  const encounter: Encounter = {
    id: draft.night.nextEncounter,
    creature: creature.id,
    zone: spawn.zone,
    poi: spawn.poi,
    health: creature.health,
    state: 'active',
    dodge: false,
  };
  draft.night.nextEncounter += 1;
  draft.night.encounters.push(encounter);
  while (draft.night.encounters.length > 50) draft.night.encounters.shift();
  return [
    event('night/encounterSpawned', {
      encounter: encounter.id,
      creature: creature.id,
      zone: spawn.zone,
      poi: spawn.poi,
    }),
  ];
}

/** Reactions: the origin found, the return home, alerts from the village, dawn. */
export function nightAfter(
  draft: WorldState,
  ctx: FearContext,
  events: readonly CoreEvent[],
): CoreEvent[] {
  const n = nightRules(ctx);
  const night = draft.night;
  const out: CoreEvent[] = [];
  const away = draft.currentZone !== null && draft.currentZone !== n.homeZone;
  for (const e of events) {
    if (e.type === 'time/nightStarted') out.push(...startNight(draft, ctx, e.payload.day));
    else if (e.type === 'time/dawn') night.encounters = [];
    else if (e.type === 'world/poiInteracted') {
      const place = `${e.payload.zone}/${e.payload.poi}`;
      if (!night.candidates.includes(place) || night.checked.includes(place) || night.found)
        continue;
      night.checked.push(place);
      if (place === night.origin) {
        night.found = true;
        out.push(event('night/originFound', { zone: e.payload.zone, poi: e.payload.poi }));
        out.push(...ctx.apply(n.originEffects, 'night-origin'));
      } else out.push(event('night/originEmpty', { zone: e.payload.zone, poi: e.payload.poi }));
    } else if (e.type === 'world/zoneEntered' && e.payload.zone === n.homeZone) {
      if (night.found && !night.completed) {
        night.completed = true;
        night.encounters = night.encounters.filter((x) => x.zone === n.homeZone);
        out.push(event('night/completed', { day: night.day ?? 0 }));
        out.push(...ctx.apply(n.returnEffects, 'night-return'));
      }
    } else if (away && isNightAt(draft.clock.day * 1440 + draft.clock.minute)) {
      // The village keeps living: the guardian hears it from afar.
      const reason =
        e.type === 'villager/died'
          ? 'death'
          : e.type === 'hysteria/mobFormed'
            ? 'mob'
            : e.type === 'director/eventFired' && e.payload.zone === n.homeZone
              ? 'event'
              : e.type === 'night/encounterSpawned' && e.payload.zone === n.homeZone
                ? 'attack'
                : null;
      if (reason) out.push(event('village/alert', { reason }));
    }
  }
  return out;
}

function encounterOf(draft: WorldState, id: number): Encounter {
  const e = draft.night.encounters.find((x) => x.id === id);
  if (!e || e.state !== 'active') throw new FearRuleError('no such encounter');
  if (e.zone !== draft.currentZone) throw new FearRuleError('it is not here');
  return e;
}

/** A check of the guardian (attributes, skills, talents, blessed gear) with its omen. */
function roll(
  draft: WorldState,
  ctx: FearContext,
  skill: string,
  step: number,
  target: string,
): { success: boolean; events: CoreEvent[] } {
  const prules = progressionRules(ctx.db);
  if (!prules || draft.guardian.callingId === null)
    throw new FearRuleError('the guardian cannot act yet');
  const difficulty = STEPS[Math.min(STEPS.length - 1, Math.max(0, step))] ?? 'average';
  const r = resolveCheck(
    draft,
    ctx.db,
    prules,
    { skill, difficulty, context: 'vs-creature', target },
    ctx.random('director'),
  );
  return {
    success: r.result.success,
    events: [...r.events, ...ctx.apply(r.effects, `night:${skill}`)],
  };
}

const baseStep = (c: Creature): number => Math.max(0, c.threat - 1);

/** A combat or stealth action against an encounter. Fighting is one way; slipping past is another. */
export function nightAction(
  draft: WorldState,
  ctx: FearContext,
  id: number,
  action: NightAction,
  item?: string,
): CoreEvent[] {
  const n = nightRules(ctx);
  const enc = encounterOf(draft, id);
  const creature = ctx.db.get('creatures', enc.creature);
  const out: CoreEvent[] = [];
  let success: boolean;
  const resolve = (skill: string, step: number): boolean => {
    const r = roll(draft, ctx, skill, step, enc.creature);
    out.push(...r.events);
    return r.success;
  };
  switch (action) {
    case 'flash': {
      if (!draft.light.lit) throw new FearRuleError('the lantern is not lit');
      if (draft.light.fuel < n.flashFuel) throw new FearRuleError('not enough oil');
      draft.light.fuel = Math.max(0, draft.light.fuel - n.flashFuel);
      // Light-shy creatures flee (the scene's AI receives the flash); others only blink.
      success = creature.ai.fleeLight;
      out.push(event('night/flashed', { encounter: id }));
      break;
    }
    case 'ritual': {
      if (item === undefined || itemCount(draft, item, 'pack') === 0)
        throw new FearRuleError('not in the pack');
      takeItem(draft, ctx.db, item, 1, 'pack');
      out.push(event('inventory/itemRemoved', { item, qty: 1 }));
      const weak = creature.weaknesses.some((w) => w.item === item);
      success = weak && resolve(n.skills.ritual, baseStep(creature) - 2);
      if (success) enc.state = 'banished';
      break;
    }
    case 'strike': {
      success = resolve(n.skills.strike, baseStep(creature) + creature.resistanceTier - 1);
      if (success) {
        enc.health = Math.max(
          0,
          enc.health - n.strikeDamage * Math.max(0.25, 1 - creature.resistanceTier * 0.25),
        );
        if (enc.health === 0) enc.state = 'defeated';
      }
      break;
    }
    case 'dodge':
      success = resolve(n.skills.dodge, baseStep(creature));
      enc.dodge = success;
      break;
    case 'flee':
      success = resolve(n.skills.flee, baseStep(creature) + 1);
      if (success) enc.state = 'evaded';
      break;
    case 'sneak':
      success = resolve(n.skills.sneak, baseStep(creature));
      if (success) enc.state = 'evaded';
      break;
  }
  out.push(event('night/actionResolved', { encounter: id, action, success }));
  if (enc.state !== 'active')
    out.push(
      event('night/encounterEnded', { encounter: id, creature: enc.creature, how: enc.state }),
    );
  return out;
}

/** The creature reaches the guardian (reported by the scene). */
export function creatureStrikes(
  draft: WorldState,
  ctx: FearContext,
  id: number,
  now: GameTime,
): CoreEvent[] {
  const n = nightRules(ctx);
  const enc = encounterOf(draft, id);
  if (enc.dodge) {
    enc.dodge = false;
    return [event('night/dodged', { encounter: id })];
  }
  const creature = ctx.db.get('creatures', enc.creature);
  const [from, to] = setStat(
    draft,
    ctx.db,
    n.healthStat,
    getStat(draft, ctx.db, n.healthStat) - creature.ai.damage,
  );
  const out: CoreEvent[] = [
    event('state/statChanged', { stat: n.healthStat, from, to }),
    event('night/hurt', { encounter: id, health: to }),
    ...changeSanity(draft, ctx.db, -2),
  ];
  if (to > 0) return out;
  // Last Breath: survive broken, at home — or die, and the bloodline goes on.
  const breath = roll(draft, ctx, n.skills.lastBreath, 2, 'last-breath');
  out.push(...breath.events);
  if (breath.success) {
    setStat(draft, ctx.db, n.healthStat, n.lastBreathHealth);
    draft.currentZone = n.homeZone;
    draft.night.encounters = [];
    out.push(event('guardian/lastBreath', { health: n.lastBreathHealth }));
    return out;
  }
  draft.lineage.deaths.push({ day: now.day, cause: enc.creature });
  draft.lineage.awaitingHeir = true;
  draft.night.encounters = [];
  out.push(
    event('guardian/died', { cause: enc.creature }),
    event('lineage/heirNeeded', { deaths: draft.lineage.deaths.length }),
  );
  return out;
}
