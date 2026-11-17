/**
 * Debt (docs/systems/progression.md D1–D6): the nightly collection roll, coherent collections by
 * creditor, remedies, and signing pacts.
 */
import type {
  Condition,
  DebtCollection,
  DebtTier,
  Effect,
  ProgressionRules,
} from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import type { IRandom } from '../random';
import { effectiveStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { debtTotal, ProgressionError, talentRanks, type ReadState } from './rules';
import { scheduleClauses, sinReinforce } from '../occult/pacts';

const TIERS: readonly DebtTier[] = ['minor', 'major', 'grave'];

/** Chance of a collection tonight (D2). */
export function collectionChance(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
): number {
  const total = debtTotal(state);
  if (total <= 0) return 0;
  const base = Math.min(rules.debt.maxChance, (rules.debt.chancePer5 * total) / 5);
  const rate = db.hasStat('debt-collection-rate')
    ? effectiveStat(state, db, 'debt-collection-rate')
    : 1;
  return Math.min(1, base * rate);
}

/** Severity of a collection from a d100 roll (D3). */
export function severityFor(
  rules: ProgressionRules,
  roll: number,
  total: number,
  shift: number,
): DebtTier {
  const score = roll + total;
  const index = score >= rules.debt.grave ? 2 : score >= rules.debt.major ? 1 : 0;
  return TIERS[Math.max(0, Math.min(2, index + shift))] ?? 'minor';
}

/** Tier shift from owned talents (rule `debt-collection-tier-shift`, e.g. Friend of the Collector). */
function tierShift(state: ReadState, db: ContentDatabase): number {
  let shift = 0;
  for (const talent of talentRanks(state, db).keys())
    for (const e of db.find('talents', talent)?.effects ?? [])
      if ('rule' in e && e.rule === 'debt-collection-tier-shift')
        shift += Number(e.params?.['tiers'] ?? -1);
  return shift;
}

function weighted<T>(rng: IRandom, items: readonly T[], weight: (t: T) => number): T | undefined {
  const total = items.reduce((s, i) => s + weight(i), 0);
  if (total <= 0) return undefined;
  let roll = rng.next() * total;
  for (const item of items) {
    roll -= weight(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

export function syncDebtStat(draft: WorldState, db: ContentDatabase): void {
  if (db.hasStat('debt')) setStat(draft, db, 'debt', debtTotal(draft));
}

/**
 * The collection roll at dusk (D2–D4). Returns the events and the collection's effects (applied by
 * the caller). At most one collection per night.
 */
export function rollCollection(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  rng: IRandom,
  evaluate: (c: Condition) => boolean,
): { events: CoreEvent[]; effects: readonly Effect[]; source: string } {
  const none = { events: [], effects: [], source: '' };
  const day = draft.clock.day;
  if (draft.debt.lastNight === day || draft.debt.entries.length === 0) return none;
  const chance = collectionChance(draft, db, rules);
  if (chance <= 0 || rng.next() >= chance) return none;
  const total = debtTotal(draft);
  const severity = severityFor(rules, rng.int(1, 100), total, tierShift(draft, db));
  const entry = weighted(
    rng,
    draft.debt.entries.filter((e) => e.amount > 0),
    (e) => e.amount,
  );
  if (!entry) return none;
  // The creditor of that entry collects, at that severity or the nearest lower one (D4).
  let pool: DebtCollection[] = [];
  for (let i = TIERS.indexOf(severity); i >= 0 && pool.length === 0; i--)
    pool = candidates(db, entry.creditor, TIERS[i] ?? 'minor', evaluate);
  const collection = weighted(rng, pool, (c) => c.weight);
  if (!collection) return none;
  draft.debt.lastNight = day;
  draft.debt.history.push({
    day,
    collection: collection.id,
    source: entry.source,
    severity: collection.severity,
  });
  if (draft.debt.history.length > 500) draft.debt.history.shift();
  return {
    events: [
      event('debt/collected', {
        collection: collection.id,
        source: entry.source,
        creditor: entry.creditor,
        severity: collection.severity,
        descKey: collection.descKey,
      }),
    ],
    effects: collection.effects,
    source: `debt:${collection.id}`,
  };
}

function candidates(
  db: ContentDatabase,
  creditor: string,
  severity: DebtTier,
  evaluate: (c: Condition) => boolean,
): DebtCollection[] {
  return db
    .all('debt-collections')
    .filter(
      (c) => c.creditor === creditor && c.severity === severity && (!c.when || evaluate(c.when)),
    );
}

/** Remedies offered now, with whether they can be paid and how much is owed to their creditor. */
export function remedies(
  state: ReadState,
  db: ContentDatabase,
  evaluate: (c: Condition) => boolean,
): { id: string; creditor: string; owed: number; reduce: number; ok: boolean }[] {
  return db.all('debt-remedies').map((r) => {
    const owed = state.debt.entries
      .filter((e) => e.creditor === r.creditor)
      .reduce((s, e) => s + e.amount, 0);
    return {
      id: r.id,
      creditor: r.creditor,
      owed,
      reduce: r.reduce,
      ok: owed > 0 && (!r.when || evaluate(r.when)),
    };
  });
}

/** Pays a remedy (D5): its cost effects are returned for the caller to apply. */
export function payDebt(
  draft: WorldState,
  db: ContentDatabase,
  remedyId: string,
  evaluate: (c: Condition) => boolean,
): { events: CoreEvent[]; cost: readonly Effect[] } {
  const remedy = db.get('debt-remedies', remedyId);
  const owed = draft.debt.entries.filter((e) => e.creditor === remedy.creditor);
  if (owed.length === 0) throw new ProgressionError('nothing owed');
  if (remedy.when && !evaluate(remedy.when)) throw new ProgressionError('cannot pay now');
  let left = remedy.reduce;
  for (const e of owed) {
    const cut = Math.min(left, e.amount);
    e.amount -= cut;
    left -= cut;
    if (left === 0) break;
  }
  draft.debt.entries = draft.debt.entries.filter((e) => e.amount > 0);
  syncDebtStat(draft, db);
  const paid = remedy.reduce - left;
  return {
    events: [
      event('debt/paid', {
        remedy: remedy.id,
        creditor: remedy.creditor,
        amount: paid,
        total: debtTotal(draft),
      }),
    ],
    cost: remedy.cost,
  };
}

function minutesOf(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Is `minute` inside the [from, to) window (wrapping midnight)? */
export function inWindow(minute: number, window: { from: string; to: string }): boolean {
  const from = minutesOf(window.from);
  const to = minutesOf(window.to);
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** Whether the pact can be signed here and now (D6). */
export function pactAvailable(
  state: ReadState,
  db: ContentDatabase,
  pactId: string,
): 'ok' | 'signed' | 'place' | 'hour' {
  const pact = db.get('pacts', pactId);
  if (pactId in state.pacts) return 'signed';
  let anywhere = false;
  for (const talent of talentRanks(state, db).keys())
    for (const e of db.find('talents', talent)?.effects ?? [])
      if ('rule' in e && e.rule === 'pacts-anywhere-at-midnight') anywhere = true;
  if (!anywhere && state.currentZone !== pact.zone) return 'place';
  if (!inWindow(state.clock.minute, pact.window)) return 'hour';
  return 'ok';
}

/** Signs a pact: returns the effects to apply (offer, debt, dark tree). */
export function signPact(
  draft: WorldState,
  db: ContentDatabase,
  pactId: string,
  rng: IRandom,
): { events: CoreEvent[]; effects: Effect[] } {
  const status = pactAvailable(draft, db, pactId);
  if (status === 'signed') throw new ProgressionError('already signed');
  if (status === 'place') throw new ProgressionError('not here');
  if (status === 'hour') throw new ProgressionError('not at this hour');
  if (draft.guardian.callingId === null) throw new ProgressionError('no guardian');
  const pact = db.get('pacts', pactId);
  draft.pacts[pactId] = {
    signedAt: { day: draft.clock.day, minute: draft.clock.minute },
    clauses: {},
  };
  scheduleClauses(draft, db, pactId, rng);
  // Signed in blood.
  const effects: Effect[] = [{ addStat: pact.blood.stat, value: -pact.blood.amount }];
  effects.push(...pact.offerEffects);
  if (pact.debt) effects.push({ addDebt: pact.debt });
  if (pact.unlocksTree) effects.push({ unlockTree: pact.unlocksTree });
  const events = [event('pact/signed', { pact: pactId, creditor: pact.creditor })];
  if (pact.sin) {
    if (draft.guardian.sin === null) {
      draft.guardian.sin = pact.sin;
      events.push(event('pact/sinImposed', { pact: pactId, sin: pact.sin }));
    } else if (draft.guardian.sin === pact.sin && sinReinforce(db) > 0)
      effects.push({ addStat: 'corruption', value: sinReinforce(db) });
  }
  return { events, effects };
}
