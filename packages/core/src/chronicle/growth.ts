/**
 * The village grows and shrinks over the years (docs/systems/village-growth.md → Implementation):
 * buildings with levels, residents who age, marry, are born, arrive, flee and die, and prosperity.
 */
import type { VillageRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { makeSacrifice } from '../occult/pacts';
import { getStat, setStat } from '../state/stats';
import type { Person, WorldState } from '../state/world-state';
import { evaluatorAt, hasItems, takeItems } from '../village/common';
import { killVillager } from '../village/death';
import {
  ChronicleError,
  nowOf,
  personOf,
  residents,
  type ChronicleContext,
  type ReadState,
} from './common';

export type GrowthRules = NonNullable<VillageRules['growth']>;

export function growthRules(db: ContentDatabase): GrowthRules | null {
  return db.all('village-rules')[0]?.growth ?? null;
}

function requireGrowth(db: ContentDatabase): GrowthRules {
  const rules = growthRules(db);
  if (!rules) throw new ChronicleError('this content has no village growth');
  return rules;
}

const SCORE = 'prosperity-score';

export function prosperityScore(s: ReadState, db: ContentDatabase): number {
  return db.hasStat(SCORE) ? getStat(s, db, SCORE) : 0;
}

/** Level 1–5 of a score. */
export function prosperityLevel(score: number, thresholds: readonly number[]): number {
  let level = 1;
  thresholds.forEach((t, i) => {
    if (score >= t) level = i + 1;
  });
  return level;
}

export function villageLevel(s: ReadState, db: ContentDatabase): number {
  const rules = growthRules(db);
  return rules ? prosperityLevel(prosperityScore(s, db), rules.prosperityLevels) : 1;
}

export function population(s: ReadState, db: ContentDatabase): number {
  return residents(s, db).length;
}

/** Changes the prosperity score; a new best level applies its unlocks once. */
export function addProsperity(
  draft: WorldState,
  ctx: ChronicleContext,
  delta: number,
): CoreEvent[] {
  const rules = growthRules(ctx.db);
  if (!rules || !ctx.db.hasStat(SCORE) || delta === 0) return [];
  const before = villageLevel(draft, ctx.db);
  setStat(draft, ctx.db, SCORE, getStat(draft, ctx.db, SCORE) + delta);
  const after = villageLevel(draft, ctx.db);
  const out: CoreEvent[] = [];
  if (after !== before) out.push(event('village/prosperityChanged', { from: before, to: after }));
  while (draft.village.bestLevel < after) {
    draft.village.bestLevel += 1;
    for (const l of rules.levelEffects.filter((x) => x.level === draft.village.bestLevel))
      out.push(...ctx.apply(l.effects, `prosperity:${String(l.level)}`));
  }
  return out;
}

// --- buildings -------------------------------------------------------------------------------

export interface BuildPreview {
  building: string;
  level: number;
  /** Why it cannot start now (null: it can). */
  blocked: 'max' | 'in-progress' | 'prosperity' | 'requires' | 'materials' | null;
  missing: string | null;
}

/** The next level of a building and whether its work can start. */
export function buildPreview(s: ReadState, db: ContentDatabase, building: string): BuildPreview {
  const def = db.get('buildings', building);
  const level = (s.village.buildings[building] ?? 0) + 1;
  const next = def.levels.find((l) => l.level === level);
  const base = { building, level, missing: null };
  if (!next) return { ...base, blocked: 'max' };
  if (s.village.projects.some((p) => p.building === building))
    return { ...base, blocked: 'in-progress' };
  if (villageLevel(s, db) < next.minProsperity) return { ...base, blocked: 'prosperity' };
  if (next.requires && !evaluatorAt(s, db, s.clock.day, s.clock.minute)(next.requires))
    return { ...base, blocked: 'requires' };
  const missing = hasItems(s, next.cost.materials);
  if (missing !== null) return { ...base, blocked: 'materials', missing };
  return { ...base, blocked: null };
}

/** Starts the next level: materials leave the store, a blood price is paid, villagers work. */
export function startBuilding(
  draft: WorldState,
  ctx: ChronicleContext,
  building: string,
  shadow?: string,
): CoreEvent[] {
  requireGrowth(ctx.db);
  const preview = buildPreview(draft, ctx.db, building);
  if (preview.blocked !== null) throw new ChronicleError(`cannot build: ${preview.blocked}`);
  const next = ctx.db.get('buildings', building).levels.find((l) => l.level === preview.level);
  if (!next) throw new ChronicleError('no such level');
  const out: CoreEvent[] = [];
  if (next.blood !== undefined) {
    if (!ctx.fear) throw new ChronicleError('no blood without fear rules');
    if (shadow === undefined) throw new ChronicleError('a shadow must be walled in');
    out.push(...makeSacrifice(draft, ctx.fear, next.blood, shadow, nowOf(draft)));
  }
  takeItems(draft, ctx.db, next.cost.materials);
  draft.village.projects.push({
    building,
    level: preview.level,
    labour: 0,
    needed: next.cost.labourDays,
  });
  out.push(event('village/buildStarted', { building, level: preview.level }));
  if (next.cost.labourDays === 0) out.push(...addLabour(draft, ctx, 0));
  return out;
}

/** Labour days reach the oldest project; finished levels take effect. */
export function addLabour(draft: WorldState, ctx: ChronicleContext, days: number): CoreEvent[] {
  const project = draft.village.projects[0];
  if (!project) return [];
  project.labour += days;
  return project.labour >= project.needed ? finishProject(draft, ctx, project.building) : [];
}

function finishProject(draft: WorldState, ctx: ChronicleContext, building: string): CoreEvent[] {
  const project = draft.village.projects.find((p) => p.building === building);
  if (!project) return [];
  draft.village.projects = draft.village.projects.filter((p) => p !== project);
  const def = ctx.db.get('buildings', building);
  const level = def.levels.find((l) => l.level === project.level);
  if (!level) return [];
  draft.village.buildings[building] = project.level;
  return [
    event('village/buildingBuilt', { building, level: project.level }),
    ...ctx.apply(level.effects, `building:${building}`),
    ...addProsperity(draft, ctx, level.prosperity),
  ];
}

/** A building stands from the start (Bloodline: House of the Bell). */
export function ensureBuilt(
  draft: WorldState,
  ctx: ChronicleContext,
  building: string,
): CoreEvent[] {
  if (!ctx.db.has('buildings', building) || (draft.village.buildings[building] ?? 0) >= 1)
    return [];
  draft.village.projects = draft.village.projects.filter((p) => p.building !== building);
  draft.village.projects.unshift({ building, level: 1, labour: 0, needed: 0 });
  return finishProject(draft, ctx, building);
}

// --- residents -------------------------------------------------------------------------------

const ageIn = (born: number, year: number): number => year - born;

function pick<T>(ctx: ChronicleContext, list: readonly T[]): T | undefined {
  return list.length === 0 ? undefined : list[ctx.rng.int(0, list.length - 1)];
}

/** A new resident (a birth, a newcomer, the first guardian). */
export function newPerson(
  draft: WorldState,
  ctx: ChronicleContext,
  init: Pick<Person, 'sex' | 'born' | 'origin' | 'role' | 'parents'> & Partial<Person>,
): Person {
  const rules = requireGrowth(ctx.db);
  const names = init.sex === 'female' ? rules.names.female : rules.names.male;
  const person: Person = {
    id: `p-${String(draft.village.nextPerson)}`,
    nameKey: pick(ctx, names) ?? names[0] ?? 'name.unknown',
    tradeKey: null,
    secret: null,
    alive: true,
    left: false,
    died: null,
    look: ctx.rng.int(0, 9999),
    calling: null,
    ...init,
  };
  draft.village.nextPerson += 1;
  draft.village.people.push(person);
  return person;
}

/** A villager or a person dies of their years. */
function dieOfAge(draft: WorldState, ctx: ChronicleContext, id: string, year: number): CoreEvent[] {
  const p = personOf(draft, id);
  if (!p) return killVillager(draft, ctx.db, id, 'old-age', nowOf(draft));
  p.alive = false;
  p.died = year;
  return [event('village/residentLeft', { person: id, how: 'died' })];
}

function single(draft: ReadState, id: string): boolean {
  return draft.village.partners[id] === undefined;
}

function siblings(a: { parents: readonly string[] }, b: { parents: readonly string[] }): boolean {
  return a.parents.some((x) => b.parents.includes(x));
}

/**
 * One year of the village: the old die, couples marry, children are born, newcomers arrive, the
 * poor flee, children take a trade. The guardian is aged by the lineage, not here.
 */
export function villageYear(draft: WorldState, ctx: ChronicleContext, year: number): CoreEvent[] {
  const rules = growthRules(ctx.db);
  if (!rules) return [];
  const pop = rules.population;
  const guardian = draft.lineage.guardian;
  const out: CoreEvent[] = [];
  let births = 0;
  let deaths = 0;
  let arrivals = 0;
  let departures = 0;

  // The old die.
  for (const r of residents(draft, ctx.db)) {
    if (r.id === guardian) continue;
    const age = ageIn(r.born, year);
    const over = age - pop.elderAge;
    if (over <= 0) continue;
    if (age >= pop.maxAge || ctx.rng.next() < pop.oldAgeDeath * over) {
      out.push(...dieOfAge(draft, ctx, r.id, year));
      deaths += 1;
    }
  }

  // Couples marry (the guardian marries by choice).
  const adults = residents(draft, ctx.db).filter(
    (r) => ageIn(r.born, year) >= pop.adultAge && r.id !== guardian && single(draft, r.id),
  );
  for (const woman of adults.filter((r) => r.sex === 'female')) {
    if (!single(draft, woman.id) || ctx.rng.next() >= pop.marriageChance) continue;
    const man = pick(
      ctx,
      adults.filter(
        (r) =>
          r.sex === 'male' &&
          single(draft, r.id) &&
          Math.abs(r.born - woman.born) <= 12 &&
          !siblings(r, woman),
      ),
    );
    if (!man) continue;
    draft.village.partners[woman.id] = man.id;
    draft.village.partners[man.id] = woman.id;
  }

  // Children are born.
  const living = new Map(residents(draft, ctx.db).map((r) => [r.id, r]));
  const lrules = ctx.db.all('progression-rules')[0]?.lineage;
  for (const [a, b] of Object.entries(draft.village.partners)) {
    const mother = living.get(a);
    const father = living.get(b);
    if (!mother || !father || mother.sex !== 'female') continue;
    const age = ageIn(mother.born, year);
    if (age < pop.adultAge + 2 || age > 42 || living.size >= pop.cap) continue;
    const house = a === guardian || b === guardian;
    const kids = draft.village.people.filter((p) => p.parents.includes(a) && p.parents.includes(b));
    if (house && lrules && kids.length >= lrules.maxChildren) continue;
    const chance = house && lrules ? lrules.childChance : pop.birthChance;
    if (ctx.rng.next() >= chance) continue;
    const child = newPerson(draft, ctx, {
      sex: ctx.rng.next() < 0.5 ? 'female' : 'male',
      born: year,
      origin: 'born',
      role: house ? 'child' : 'villager',
      parents: [a, b],
    });
    births += 1;
    out.push(event('village/residentArrived', { person: child.id, origin: 'born' }));
    if (house) out.push(event('lineage/familyChanged', { person: child.id, role: 'child' }));
  }

  // Newcomers arrive, with a secret.
  const level = villageLevel(draft, ctx.db);
  if (
    population(draft, ctx.db) < pop.cap &&
    ctx.rng.next() < (pop.outsiderChance[level - 1] ?? 0)
  ) {
    const secret = pick(
      ctx,
      rules.secrets.filter((x) => x.minProsperity <= level),
    );
    const p = newPerson(draft, ctx, {
      sex: ctx.rng.next() < 0.5 ? 'female' : 'male',
      born: year - ctx.rng.int(18, 40),
      origin: 'outsider',
      role: 'villager',
      parents: [],
      tradeKey: pick(ctx, rules.trades) ?? null,
      secret: secret?.id ?? null,
    });
    arrivals += 1;
    out.push(event('village/residentArrived', { person: p.id, origin: 'outsider' }));
  }

  // The poor flee: a family of newcomers or their children packs up.
  if (level === 1) {
    for (const p of draft.village.people) {
      if (!p.alive || p.left || p.role !== 'villager' || ageIn(p.born, year) < pop.adultAge)
        continue;
      if (ctx.rng.next() >= pop.flightChance) continue;
      const family = draft.village.people.filter(
        (x) =>
          x.alive &&
          !x.left &&
          x.role === 'villager' &&
          (x === p ||
            draft.village.partners[p.id] === x.id ||
            (x.parents.includes(p.id) && ageIn(x.born, year) < pop.adultAge)),
      );
      for (const x of family) {
        x.left = true;
        departures += 1;
        out.push(event('village/residentLeft', { person: x.id, how: 'fled' }));
      }
    }
  }

  // Children come of age and take a trade.
  for (const p of draft.village.people) {
    if (p.alive && !p.left && p.tradeKey === null && ageIn(p.born, year) >= pop.adultAge)
      p.tradeKey = pick(ctx, rules.trades) ?? null;
  }

  // Unfinished work is done by the year's end.
  for (const project of [...draft.village.projects])
    out.push(...finishProject(draft, ctx, project.building));

  const size = population(draft, ctx.db);
  out.push(
    ...addProsperity(
      draft,
      ctx,
      Math.round(rules.prosperity.perResident * size) - rules.prosperity.decayPerYear,
    ),
  );
  draft.village.year = year;
  draft.village.log.push({
    year,
    population: size,
    prosperity: prosperityScore(draft, ctx.db),
    births,
    deaths,
    arrivals,
    departures,
  });
  if (draft.village.log.length > 500) draft.village.log.shift();
  out.push(event('village/yearTurned', { year, population: size }));
  return out;
}

// --- festival chapters -----------------------------------------------------------------------

/** Performs a rite of the running chapter: one option, once; a check decides it (with omen). */
export function performRite(
  draft: WorldState,
  ctx: ChronicleContext,
  rite: string,
  option: string,
  roll: (skill: string, difficulty: string) => { success: boolean; events: CoreEvent[] },
): CoreEvent[] {
  const chapter = draft.calendar.chapterId;
  if (chapter === null) throw new ChronicleError('no festival is running');
  const def = ctx.db.get('festivals', chapter).rites.find((r) => r.id === rite);
  if (!def) throw new ChronicleError('no such rite in this chapter');
  const key = `${chapter}/${rite}`;
  if (draft.village.rites.includes(key)) throw new ChronicleError('rite already performed');
  if (draft.calendar.nightIndex < def.fromNight - 1) throw new ChronicleError('not yet');
  const opt = def.options.find((o) => o.id === option);
  if (!opt) throw new ChronicleError('no such option');
  const out: CoreEvent[] = [];
  let success = true;
  if (opt.check) {
    const r = roll(opt.check.skill, opt.check.difficulty);
    success = r.success;
    out.push(...r.events);
  }
  draft.village.rites.push(key);
  out.push(event('festival/ritePerformed', { festival: chapter, rite, option, success }));
  out.push(...ctx.apply(success ? opt.effects : opt.failEffects, `rite:${key}`));
  return out;
}

/** Zadushnitsa: every dead villager laid badly (or not at all) walks again at once. */
export function restlessDead(draft: WorldState): CoreEvent[] {
  const out: CoreEvent[] = [];
  for (const [id, v] of Object.entries(draft.villagers).sort(([a], [b]) => a.localeCompare(b))) {
    if (v.status !== 'dead' || !v.death || v.death.burial === 'proper') continue;
    v.status = 'returned';
    out.push(event('villager/statusChanged', { villager: id, from: 'dead', to: 'returned' }));
    out.push(event('villager/returned', { villager: id }));
  }
  return out;
}

/** Kukeri bells: hidden possessions surface as visible symptoms. */
export function surfacePossessions(draft: WorldState): CoreEvent[] {
  const out: CoreEvent[] = [];
  for (const p of draft.possessions) {
    if (p.revealed) continue;
    p.revealed = true;
    out.push(event('possession/symptomSeen', { villager: p.host, symptom: 'kukeri-bells' }));
  }
  return out;
}

/** Chapter starts and ends, deaths and lynchings, new years: the village's reactions. */
export function growthAfter(
  draft: WorldState,
  ctx: ChronicleContext,
  events: readonly CoreEvent[],
): CoreEvent[] {
  const rules = growthRules(ctx.db);
  const out: CoreEvent[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'time/chapterStarted': {
        const f = ctx.db.get('festivals', e.payload.chapter);
        draft.village.rites = [];
        out.push(...ctx.apply(f.rules, `festival:${f.id}`));
        out.push(
          ...ctx.apply(
            f.quests.map((q) => ({ startQuest: q })),
            `festival:${f.id}`,
          ),
        );
        break;
      }
      case 'time/chapterEnded': {
        const f = ctx.db.get('festivals', e.payload.chapter);
        draft.modifiers = draft.modifiers.filter((m) => m.source !== `festival:${f.id}`);
        draft.village.rites = [];
        out.push(...ctx.apply(f.onEnd, `festival:${f.id}`));
        if (rules) out.push(...addProsperity(draft, ctx, rules.prosperity.chapterObserved));
        break;
      }
      case 'villager/died':
        if (rules) out.push(...addProsperity(draft, ctx, -rules.prosperity.death));
        break;
      case 'hysteria/lynching':
        if (rules) out.push(...addProsperity(draft, ctx, -rules.prosperity.lynching));
        break;
      case 'debt/collected':
        if (rules) out.push(...addProsperity(draft, ctx, -rules.prosperity.debtCollected));
        break;
      default:
        break;
    }
  }
  return out;
}
