/**
 * The Endless Chronicle (docs/systems/endless-chronicle.md → Implementation): after any route
 * ending the years go on with procedural content — a mystery bound to living villagers, lesser
 * possessions, a harvest or a disaster — under an optional, rising Darkness level whose rewards
 * are horizontal (relic talents that replace a cell, Legacy), never endless power.
 */
import { Mystery, type FearRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { fearRules } from '../fear/common';
import { abandonMystery } from '../mysteries';
import { getStat } from '../state/stats';
import { newVillagerState, type WorldState } from '../state/world-state';
import { ChronicleError, type ChronicleContext, type ReadState } from './common';
import { growthRules, population, prosperityScore } from './growth';
import { ageOf } from './lineage';

export type EndlessRules = NonNullable<FearRules['endless']>;
type Generated = WorldState['endless']['generated'][number];

export function endlessRules(db: ContentDatabase): EndlessRules | null {
  return fearRules(db)?.endless ?? null;
}

function requireEndless(db: ContentDatabase): EndlessRules {
  const rules = endlessRules(db);
  if (!rules) throw new ChronicleError('this content has no Endless Chronicle');
  return rules;
}

const DARKNESS = 'darkness';

/** Legacy multiplier of the chosen Darkness level (1 without one). */
export function darknessMultiplier(s: ReadState, db: ContentDatabase): number {
  const level = s.endless.darkness;
  return db.all('darkness-levels').find((l) => l.level === level)?.legacyMultiplier ?? 1;
}

/** Chooses the Darkness level: up to one above the best played; its effects replace the old. */
export function setDarkness(draft: WorldState, ctx: ChronicleContext, level: number): CoreEvent[] {
  const rules = requireEndless(ctx.db);
  const e = draft.endless;
  if (!e.active) throw new ChronicleError('the Endless Chronicle has not begun');
  if (level > Math.min(rules.maxDarkness, e.best + 1)) throw new ChronicleError('too dark yet');
  const def = ctx.db.all('darkness-levels').find((l) => l.level === level);
  if (level > 0 && !def) throw new ChronicleError('no such Darkness level');
  draft.modifiers = draft.modifiers.filter((m) => m.source !== DARKNESS);
  const before = e.best;
  e.darkness = level;
  e.best = Math.max(e.best, level);
  const out: CoreEvent[] = [event('endless/darknessChanged', { level })];
  if (def) out.push(...ctx.apply(def.effects, DARKNESS));
  for (const r of rules.relics)
    if (r.darkness > before && r.darkness <= e.best)
      out.push(event('endless/relicUnlocked', { relic: r.id }));
  return out;
}

/** Begins the Endless Chronicle (after a route ending). */
export function startEndless(
  draft: WorldState,
  ctx: ChronicleContext,
  darkness: number,
): CoreEvent[] {
  requireEndless(ctx.db);
  if (!draft.endless.unlocked) throw new ChronicleError('finish a route first');
  if (draft.endless.active) throw new ChronicleError('already endless');
  draft.endless.active = true;
  return [event('endless/started', { darkness }), ...setDarkness(draft, ctx, darkness)];
}

/**
 * A relic talent replaces its cell's own talent for this line (a horizontal choice). Chosen
 * before the cell is bought; unchosen the same way.
 */
export function chooseRelic(
  draft: WorldState,
  db: ContentDatabase,
  relic: string,
  on: boolean,
): CoreEvent[] {
  const r = requireEndless(db).relics.find((x) => x.id === relic);
  if (!r) throw new ChronicleError('no such relic');
  if (draft.endless.best < r.darkness) throw new ChronicleError('not unlocked');
  const key = `${r.tree}/${r.cell}`;
  if (draft.guardian.talents.includes(key)) throw new ChronicleError('cell already bought');
  if (on) draft.endless.swaps[key] = r.talent;
  else
    draft.endless.swaps = Object.fromEntries(
      Object.entries(draft.endless.swaps).filter(([k]) => k !== key),
    );
  return [event('endless/relicChosen', { relic, on })];
}

// --- procedural mysteries --------------------------------------------------------------------

function shuffle<T>(ctx: ChronicleContext, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = ctx.rng.int(0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Binds a template to living villagers; null when no template fits the village. */
export function generateMystery(draft: WorldState, ctx: ChronicleContext): Generated | null {
  const rules = requireEndless(ctx.db);
  const living = ctx.db
    .all('villagers')
    .filter(
      (v) => draft.villagers[v.id]?.alive === true && (ageOf(draft, ctx.db, v.id) ?? v.age) >= 14,
    );
  const chapter = draft.calendar.chapterId ?? ctx.db.all('festivals')[0]?.id;
  if (chapter === undefined) return null;
  for (const t of shuffle(ctx, rules.mysteries)) {
    if (living.length < t.suspects) continue;
    const pool = shuffle(ctx, living);
    const culprit = pool.find((v) => v.traits.some((x) => t.culpritTraits.includes(x))) ?? pool[0];
    if (!culprit) continue;
    const innocents = pool.filter((v) => v.id !== culprit.id).slice(0, t.suspects - 1);
    const suspects = [culprit, ...innocents];
    const others = pool.filter((v) => !suspects.includes(v));
    const witness = (not: string): string =>
      (others[0] ?? innocents.find((v) => v.id !== not) ?? culprit).id;
    const id = `gen-${t.id}-${String(draft.endless.nextId)}`;
    const clues: Record<string, unknown>[] = [];
    const source = (c: (typeof t.clues)[number], who: string) => ({
      ...(c.place
        ? { kind: 'zone', ref: c.place.zone, poi: c.place.poi }
        : { kind: 'villager', ref: who }),
      ...(c.check ? { check: c.check } : {}),
    });
    const clue = (
      c: (typeof t.clues)[number],
      n: string,
      who: string,
      extra: Record<string, unknown>,
    ) => {
      clues.push({
        id: `${id}-${c.id}${n}`,
        nameKey: c.nameKey,
        descKey: c.descKey,
        reliability: c.reliability,
        sources: [source(c, who)],
        ...extra,
      });
    };
    for (const c of t.clues) {
      if (c.about === 'culprit')
        clue(c, '', witness(culprit.id), { supports: [`culprit:${culprit.id}`] });
      else if (c.about === 'cause')
        clue(c, '', witness(culprit.id), { supports: [`cause:${t.solution.cause}`] });
      else if (c.about === 'innocent')
        innocents.forEach((v, i) => {
          clue(c, `-${String(i + 1)}`, witness(v.id), { refutes: [`culprit:${v.id}`] });
        });
      else {
        const liar = innocents.find((v) => v.secrets.length > 0);
        const accused = innocents.find((v) => v !== liar);
        const secret = liar?.secrets[0];
        if (liar && accused && secret)
          clue(c, '', liar.id, {
            supports: [`culprit:${accused.id}`],
            liar: { villager: liar.id, secret: secret.id },
          });
      }
    }
    const parsed = Mystery.safeParse({
      id,
      tier: 'demo',
      nameKey: t.nameKey,
      questionKey: t.questionKey,
      chapter,
      deadlineNight: t.deadlineNight,
      suspects: suspects.map((v) => ({
        villager: v.id,
        whyGuiltyKey: t.whyGuiltyKey,
        whyInnocentKey: t.whyInnocentKey,
      })),
      causes: t.causes,
      remedies: t.remedies,
      clues,
      solution: { culprit: culprit.id, cause: t.solution.cause, remedy: t.solution.remedy },
      outcomes: [
        { culprit: culprit.id, ...t.right },
        ...innocents.map((v) => ({ culprit: v.id, ...t.wrong })),
      ],
      unsolved: t.unsolved,
    });
    if (!parsed.success) continue;
    draft.endless.nextId += 1;
    return parsed.data;
  }
  return null;
}

/**
 * A newcomer family settles: a villager of the village (tasks, routines, suspects), modelled on
 * an authored villager's place and routine, with a name of its own.
 */
function newcomer(draft: WorldState, ctx: ChronicleContext, year: number): CoreEvent[] {
  const all = ctx.db.all('villagers').filter((v) => !v.id.startsWith('gen-v-'));
  const model = all[ctx.rng.int(0, Math.max(0, all.length - 1))];
  const names = growthRules(ctx.db)?.names;
  if (!model || !names) return [];
  const sex = ctx.rng.next() < 0.5 ? ('female' as const) : ('male' as const);
  const pool = sex === 'female' ? names.female : names.male;
  const id = `gen-v-${String(draft.endless.nextId)}`;
  draft.endless.nextId += 1;
  const { dialogue: _ink, ...rest } = model;
  const v = {
    ...rest,
    id,
    nameKey: pool[ctx.rng.int(0, pool.length - 1)] ?? model.nameKey,
    sex,
    relationships: [],
    secrets: [],
    look: {
      ...model.look,
      beard: sex === 'male' && model.look.beard,
      headwear: sex === 'female' ? ('kerchief' as const) : model.look.headwear,
    },
  };
  ctx.db.registerVillager(v);
  draft.endless.villagers.push(v);
  if (draft.endless.villagers.length > 200) draft.endless.villagers.shift();
  draft.endless.born[id] = year - ctx.rng.int(18, 35);
  draft.villagers[id] = newVillagerState({});
  return [event('village/residentArrived', { person: id, origin: 'outsider' })];
}

// --- the year --------------------------------------------------------------------------------

function weighted<T extends { weight: number }>(
  ctx: ChronicleContext,
  list: readonly T[],
): T | undefined {
  const total = list.reduce((a, x) => a + x.weight, 0);
  let roll = ctx.rng.next() * total;
  for (const x of list) {
    roll -= x.weight;
    if (roll < 0) return x;
  }
  return list.at(-1);
}

/** One endless year: last year's case closes, a new one opens, the dark and the harvest come. */
export function endlessYear(draft: WorldState, ctx: ChronicleContext, year: number): CoreEvent[] {
  const rules = endlessRules(ctx.db);
  const e = draft.endless;
  if (!rules || !e.active) return [];
  const out: CoreEvent[] = [];
  e.years += 1;
  out.push(event('endless/yearStarted', { year, darkness: e.darkness }));

  // Last year's case goes cold.
  const mctx = { db: ctx.db, apply: ctx.apply, rng: ctx.checks };
  for (const g of e.generated)
    if (draft.mysteries[g.id]?.status === 'active') out.push(...abandonMystery(draft, mctx, g.id));

  // Too few left to carry the valley's stories: newcomer families settle.
  const needed = Math.max(...rules.mysteries.map((t) => t.suspects)) + 2;
  for (let i = 0; i < 3; i++) {
    const alive = ctx.db.all('villagers').filter((v) => draft.villagers[v.id]?.alive === true);
    if (alive.length >= needed) break;
    out.push(...newcomer(draft, ctx, year));
  }

  // A new case.
  const m = generateMystery(draft, ctx);
  if (m) {
    ctx.db.registerMystery(m);
    e.generated.push(m);
    if (e.generated.length > 50) e.generated.shift();
    out.push(event('endless/mysteryGenerated', { mystery: m.id }));
    out.push(...ctx.apply([{ startMystery: m.id }], 'endless'));
  }

  // Lesser possessions; from `combineFrom` two demons may share a host.
  const demons = ctx.db.all('demons').filter((d) => d.rank <= rules.possessions.maxRank);
  const count = ctx.rng.int(
    rules.possessions.perYear.min,
    Math.max(rules.possessions.perYear.min, rules.possessions.perYear.max),
  );
  for (let i = 0; i < count && demons.length > 0; i++) {
    const hosts = ctx.db.all('villagers').filter((v) => draft.villagers[v.id]?.alive === true);
    const host = hosts[ctx.rng.int(0, Math.max(0, hosts.length - 1))];
    const demon = demons[ctx.rng.int(0, demons.length - 1)];
    if (!host || !demon) break;
    out.push(...ctx.apply([{ startPossession: demon.id, host: host.id }], 'endless'));
    const second = demons.find((d) => d.id !== demon.id);
    if (e.darkness >= rules.possessions.combineFrom && second)
      out.push(...ctx.apply([{ startPossession: second.id, host: host.id }], 'endless'));
  }

  // A harvest or a disaster.
  const h = weighted(
    ctx,
    rules.harvests.filter((x) => x.minDarkness <= e.darkness),
  );
  if (h) {
    e.harvests.push({ year, harvest: h.id });
    if (e.harvests.length > 200) e.harvests.shift();
    out.push(event('endless/harvest', { harvest: h.id }));
    out.push(...ctx.apply(h.effects, `harvest:${h.id}`));
  }
  return out;
}

// --- the Chronicle board ---------------------------------------------------------------------

export interface GoalProgress {
  id: string;
  category: 'village' | 'lineage' | 'collection';
  nameKey: string;
  value: number;
  target: number;
  done: boolean;
  legacy: number;
}

function metric(
  s: ReadState,
  db: ContentDatabase,
  m: EndlessRules['goals'][number]['metric'],
): number {
  switch (m) {
    case 'prosperity':
      return prosperityScore(s, db);
    case 'population':
      return population(s, db);
    case 'building-levels':
      return Object.values(s.village.buildings).reduce((a, b) => a + b, 0);
    case 'generation':
      return db.hasStat('generation') ? getStat(s, db, 'generation') : 1;
    case 'mysteries-solved':
      return Object.values(s.mysteries).filter((x) => x.conclusion?.correct === true).length;
    case 'collection-found':
      return s.collection.found.length;
    case 'darkness-best':
      return s.endless.best;
    case 'endless-years':
      return s.endless.years;
  }
}

/** Village, lineage and collection goals with their progress. */
export function chronicleGoals(s: ReadState, db: ContentDatabase): GoalProgress[] {
  const rules = endlessRules(db);
  if (!rules) return [];
  return rules.goals.map((g) => {
    const value = metric(s, db, g.metric);
    return {
      id: g.id,
      category: g.category,
      nameKey: g.nameKey,
      value,
      target: g.target,
      done: value >= g.target,
      legacy: g.legacy,
    };
  });
}

/** Route endings unlock the chronicle; goals reached are rewarded once. */
export function endlessAfter(
  draft: WorldState,
  ctx: ChronicleContext,
  events: readonly CoreEvent[],
): CoreEvent[] {
  if (!endlessRules(ctx.db)) return [];
  const out: CoreEvent[] = [];
  for (const e of events)
    if (
      e.type === 'quest/completed' &&
      ctx.db.find('quests', e.payload.quest)?.kind === 'route' &&
      !draft.endless.unlocked
    ) {
      draft.endless.unlocked = true;
      out.push(event('endless/unlocked', { route: e.payload.quest }));
    }
  if (events.length === 0) return out;
  for (const g of chronicleGoals(draft, ctx.db))
    if (g.done && !draft.endless.goals.includes(g.id)) {
      draft.endless.goals.push(g.id);
      out.push(event('endless/goalReached', { goal: g.id, legacy: g.legacy }));
    }
  return out;
}
