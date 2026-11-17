/**
 * The guardians' line (docs/systems/lineage.md → Implementation): the guardian is a person of the
 * village who marries, has children and takes apprentices; a generation ends in death or
 * retirement and an heir takes the burden — with the pacts, debt and curses, without the talents.
 */
import type { ProgressionRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { getStat, setStat } from '../state/stats';
import { emptyProgression, type WorldState } from '../state/world-state';
import {
  ChronicleError,
  contentYear,
  personOf,
  residents,
  yearOf,
  type ChronicleContext,
  type ReadState,
} from './common';
import { darknessMultiplier } from './endless';
import { growthRules, newPerson, population, prosperityScore } from './growth';

export type LineageRules = NonNullable<ProgressionRules['lineage']>;

export function lineageRules(db: ContentDatabase): LineageRules | null {
  return db.all('progression-rules')[0]?.lineage ?? null;
}

function requireLineage(db: ContentDatabase): LineageRules {
  const rules = lineageRules(db);
  if (!rules || !growthRules(db)) throw new ChronicleError('this content has no lineage');
  return rules;
}

/** Age of a person or content villager in the current year (null: nobody by that id). */
export function ageOf(s: ReadState, db: ContentDatabase, id: string): number | null {
  const year = yearOf(s.clock.day);
  const p = personOf(s, id);
  if (p) return year - p.born;
  const v = db.find('villagers', id);
  return v ? year - (s.endless.born[v.id] ?? contentYear(db) - v.age) : null;
}

const stat = (s: ReadState, db: ContentDatabase, id: string): number =>
  db.hasStat(id) ? getStat(s, db, id) : 0;

/** The numbers a generation jump compares. */
export function worldBaseline(s: ReadState, db: ContentDatabase): Record<string, number> {
  return {
    year: yearOf(s.clock.day),
    population: population(s, db),
    prosperity: prosperityScore(s, db),
    buildings: Object.values(s.village.buildings).reduce((a, b) => a + b, 0),
    corruption: stat(s, db, 'corruption'),
    'village-corruption': stat(s, db, 'village-corruption'),
    debt: s.debt.entries.map((e) => e.amount).reduce((a, b) => a + b, 0),
    pacts: Object.keys(s.pacts).length,
    possessions: s.possessions.length,
    dead: Object.values(s.villagers).filter((v) => !v.alive).length,
  };
}

/** Legacy the serving generation has earned so far. */
export function legacyOf(s: ReadState, db: ContentDatabase): number {
  const rules = lineageRules(db);
  if (!rules) return 0;
  const w = rules.legacy;
  const d = s.lineage.deeds;
  const years =
    s.lineage.since === null ? 0 : Math.max(0, yearOf(s.clock.day) - yearOf(s.lineage.since));
  const base =
    Math.floor(s.guardian.revelation.lifetime / w.perRevelation) +
    w.chapter * d.chapters +
    w.mystery * d.mysteries +
    w.building * d.buildings +
    w.route * d.routes +
    w.year * years;
  return Math.floor(base * darknessMultiplier(s, db));
}

/** Who may take up the burden: the house's children and apprentices of age, else any adult. */
export function heirCandidates(s: ReadState, db: ContentDatabase): string[] {
  const rules = lineageRules(db);
  if (!rules) return [];
  const year = yearOf(s.clock.day);
  const adult = s.village.people.filter(
    (p) => p.alive && !p.left && year - p.born >= rules.heirAge && p.role !== 'elder',
  );
  const house = adult.filter((p) => p.role === 'child' || p.role === 'apprentice');
  return (house.length > 0 ? house : adult.filter((p) => p.role !== 'spouse')).map((p) => p.id);
}

/** A house child still too young: the years can be skipped until they come of age. */
export function waitingHeir(s: ReadState): boolean {
  return s.village.people.some(
    (p) => p.alive && !p.left && (p.role === 'child' || p.role === 'apprentice'),
  );
}

/** A guardian was created: they are a person of the village (the first one is made here). */
function guardianCreated(draft: WorldState, ctx: ChronicleContext, calling: string): CoreEvent[] {
  const rules = lineageRules(ctx.db);
  if (!rules || !growthRules(ctx.db)) return [];
  const out: CoreEvent[] = [];
  if (draft.lineage.guardian === null) {
    const p = newPerson(draft, ctx, {
      sex: ctx.rng.next() < 0.5 ? 'female' : 'male',
      born: yearOf(draft.clock.day) - rules.guardianStartAge,
      origin: 'guardian',
      role: 'guardian',
      parents: [],
    });
    draft.lineage.guardian = p.id;
    out.push(event('lineage/familyChanged', { person: p.id, role: 'guardian' }));
  }
  const me = personOf(draft, draft.lineage.guardian);
  if (me) me.calling = calling;
  draft.lineage.since ??= draft.clock.day;
  draft.lineage.baseline ??= worldBaseline(draft, ctx.db);
  return out;
}

/** The serving guardian's generation ends; Legacy is reckoned and an heir is awaited. */
export function endGeneration(
  draft: WorldState,
  ctx: ChronicleContext,
  cause: 'died' | 'retired' | 'old-age',
): CoreEvent[] {
  const id = draft.lineage.guardian;
  if (id === null) return [];
  const legacy = legacyOf(draft, ctx.db);
  const me = personOf(draft, id);
  if (me) {
    me.role = 'elder';
    if (cause !== 'retired') {
      me.alive = false;
      me.died = yearOf(draft.clock.day);
    }
  }
  draft.lineage.past.push({
    person: id,
    calling: draft.guardian.callingId,
    from: draft.lineage.since ?? draft.clock.day,
    to: draft.clock.day,
    cause,
    legacy,
  });
  draft.lineage.guardian = null;
  draft.lineage.awaitingHeir = true;
  const out: CoreEvent[] = [event('lineage/generationEnded', { guardian: id, cause, legacy })];
  if (heirCandidates(draft, ctx.db).length === 0 && !waitingHeir(draft)) {
    draft.lineage.ended = true;
    out.push(event('lineage/lineEnded', { generation: stat(draft, ctx.db, 'generation') }));
  }
  return out;
}

function serving(draft: ReadState): string {
  const id = draft.lineage.guardian;
  if (id === null || draft.lineage.awaitingHeir) throw new ChronicleError('no guardian serves');
  return id;
}

/** The guardian marries a single adult of the village. */
export function marry(draft: WorldState, ctx: ChronicleContext, partner: string): CoreEvent[] {
  const rules = requireLineage(ctx.db);
  const me = serving(draft);
  if (draft.village.partners[me] !== undefined) throw new ChronicleError('already married');
  const r = residents(draft, ctx.db).find((x) => x.id === partner);
  const age = ageOf(draft, ctx.db, partner);
  if (!r || r.id === me || age === null || age < rules.heirAge)
    throw new ChronicleError('cannot marry them');
  if (draft.village.partners[partner] !== undefined) throw new ChronicleError('they are married');
  const mine = personOf(draft, me);
  if (r.parents.includes(me) || (mine && mine.parents.some((x) => r.parents.includes(x))))
    throw new ChronicleError('they are family');
  draft.village.partners[me] = partner;
  draft.village.partners[partner] = me;
  const p = personOf(draft, partner);
  if (p) p.role = 'spouse';
  return [event('lineage/familyChanged', { person: partner, role: 'spouse' })];
}

/** A young villager of no house becomes the guardian's apprentice (and a possible heir). */
export function takeApprentice(
  draft: WorldState,
  ctx: ChronicleContext,
  person: string,
): CoreEvent[] {
  const rules = requireLineage(ctx.db);
  serving(draft);
  const p = personOf(draft, person);
  const age = ageOf(draft, ctx.db, person);
  if (!p || !p.alive || p.left || p.role !== 'villager' || age === null)
    throw new ChronicleError('they cannot be taken in');
  if (age < rules.apprenticeMinAge) throw new ChronicleError('too young');
  p.role = 'apprentice';
  return [event('lineage/familyChanged', { person, role: 'apprentice' })];
}

/** The guardian lays down the burden (by choice, from `retireAge`). */
export function retire(draft: WorldState, ctx: ChronicleContext): CoreEvent[] {
  const rules = requireLineage(ctx.db);
  const me = serving(draft);
  if ((ageOf(draft, ctx.db, me) ?? 0) < rules.retireAge) throw new ChronicleError('too young');
  return endGeneration(draft, ctx, 'retired');
}

/** Modifier and ability sources that belong to a guardian, not to the house. */
const PERSONAL = ['talent:', 'calling:', 'tree:', 'bloodline:', 'virtue:', 'sin:'];
const personal = (source: string): boolean => PERSONAL.some((p) => source.startsWith(p));

/**
 * The heir takes up the burden. Inherited: pacts (their debt falls on the heir), debt, curses and
 * possessions, belongings and heirlooms, the journal entries marked for the heir. Not inherited:
 * talents, trees, skills, attributes, Revelation, Sanity. The heir then picks a calling.
 */
export function chooseHeir(draft: WorldState, ctx: ChronicleContext, heir: string): CoreEvent[] {
  const rules = requireLineage(ctx.db);
  if (!draft.lineage.awaitingHeir) throw new ChronicleError('no heir is needed');
  if (!heirCandidates(draft, ctx.db).includes(heir)) throw new ChronicleError('not an heir');
  const p = personOf(draft, heir);
  const past = draft.lineage.past.at(-1);
  if (!p || !past) throw new ChronicleError('not an heir');
  const out: CoreEvent[] = [];

  // What the forebear owed passes on.
  for (const pact of Object.keys(draft.pacts).sort())
    out.push(...ctx.apply([{ addDebt: rules.inheritedPactDebt }], `inheritance:${pact}`));

  // What was theirs alone does not.
  const g = draft.guardian;
  const keep = {
    equipment: g.equipment,
    gear: g.gear,
    blessings: g.blessings,
    upgrades: g.upgrades,
  };
  Object.assign(g, emptyProgression(), keep);
  g.callingId = null;
  g.talents = [];
  g.unlockedTrees = [];
  draft.modifiers = draft.modifiers.filter((m) => !personal(m.source));
  draft.abilities = Object.fromEntries(
    Object.entries(draft.abilities).filter(([, a]) => !personal(a.source)),
  );
  const marked = new Set(draft.journal.heir);
  draft.journal.learned = draft.journal.learned.filter((k) => marked.has(k));
  draft.journal.notes = draft.journal.notes.filter((n) => marked.has(`note:${String(n.id)}`));
  draft.sanity = { tier: 0, broken: false, breaks: 0 };
  for (const s of ['sanity', 'guardian-health'])
    if (ctx.db.hasStat(s)) setStat(draft, ctx.db, s, ctx.db.statDecl(s).default);
  draft.lineage.bloodline = [];

  // The generation jump: what changed while the forebear served.
  const now = worldBaseline(draft, ctx.db);
  const before = draft.lineage.baseline ?? now;
  draft.lineage.summary = {
    from: yearOf(past.from),
    to: yearOf(draft.clock.day),
    predecessor: past.person,
    heir,
    cause: past.cause,
    legacy: past.legacy,
    changes: Object.fromEntries(
      Object.keys(now).map((k) => [k, [before[k] ?? 0, now[k] ?? 0] as [number, number]]),
    ),
  };
  draft.lineage.baseline = now;
  draft.lineage.guardian = heir;
  draft.lineage.since = draft.clock.day;
  draft.lineage.deeds = { chapters: 0, mysteries: 0, buildings: 0, routes: 0 };
  draft.lineage.awaitingHeir = false;
  p.role = 'guardian';
  const generation = stat(draft, ctx.db, 'generation') + 1;
  if (ctx.db.hasStat('generation')) setStat(draft, ctx.db, 'generation', generation);
  out.push(event('lineage/heirChosen', { heir, generation }));
  return out;
}

/**
 * Bloodline nodes (owned on the account) shape the new guardian: flat, capped bonuses applied at
 * creation. Prerequisites and exclusive pairs are checked; a locked calling needs its node.
 */
export function applyBloodline(
  draft: WorldState,
  ctx: ChronicleContext,
  nodes: readonly string[],
  calling: string,
): CoreEvent[] {
  const owned = new Set(nodes);
  for (const id of owned) {
    const node = ctx.db.get('bloodline-nodes', id);
    if (node.requires.some((r) => !owned.has(r))) throw new ChronicleError(`"${id}" needs more`);
    if (node.exclusiveWith.some((r) => owned.has(r)))
      throw new ChronicleError(`"${id}" excludes another node`);
  }
  const lock = ctx.db.get('callings', calling).bloodline;
  if (lock !== undefined && !owned.has(lock)) throw new ChronicleError('calling locked');
  draft.modifiers = draft.modifiers.filter((m) => !m.source.startsWith('bloodline:'));
  draft.lineage.bloodline = [...owned].sort();
  const out: CoreEvent[] = [];
  for (const id of draft.lineage.bloodline)
    out.push(...ctx.apply(ctx.db.get('bloodline-nodes', id).effects, `bloodline:${id}`));
  return out;
}

/** The guardian ages a year; the old may die of it. */
export function lineageYear(draft: WorldState, ctx: ChronicleContext, year: number): CoreEvent[] {
  const pop = growthRules(ctx.db)?.population;
  const me = draft.lineage.guardian;
  const p = me === null ? undefined : personOf(draft, me);
  if (!pop || !p || draft.lineage.awaitingHeir) return [];
  const age = year - p.born;
  const over = age - pop.elderAge;
  if (over > 0 && (age >= pop.maxAge || ctx.rng.next() < pop.oldAgeDeath * over))
    return endGeneration(draft, ctx, 'old-age');
  return [];
}

/** Deeds that earn Legacy, and the guardian's own birth and death. */
export function lineageAfter(
  draft: WorldState,
  ctx: ChronicleContext,
  events: readonly CoreEvent[],
): CoreEvent[] {
  const out: CoreEvent[] = [];
  const deeds = draft.lineage.deeds;
  for (const e of events) {
    switch (e.type) {
      case 'guardian/created':
        out.push(...guardianCreated(draft, ctx, e.payload.calling));
        break;
      case 'guardian/died':
        out.push(...endGeneration(draft, ctx, 'died'));
        break;
      case 'time/chapterEnded':
        deeds.chapters += 1;
        break;
      case 'mystery/concluded':
        if (e.payload.correct) deeds.mysteries += 1;
        break;
      case 'village/buildingBuilt':
        deeds.buildings += 1;
        break;
      case 'quest/completed':
        if (ctx.db.find('quests', e.payload.quest)?.kind === 'route') deeds.routes += 1;
        break;
      default:
        break;
    }
  }
  return out;
}
