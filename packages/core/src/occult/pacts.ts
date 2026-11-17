/**
 * Dark factions, hidden pact clauses, sacrifices and the mark of Corruption
 * (docs/systems/pacts.md, sacrifices.md, corruption.md → Implementation).
 */
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent, type GameTime } from '../events';
import type { IRandom } from '../random';
import { effectiveStat, getStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { evaluatorAt, hasItems, takeItems } from '../village/common';
import { killVillager } from '../village/death';
import { fearRules, FearRuleError, type FearContext, type ReadState } from '../fear/common';

/** 0–1: how far Corruption outweighs Faith. Drives the sprite, trust and hallucinations. */
export function corruptionAspect(state: ReadState, db: ContentDatabase): number {
  const corruption = db.hasStat('corruption') ? effectiveStat(state, db, 'corruption') : 0;
  const faith = db.hasStat('faith') ? effectiveStat(state, db, 'faith') : 0;
  return Math.min(1, Math.max(0, (corruption - faith) / 100));
}

/** Villagers trust a marked guardian less: affinity gains × (1 − aspect / 2). */
export function trustFactor(state: ReadState, db: ContentDatabase): number {
  return 1 - corruptionAspect(state, db) / 2;
}

/** Schedules a newly signed pact's hidden clauses (delays rolled now, conditions checked at dawn). */
export function scheduleClauses(
  draft: WorldState,
  db: ContentDatabase,
  pactId: string,
  rng: IRandom,
): void {
  const pact = db.get('pacts', pactId);
  const entry = draft.pacts[pactId];
  if (!entry) return;
  for (const c of pact.hiddenClauses) {
    const d = 'delayNights' in c.trigger ? c.trigger.delayNights : null;
    entry.clauses[c.id] = {
      dueDay: d ? draft.clock.day + rng.int(d.min, Math.max(d.min, d.max)) : null,
      fired: false,
    };
  }
}

/** Dawn: hidden clauses whose day has come, or whose condition now holds, take effect. */
export function clausesAtDawn(draft: WorldState, ctx: FearContext, now: GameTime): CoreEvent[] {
  const holds = evaluatorAt(draft, ctx.db, now.day, now.minute);
  const out: CoreEvent[] = [];
  for (const [pactId, entry] of Object.entries(draft.pacts)) {
    const pact = ctx.db.find('pacts', pactId);
    if (!pact) continue;
    for (const c of pact.hiddenClauses) {
      const state = entry.clauses[c.id];
      if (!state || state.fired) continue;
      const due =
        'when' in c.trigger
          ? holds(c.trigger.when)
          : state.dueDay !== null && state.dueDay <= now.day;
      if (!due) continue;
      state.fired = true;
      out.push(event('pact/clauseTriggered', { pact: pactId, clause: c.id }));
      out.push(...ctx.apply(c.effects, `clause:${pactId}/${c.id}`));
    }
  }
  return out;
}

/** Reputation gained with a faction is lost with the factions that hate it. */
export function factionsAfter(
  draft: WorldState,
  ctx: FearContext,
  events: readonly CoreEvent[],
): CoreEvent[] {
  const { db, rules } = ctx;
  const byStat = new Map(rules.factions.map((f) => [f.stat, f]));
  const out: CoreEvent[] = [];
  for (const e of events) {
    if (e.type !== 'state/statChanged' || e.payload.villager !== undefined) continue;
    const faction = byStat.get(e.payload.stat);
    const gain = e.payload.to - e.payload.from;
    if (!faction || gain <= 0) continue;
    for (const id of faction.hostileTo) {
      const enemy = rules.factions.find((f) => f.id === id);
      if (!enemy || !db.hasStat(enemy.stat)) continue;
      const [from, to] = setStat(
        draft,
        db,
        enemy.stat,
        getStat(draft, db, enemy.stat) - gain * faction.hostility,
      );
      if (from !== to) {
        out.push(event('state/statChanged', { stat: enemy.stat, from, to }));
        out.push(event('faction/angered', { faction: enemy.id, by: faction.id, from, to }));
      }
    }
  }
  return out;
}

/** Makes a sacrifice: offerings grow each time; a witness spreads the rumour. */
export function makeSacrifice(
  draft: WorldState,
  ctx: FearContext,
  id: string,
  target: string | undefined,
  now: GameTime,
): CoreEvent[] {
  const { db, rules } = ctx;
  const def = rules.sacrifices.find((s) => s.id === id);
  if (!def) throw new FearRuleError('no such sacrifice');
  if (draft.currentZone !== def.zone) throw new FearRuleError('not here');
  if (def.targeted) {
    const v = target === undefined ? undefined : db.find('villagers', target);
    if (!v || draft.villagers[v.id]?.alive !== true) throw new FearRuleError('no such villager');
    if (v.age < 14) throw new FearRuleError('never a child');
  }
  const times = draft.sacrifices.filter((s) => s.id === id).length;
  const items = def.items.map((i) => ({
    item: i.item,
    qty: Math.ceil(i.qty * (1 + def.escalation * times)),
  }));
  if (hasItems(draft, items, 'any') !== null) throw new FearRuleError('missing offerings');
  takeItems(draft, db, items, 'any');
  const rng = ctx.random('villagers');
  const witnessed = rng.next() < def.witnessChance;
  const doom =
    def.targeted && def.doomDays
      ? now.day + rng.int(def.doomDays.min, Math.max(def.doomDays.min, def.doomDays.max))
      : null;
  draft.sacrifices.push({
    id,
    day: now.day,
    target: def.targeted ? (target ?? null) : null,
    dueDay: doom,
    witnessed,
  });
  const out: CoreEvent[] = [
    ...items.map((i) => event('inventory/itemRemoved', i)),
    event('sacrifice/made', { sacrifice: id, target: target ?? null }),
    ...ctx.apply(def.effects, `sacrifice:${id}`),
  ];
  if (witnessed) {
    out.push(event('sacrifice/witnessed', { sacrifice: id }));
    out.push(event('hysteria/rumourSpread', { target: 'guardian' }));
    out.push(
      ...ctx.apply(
        [
          { addStat: 'hysteria', value: def.witnessedHysteria },
          { addStat: rules.hysteria.guardianStat, value: def.witnessedSuspicion },
        ],
        `sacrifice:${id}`,
      ),
    );
  }
  return out;
}

/** Dawn: an immured shadow claims its owner when the day comes. */
export function sacrificesAtDawn(draft: WorldState, ctx: FearContext, now: GameTime): CoreEvent[] {
  const out: CoreEvent[] = [];
  for (const s of draft.sacrifices) {
    if (s.dueDay === null || s.target === null || s.dueDay > now.day) continue;
    const target = s.target;
    s.dueDay = null;
    if (draft.villagers[target]?.alive !== true) continue;
    out.push(...killVillager(draft, ctx.db, target, 'shadow-claimed', now));
    out.push(event('sacrifice/shadowClaimed', { villager: target }));
  }
  return out;
}

/** The `sicken-villager` engine rule: the villager closest to the guardian falls ill. */
export function sickenVillager(draft: WorldState, db: ContentDatabase): CoreEvent[] {
  const ids = Object.entries(draft.villagers)
    .filter(([, v]) => v.alive)
    .sort(([, a], [, b]) => (b.affinity['guardian'] ?? 0) - (a.affinity['guardian'] ?? 0));
  const id = ids[0]?.[0];
  if (id === undefined || !db.hasStat('health')) return [];
  const [from, to] = setStat(draft, db, 'health', getStat(draft, db, 'health', id) - 60, id);
  return from === to
    ? []
    : [event('state/statChanged', { stat: 'health', villager: id, from, to })];
}

/** Corruption reinforcement for a pact whose sin the guardian already carries. */
export function sinReinforce(db: ContentDatabase): number {
  return fearRules(db)?.pacts.sinReinforce ?? 0;
}
