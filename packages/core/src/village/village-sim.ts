/**
 * The village simulation (docs/systems/villagers.md rules 4–13, tasks.md). Runs on whole
 * in-world hours and on the dusk / nightfall / dawn checkpoints crossed between two moments,
 * in time order, so ticking second by second, skipping a day at once, or being in another zone
 * all give the same village. No randomness is used.
 */
import type { Effect, VillageRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { getStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import {
  dayPhaseAt,
  jdnToJulian,
  lightBoundaries,
  seasonOf,
  TWILIGHT_MINUTES,
  type DayPhase,
} from '../time/calendar';
import {
  evaluatorAt,
  fearGainOf,
  hasItems,
  livingVillagers,
  MINUTES_PER_DAY,
  perceivedFear,
  takeItems,
  traitFactor,
  trueFear,
} from './common';
import { buryAtDawn, killVillager, returnAtNightfall } from './death';
import { contagion } from './fear';
import { villagerActivity, type VillagerActivity } from './routines';
import { efficiencyOf, traitEfficiency } from './tasks';

export interface VillageSimContext {
  db: ContentDatabase;
  rules: VillageRules;
  /** Applies content effects (task outputs) to the draft; returns their events. */
  apply: (effects: readonly Effect[], source: string) => CoreEvent[];
}

export interface Moment {
  day: number;
  minute: number;
}

type CheckpointKind = 'hour' | 'dusk' | 'night' | 'dawn';
const ORDER: Record<CheckpointKind, number> = { hour: 0, dusk: 1, night: 2, dawn: 3 };
const SAMPLES = [0, 15, 30, 45] as const;

const abs = (m: Moment): number => m.day * MINUTES_PER_DAY + m.minute;
const moment = (a: number): Moment => ({
  day: Math.floor(a / MINUTES_PER_DAY),
  minute: ((a % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY,
});
const phaseOf = (m: Moment): DayPhase => dayPhaseAt(m.minute, jdnToJulian(m.day).month);

/** True when moving from `from` to `to` crosses a whole in-world hour (the village must step). */
export function crossesHour(from: Moment, to: Moment): boolean {
  return Math.floor(abs(from) / 60) !== Math.floor(abs(to) / 60);
}

/** Every checkpoint in (from, to], in time order. */
export function checkpoints(from: Moment, to: Moment): { at: number; kind: CheckpointKind }[] {
  const a = abs(from);
  const b = abs(to);
  const out: { at: number; kind: CheckpointKind }[] = [];
  for (let day = from.day; day <= to.day; day++) {
    const base = day * MINUTES_PER_DAY;
    const { dawnStart, nightStart } = lightBoundaries(jdnToJulian(day).month);
    for (let m = 0; m < MINUTES_PER_DAY; m += 60) out.push({ at: base + m, kind: 'hour' });
    out.push({ at: base + nightStart - TWILIGHT_MINUTES, kind: 'dusk' });
    out.push({ at: base + nightStart, kind: 'night' });
    out.push({ at: base + dawnStart, kind: 'dawn' });
  }
  return out
    .filter((c) => c.at > a && c.at <= b)
    .sort((x, y) => x.at - y.at || ORDER[x.kind] - ORDER[y.kind]);
}

export function simulateVillage(
  draft: WorldState,
  ctx: VillageSimContext,
  from: Moment,
  to: Moment,
): CoreEvent[] {
  const events: CoreEvent[] = [];
  for (const c of checkpoints(from, to)) {
    const at = moment(c.at);
    if (c.kind === 'hour') events.push(...hourStep(draft, ctx, c.at));
    else if (c.kind === 'dusk') events.push(...atDusk(draft, ctx));
    else if (c.kind === 'night') events.push(...atNightfall(draft, ctx, at));
    else events.push(...atDawn(draft, ctx));
  }
  return events;
}

// ------------------------------------------------------------------ hour

interface Needs {
  fear: number;
  hunger: number;
  cold: number;
  faith: number;
  health: number;
}

function needsOf(draft: WorldState, db: ContentDatabase, id: string): Needs {
  return {
    fear: trueFear(draft, db, id),
    hunger: getStat(draft, db, 'hunger', id),
    cold: getStat(draft, db, 'cold', id),
    faith: getStat(draft, db, 'villager-faith', id),
    health: getStat(draft, db, 'health', id),
  };
}

/** The most frequent place of the hour (first on ties); null if absent all hour. */
function placeOfHour(acts: readonly VillagerActivity[]): string | null {
  const counts = new Map<string, number>();
  for (const a of acts) if (a.place) counts.set(a.place, (counts.get(a.place) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [p, c] of counts)
    if (c > n) {
      best = p;
      n = c;
    }
  return best;
}

/** Integrates the hour [end − 60, end) for every living villager. */
function hourStep(draft: WorldState, ctx: VillageSimContext, end: number): CoreEvent[] {
  const { db, rules } = ctx;
  const living = livingVillagers(draft, db).filter(
    (v) => draft.villagers[v.id]?.status !== 'returned',
  );
  if (living.length === 0) return [];
  const events: CoreEvent[] = [];
  const start = end - 60;
  const times = [-15, ...SAMPLES].map((o) => moment(start + o));
  const evaluators = times.map((t) => evaluatorAt(draft, db, t.day, t.minute));
  const phases = times.map(phaseOf);

  // Activities (from the start-of-hour state) and start-of-hour needs.
  const acts = new Map<string, VillagerActivity[]>();
  const before = new Map<string, VillagerActivity>();
  const pre = new Map<string, Needs>();
  const perceived = new Map<string, number>();
  for (const v of living) {
    const list = times.map((t, i) =>
      villagerActivity(draft, db, rules, v, t.day, t.minute, evaluators[i] ?? (() => false)),
    );
    before.set(v.id, list[0] as VillagerActivity);
    acts.set(v.id, list.slice(1));
    pre.set(v.id, needsOf(draft, db, v.id));
    perceived.set(v.id, perceivedFear(draft, db, rules, v.id));
  }
  const hourPlace = new Map(living.map((v) => [v.id, placeOfHour(acts.get(v.id) ?? [])]));
  const sampleAt = (id: string, k: number): VillagerActivity | undefined => acts.get(id)?.[k];
  const nightAt = (k: number): boolean => phases[k + 1] === 'night';
  const darkAt = (k: number): boolean => phases[k + 1] === 'night' || phases[k + 1] === 'dusk';

  // Contagion from the start-of-hour fears (simultaneous).
  const gains = new Map(living.map((v) => [v.id, fearGainOf(draft, db, rules, v)]));
  const spread = contagion(
    {
      ids: living.map((v) => v.id),
      fear: Object.fromEntries(living.map((v) => [v.id, pre.get(v.id)?.fear ?? 0])),
      affinity: (a, b) => draft.villagers[a]?.affinity[b],
      together: (a, b) => {
        const pa = hourPlace.get(a);
        return pa !== null && pa !== undefined && pa === hourPlace.get(b);
      },
      spread: (id) => {
        const v = living.find((l) => l.id === id);
        return v ? traitFactor(db, v, 'spread') : 1;
      },
      gain: (id) => gains.get(id) ?? 1,
    },
    rules.fear,
  );

  const n = rules.needs;
  const repair = db.hasStat(ctx.rules.tasks.repairStat)
    ? getStat(draft, db, ctx.rules.tasks.repairStat)
    : 100;
  const hungry: string[] = [];
  for (const v of living) {
    const state = draft.villagers[v.id];
    const p = pre.get(v.id);
    const list = acts.get(v.id);
    if (!state || !p || !list) continue;
    let { hunger, cold, faith, health } = p;

    // Hunger and meals.
    hunger += n.hungerPerHour * traitFactor(db, v, 'hungerRate');
    list.forEach((a, k) => {
      const prev = k === 0 ? before.get(v.id) : list[k - 1];
      if (a.activity !== 'eat' || prev?.activity === 'eat') return;
      if (
        draft.village.portions === 0 &&
        hasItems(draft, [{ item: n.mealItem, qty: 1 }]) === null
      ) {
        takeItems(draft, db, [{ item: n.mealItem, qty: 1 }]);
        draft.village.portions = n.portionsPerItem;
      }
      if (draft.village.portions > 0) {
        draft.village.portions -= 1;
        hunger -= n.mealRelief;
      } else hungry.push(v.id);
    });

    // Cold, faith and the fear of the dark and of solitude.
    const season = seasonOf(jdnToJulian(moment(start).day).month);
    const rate = n.coldPerNightHour[season] * traitFactor(db, v, 'coldRate');
    let tagged = 0;
    list.forEach((a, k) => {
      const atHome = a.place === v.home;
      if (!darkAt(k)) cold -= n.coldReliefByDay / 4;
      else if (atHome && draft.village.heated.includes(v.home)) cold -= n.warmthAtHome / 4;
      else if (atHome) cold += (rate * n.unheatedFactor * (1.5 - repair / 200)) / 4;
      else cold += rate / 4;
      faith -= n.faithDecayPerDay / 24 / 4;
      if (a.activity === 'pray') faith += n.prayFaithPerHour / 4;
      if (a.activity === 'task' && a.task) faith += (db.find('tasks', a.task)?.faith ?? 0) / 4;
      if (nightAt(k)) {
        if (v.fears.includes('dark') && !atHome) tagged += rules.fear.darkFearPerHour / 4;
        const alone =
          a.place !== null &&
          !living.some((o) => o.id !== v.id && sampleAt(o.id, k)?.place === a.place);
        if (v.fears.includes('solitude') && alone) tagged += rules.fear.solitudeFearPerHour / 4;
      }
    });

    // Health.
    const critical =
      (p.hunger >= rules.health.critical ? 1 : 0) + (p.cold >= rules.health.critical ? 1 : 0);
    health -= rules.health.lossPerHour * critical;
    if (p.hunger < n.threshold && p.cold < n.threshold) health += rules.health.regenPerHour;

    // Fear: needs, tags and contagion.
    const needFear =
      p.hunger >= n.threshold || p.cold >= n.threshold ? rules.fear.needFearPerHour : 0;
    const fear = p.fear + (needFear + tagged) * (gains.get(v.id) ?? 1) + (spread[v.id] ?? 0);

    setStat(draft, db, 'hunger', hunger, v.id);
    setStat(draft, db, 'cold', cold, v.id);
    setStat(draft, db, 'villager-faith', faith, v.id);
    setStat(draft, db, 'health', health, v.id);
    setStat(draft, db, 'fear', fear, v.id);

    // Work (efficiency from the start of the hour).
    const workEvents = work(draft, ctx, v.id, list, p.health, perceived.get(v.id) ?? p.fear);
    events.push(...workEvents);
  }
  if (hungry.length > 0) events.push(event('village/mealShort', { villagers: hungry }));

  // Night watch defence this hour.
  if (phases[SAMPLES.length] === 'night' && db.hasStat(rules.tasks.watchStat)) {
    let defence = 0;
    for (const v of living) {
      const last = sampleAt(v.id, SAMPLES.length - 1);
      const state = draft.villagers[v.id];
      if (!state?.tasks.night || last?.activity !== 'task') continue;
      const task = db.get('tasks', state.tasks.night);
      const p = pre.get(v.id);
      defence +=
        efficiencyOf(traitEfficiency(db, v, task.id), p?.health ?? 100, perceived.get(v.id) ?? 0) *
        task.defence;
    }
    setStat(draft, db, rules.tasks.watchStat, defence);
  }

  events.push(...updateStatuses(draft, ctx, moment(end)));
  return events;
}

/** Task progress for one villager over the hour's samples. */
function work(
  draft: WorldState,
  ctx: VillageSimContext,
  id: string,
  list: readonly VillagerActivity[],
  health: number,
  fear: number,
): CoreEvent[] {
  const { db } = ctx;
  const v = draft.villagers[id];
  const def = db.get('villagers', id);
  if (!v) return [];
  const events: CoreEvent[] = [];
  for (const slot of ['day', 'night'] as const) {
    const taskId = v.tasks[slot];
    if (!taskId) continue;
    const task = db.get('tasks', taskId);
    const minutes = list.filter((a) => a.activity === 'task' && a.task === taskId).length * 15;
    if (minutes === 0) continue;
    v.progress[slot] += minutes * efficiencyOf(traitEfficiency(db, def, taskId), health, fear);
    if (task.output.length === 0) continue;
    const duration = task.hours * 60;
    while (v.progress[slot] >= duration) {
      // Night tasks pay their materials at nightfall; day batches when they finish.
      const cost = slot === 'day' ? task.consumes : [];
      const missing = hasItems(draft, cost);
      if (missing) {
        if (!v.stalled)
          events.push(event('task/stalled', { villager: id, task: taskId, item: missing }));
        v.stalled = true;
        v.progress[slot] = duration;
        break;
      }
      takeItems(draft, db, cost);
      for (const s of cost)
        events.push(event('inventory/itemRemoved', { item: s.item, qty: s.qty }));
      v.pending[taskId] = Math.min(100, (v.pending[taskId] ?? 0) + 1);
      v.progress[slot] -= duration;
      v.stalled = false;
    }
  }
  return events;
}

/** Status with hysteresis, panic, deaths, fleeing watchers and secrets, at the end of an hour. */
function updateStatuses(draft: WorldState, ctx: VillageSimContext, at: Moment): CoreEvent[] {
  const { db, rules } = ctx;
  const events: CoreEvent[] = [];
  const evaluate = evaluatorAt(draft, db, at.day, at.minute);
  const night = phaseOf(at) === 'night';
  for (const v of livingVillagers(draft, db)) {
    const state = draft.villagers[v.id];
    if (!state || state.status === 'returned') continue;
    const n = needsOf(draft, db, v.id);
    if (n.health <= 0) {
      const cause =
        n.hunger >= rules.health.critical
          ? 'hunger'
          : n.cold >= rules.health.critical
            ? 'cold'
            : 'sickness';
      events.push(...killVillager(draft, db, v.id, cause, at));
      continue;
    }
    const fear = perceivedFear(draft, db, rules, v.id);
    const prev = state.status;
    const sick =
      prev === 'sick' ? n.health < rules.health.recoveredAt : n.health < rules.health.sickBelow;
    const terrified =
      prev === 'terrified' ? fear >= rules.fear.calmBelow : fear >= rules.fear.terrifiedAt;
    const next = sick ? 'sick' : terrified ? 'terrified' : 'healthy';
    if (next !== prev) {
      state.status = next;
      events.push(event('villager/statusChanged', { villager: v.id, from: prev, to: next }));
    }
    if (fear >= rules.fear.panicAt && !state.panicked) {
      state.panicked = true;
      events.push(event('villager/panicked', { villager: v.id }));
    } else if (fear < rules.fear.terrifiedAt) state.panicked = false;

    const watch = state.tasks.night;
    if (watch && night && (sick || fear >= rules.fear.nightTaskMaxFear)) {
      state.tasks.night = null;
      state.progress.night = 0;
      events.push(
        event('task/interrupted', { villager: v.id, task: watch, cause: sick ? 'sick' : 'fear' }),
      );
    }
    for (const secret of v.secrets) {
      if (state.secrets.includes(secret.id) || !evaluate(secret.revealWhen)) continue;
      state.secrets.push(secret.id);
      events.push(event('villager/secretRevealed', { villager: v.id, secret: secret.id }));
      if (secret.effects.length > 0) events.push(...ctx.apply(secret.effects, `secret:${v.id}`));
    }
  }
  return events;
}

// ------------------------------------------------------------------ checkpoints

/** Delivers finished batches of the given slot's tasks (outputs × batches). */
function deliver(draft: WorldState, ctx: VillageSimContext, slot: 'day' | 'night'): CoreEvent[] {
  const { db } = ctx;
  const events: CoreEvent[] = [];
  const items: Record<string, number> = {};
  for (const id of Object.keys(draft.villagers).sort()) {
    const v = draft.villagers[id];
    if (!v) continue;
    for (const [taskId, batches] of Object.entries(v.pending).sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const task = db.get('tasks', taskId);
      if (task.slot !== slot) continue;
      const { [taskId]: _done, ...rest } = v.pending;
      v.pending = rest;
      const produced: CoreEvent[] = [];
      for (let i = 0; i < batches; i++) produced.push(...ctx.apply(task.output, `task:${taskId}`));
      for (const e of produced)
        if (e.type === 'inventory/itemAdded')
          items[e.payload.item] = (items[e.payload.item] ?? 0) + e.payload.qty;
      events.push(...produced, event('task/completed', { villager: id, task: taskId, batches }));
    }
  }
  if (Object.keys(items).length > 0) events.push(event('task/delivered', { items }));
  return events;
}

/** Dusk: the day's work comes home and every occupied home lights its fire. */
function atDusk(draft: WorldState, ctx: VillageSimContext): CoreEvent[] {
  const { db, rules } = ctx;
  const events = deliver(draft, ctx, 'day');
  for (const v of Object.values(draft.villagers)) {
    v.progress.day *= rules.tasks.carryOver;
    v.stalled = false;
  }
  const homes = [...new Set(livingVillagers(draft, db).map((v) => v.home))].sort();
  const cost = [{ item: rules.needs.firewoodItem, qty: rules.needs.firewoodPerHome }];
  const cold: string[] = [];
  let burned = 0;
  draft.village.heated = [];
  for (const home of homes) {
    if (hasItems(draft, cost) === null) {
      takeItems(draft, db, cost);
      burned += rules.needs.firewoodPerHome;
      draft.village.heated.push(home);
    } else cold.push(home);
  }
  if (burned > 0)
    events.push(event('inventory/itemRemoved', { item: rules.needs.firewoodItem, qty: burned }));
  if (cold.length > 0) events.push(event('village/coldNight', { homes: cold }));
  return events;
}

/** Nightfall: watchers take their post (and their oil); the badly buried rise. */
function atNightfall(draft: WorldState, ctx: VillageSimContext, at: Moment): CoreEvent[] {
  const { db, rules } = ctx;
  const events: CoreEvent[] = [];
  for (const v of livingVillagers(draft, db)) {
    const state = draft.villagers[v.id];
    const taskId = state?.tasks.night;
    if (!state || !taskId) continue;
    const task = db.get('tasks', taskId);
    const missing = hasItems(draft, task.consumes);
    const afraid = perceivedFear(draft, db, rules, v.id) >= rules.fear.nightTaskMaxFear;
    if (afraid || missing || state.status === 'sick') {
      state.tasks.night = null;
      events.push(
        event('task/interrupted', {
          villager: v.id,
          task: taskId,
          cause: afraid ? 'fear' : state.status === 'sick' ? 'sick' : 'materials',
        }),
      );
      continue;
    }
    takeItems(draft, db, task.consumes);
    for (const s of task.consumes)
      events.push(event('inventory/itemRemoved', { item: s.item, qty: s.qty }));
  }
  events.push(...returnAtNightfall(draft, db, rules, at.day));
  return events;
}

/** Dawn: night work ends, fear ebbs, roofs weather, and the dead are buried. */
function atDawn(draft: WorldState, ctx: VillageSimContext): CoreEvent[] {
  const { db, rules } = ctx;
  const events = deliver(draft, ctx, 'night');
  for (const v of Object.values(draft.villagers)) v.progress.night = 0;
  if (db.hasStat(rules.tasks.watchStat)) setStat(draft, db, rules.tasks.watchStat, 0);
  const hysterical =
    db.hasStat('hysteria') && getStat(draft, db, 'hysteria') > rules.fear.hysteriaThreshold;
  const decay = hysterical ? rules.fear.decayWhenHysterical : rules.fear.decayPerDawn;
  for (const v of livingVillagers(draft, db))
    setStat(draft, db, 'fear', trueFear(draft, db, v.id) - decay, v.id);
  if (db.hasStat(rules.tasks.repairStat))
    setStat(
      draft,
      db,
      rules.tasks.repairStat,
      getStat(draft, db, rules.tasks.repairStat) - rules.tasks.repairDecayPerDawn,
    );
  draft.village.heated = [];
  events.push(...buryAtDawn(draft, db, rules));
  return events;
}
