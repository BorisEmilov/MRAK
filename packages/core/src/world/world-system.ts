/**
 * Exploration system: lantern oil, darkness, noise, explored cells and points of interest
 * (docs/systems/light.md, docs/systems/night-exploration.md). Called by `Game`.
 */
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { effectiveStat, getStat, setStat } from '../state/stats';
import { emptyZoneState, type Snapshot, type WorldState } from '../state/world-state';
import type { ClockState } from '../time/clock';
import { itemCount, takeItem } from '../items/inventory';
import { revealCells } from './exploration';
import { burnOil, darknessDrain, OIL_ITEM } from './light';

/** Noise lost per in-world minute. */
export const NOISE_DECAY_PER_MINUTE = 2;

export class WorldRuleError extends Error {}

/** In-world minutes between two clock states (including fractions). */
export function elapsedMinutes(from: ClockState, to: ClockState): number {
  return (to.day - from.day) * 1440 + to.minute + to.subMinute - (from.minute + from.subMinute);
}

export interface ExplorationPlan {
  light: WorldState['light'];
  explorer: WorldState['explorer'];
  unitsUsed: number;
  wentOut: boolean;
  sanityLoss: number;
}

/** What `minutes` of time do to the lantern, darkness and noise (no mutation). */
export function planExploration(
  state: Snapshot | WorldState,
  db: ContentDatabase,
  minutes: number,
): ExplorationPlan {
  const light = { ...state.light };
  const explorer = { noise: Math.max(0, state.explorer.noise - NOISE_DECAY_PER_MINUTE * minutes) };
  let unitsUsed = 0;
  let wentOut = false;
  if (light.lit) {
    const rate = db.hasStat('oil-consumption-rate')
      ? effectiveStat(state, db, 'oil-consumption-rate')
      : 1;
    const burn = burnOil(light, minutes, itemCount(state, OIL_ITEM, 'pack'), rate);
    light.fuel = burn.fuel;
    light.lit = burn.lit;
    unitsUsed = burn.unitsUsed;
    wentOut = burn.wentOut;
  }
  let sanityLoss = 0;
  if (light.inDarkness) {
    const drain = darknessDrain(light.darkMinutes + minutes);
    sanityLoss = drain.loss;
    light.darkMinutes = drain.remainder;
  }
  return { light, explorer, unitsUsed, wentOut, sanityLoss };
}

/** Applies a plan to a draft; returns the events. */
export function applyExploration(
  draft: WorldState,
  db: ContentDatabase,
  plan: ExplorationPlan,
): CoreEvent[] {
  const events: CoreEvent[] = [];
  draft.light = plan.light;
  draft.explorer = plan.explorer;
  if (plan.unitsUsed > 0) {
    const left = takeOil(draft, db, plan.unitsUsed);
    events.push(event('inventory/itemRemoved', { item: OIL_ITEM, qty: plan.unitsUsed }));
    events.push(event('light/oilPoured', { left }));
  }
  if (plan.wentOut) {
    events.push(event('light/lanternLit', { lit: false }));
    events.push(event('light/lanternOut', {}));
  }
  if (plan.sanityLoss > 0 && db.hasStat('sanity')) {
    const [from, to] = setStat(draft, db, 'sanity', getStat(draft, db, 'sanity') - plan.sanityLoss);
    if (from !== to) events.push(event('state/statChanged', { stat: 'sanity', from, to }));
    events.push(event('light/darknessTick', { loss: plan.sanityLoss, sanity: to }));
  }
  return events;
}

/** Burns oil from the pack (the lantern never reaches the house store). */
function takeOil(draft: WorldState, db: ContentDatabase, units: number): number {
  takeItem(draft, db, OIL_ITEM, units, 'pack');
  return itemCount(draft, OIL_ITEM, 'pack');
}

// ------------------------------------------------------------------ commands

export function equipLantern(
  draft: WorldState,
  db: ContentDatabase,
  gear: string | null,
): CoreEvent[] {
  if (gear !== null) {
    const def = db.get('gear', gear);
    if (def.slot !== 'lantern') throw new WorldRuleError(`gear "${gear}" is not a lantern`);
  }
  if (draft.light.lantern === gear) return [];
  const events: CoreEvent[] = [];
  if (draft.light.lit) {
    draft.light.lit = false;
    events.push(event('light/lanternLit', { lit: false }));
  }
  draft.light.lantern = gear;
  events.push(event('light/lanternEquipped', { lantern: gear }));
  return events;
}

export function setLanternLit(draft: WorldState, db: ContentDatabase, lit: boolean): CoreEvent[] {
  if (draft.light.lit === lit) return [];
  if (lit) {
    if (draft.light.lantern === null) throw new WorldRuleError('no lantern equipped');
    if (draft.light.fuel <= 0) {
      if (itemCount(draft, OIL_ITEM, 'pack') < 1) throw new WorldRuleError('no oil');
      const left = takeOil(draft, db, 1);
      draft.light.fuel = 1;
      draft.light.lit = true;
      return [
        event('inventory/itemRemoved', { item: OIL_ITEM, qty: 1 }),
        event('light/oilPoured', { left }),
        event('light/lanternLit', { lit: true }),
      ];
    }
  }
  draft.light.lit = lit;
  return [event('light/lanternLit', { lit })];
}

export function setInDarkness(draft: WorldState, dark: boolean): CoreEvent[] {
  if (draft.light.inDarkness === dark) return [];
  draft.light.inDarkness = dark;
  return [event('light/darknessChanged', { dark })];
}

export function makeNoise(draft: WorldState, level: number): CoreEvent[] {
  draft.explorer.noise = Math.min(10, Math.max(draft.explorer.noise, level));
  return [];
}

function zoneState(
  draft: WorldState,
  db: ContentDatabase,
  zone: string,
): WorldState['zones'][string] {
  db.get('zones', zone);
  return (draft.zones[zone] ??= emptyZoneState());
}

export function revealZoneCells(
  draft: WorldState,
  db: ContentDatabase,
  zone: string,
  cells: readonly number[],
): CoreEvent[] {
  const state = zoneState(draft, db, zone);
  state.explored = revealCells(state.explored, cells);
  return [];
}

function poiOf(db: ContentDatabase, zone: string, poi: string) {
  const def = db.get('zones', zone).pois.find((p) => p.id === poi);
  if (!def) throw new WorldRuleError(`zone "${zone}" has no POI "${poi}"`);
  return def;
}

export function discoverPoi(
  draft: WorldState,
  db: ContentDatabase,
  zone: string,
  poi: string,
): CoreEvent[] {
  poiOf(db, zone, poi);
  const state = zoneState(draft, db, zone);
  if (state.pois.includes(poi)) return [];
  state.pois.push(poi);
  return [event('world/poiDiscovered', { zone, poi })];
}

/** Marks the POI discovered and used; returns its effects to apply (none if already spent). */
export function interactPoi(
  draft: WorldState,
  db: ContentDatabase,
  zone: string,
  poi: string,
): { events: CoreEvent[]; effects: ReturnType<typeof poiOf>['effects'] } {
  const def = poiOf(db, zone, poi);
  const events = discoverPoi(draft, db, zone, poi);
  const state = zoneState(draft, db, zone);
  const first = !state.used.includes(poi);
  if (first) state.used.push(poi);
  events.push(event('world/poiInteracted', { zone, poi, first }));
  return { events, effects: first || !def.once ? def.effects : [] };
}
