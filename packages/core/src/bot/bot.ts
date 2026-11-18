/**
 * Headless play bot (docs/systems/testing.md → Bot): plays a real Game through N nights with
 * seeded random decisions, no browser. After every command it checks invariants; it reports
 * exceptions, soft-locks (time that cannot advance) and impossible states. Pure: no I/O.
 */
import type { ContentDatabase } from '../content/database';
import type { CoreEvent } from '../events';
import { Game, type Command } from '../game';
import { createRandom, type IRandom } from '../random';
import { residents } from '../chronicle/common';
import { waitingHeir } from '../chronicle/lineage';
import { WorldStateSchema, type Snapshot } from '../state/world-state';

export interface BotOptions {
  seed: number;
  nights: number;
  /** Safety cap on commands (a soft-lock guard). */
  maxCommands?: number;
}

export interface BotReport {
  seed: number;
  nights: number;
  commands: number;
  rejected: number;
  deaths: number;
  heirs: number;
  /** Chronicles that ended ("the line ends") and were restarted. */
  endings: number;
  events: number;
  /** Exceptions, soft-locks and impossible states; empty = a clean run. */
  problems: string[];
}

/** JSON text of a value (`undefined` when absent). */
const show = (v: unknown): string => (v === undefined ? 'undefined' : JSON.stringify(v));

/** Paths where two JSON values differ (first few). */
export function diffPaths(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (out.length >= 5 || JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
      diffPaths(x[k], y[k], `${path}.${k}`, out);
  } else out.push(`${path}: ${show(a)} → ${show(b)}`);
  return out;
}

/** Minutes since the chronicle start (monotonic game time). */
const minutes = (s: Snapshot) => s.clock.day * 1440 + s.clock.minute;

/** Invariants every snapshot must hold (beyond its schema). */
export function impossibleStates(s: Snapshot): string[] {
  const out: string[] = [];
  const parsed = WorldStateSchema.safeParse(s);
  if (!parsed.success)
    out.push(
      `schema: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  for (const [k, v] of Object.entries(s.stats))
    if (!Number.isFinite(v)) out.push(`stat ${k}=${String(v)}`);
  for (const [vid, stats] of Object.entries(s.villagerStats))
    for (const [k, v] of Object.entries(stats))
      if (!Number.isFinite(v)) out.push(`villager ${vid} stat ${k}=${String(v)}`);
  if (s.clock.minute < 0 || s.clock.minute >= 1440)
    out.push(`clock minute ${String(s.clock.minute)}`);
  if (s.currentZone !== null && !(s.currentZone in s.zones))
    out.push(`unknown zone ${s.currentZone}`);
  return out;
}

function choices(db: ContentDatabase, r: IRandom) {
  const calling = r.pick(db.all('callings'));
  return {
    calling: calling.id,
    tree: r.pick(calling.trees),
    bonus: r.pick(db.all('attributes')).id,
    virtue: r.pick(db.all('virtues')).id,
    sin: r.pick(db.all('sins')).id,
  };
}

/** One random command that a player could issue now (weighted towards letting time pass). */
function nextCommand(game: Game, db: ContentDatabase, r: IRandom): Command {
  const s = game.snapshot();
  const active = s.night.encounters.filter((e) => e.state === 'active');
  if (active.length > 0 && r.next() < 0.7) {
    const e = r.pick(active);
    if (r.next() < 0.08) return { type: 'creatureStrikes', encounter: e.id };
    return {
      type: 'nightAction',
      encounter: e.id,
      action: r.pick(['flash', 'ritual', 'strike', 'dodge', 'flee', 'sneak'] as const),
    };
  }
  const roll = r.next();
  const zone = s.currentZone ? db.find('zones', s.currentZone) : undefined;
  if (roll < 0.45) return { type: 'advanceTime', minutes: 30 };
  if (roll < 0.52) return { type: 'enterZone', zone: r.pick(db.all('zones')).id };
  if (roll < 0.64 && zone && zone.pois.length > 0) {
    const poi = r.pick(zone.pois).id;
    return r.next() < 0.4
      ? { type: 'discoverPoi', zone: zone.id, poi }
      : { type: 'interactPoi', zone: zone.id, poi };
  }
  if (roll < 0.72) {
    const v = r.pick(db.all('villagers')).id;
    const tones = game.toneOptions().filter((t) => t.blockedBy === null);
    return tones.length > 0 && r.next() < 0.6
      ? { type: 'talkTo', villager: v, tone: r.pick(tones).tone.id }
      : { type: 'talkTo', villager: v };
  }
  if (roll < 0.78)
    return {
      type: 'assignTask',
      villager: r.pick(db.all('villagers')).id,
      slot: r.pick(['day', 'night'] as const),
      task: r.next() < 0.2 ? null : r.pick(db.all('tasks')).id,
    };
  if (roll < 0.82) {
    const talents = game.affordableTalents();
    if (talents.length > 0) {
      const t = r.pick(talents);
      return { type: 'buyTalent', tree: t.tree, cell: t.cell };
    }
  }
  if (roll < 0.85) {
    const builds = game.buildPreviews().filter((b) => b.blocked === null);
    if (builds.length > 0) return { type: 'build', building: r.pick(builds).building };
  }
  if (roll < 0.9) return { type: 'setLanternLit', lit: r.next() < 0.7 };
  if (roll < 0.94) return { type: 'setInDarkness', dark: r.next() < 0.3 };
  if (roll < 0.96) return { type: 'rest', minutes: r.pick([30, 60, 120]) };
  if (roll < 0.97) {
    // Family (lineage.md): marry or take an apprentice, so deaths can pass to an heir.
    const people = residents(s, db).filter((p) => p.id !== s.lineage.guardian);
    if (people.length > 0)
      return { type: r.next() < 0.5 ? 'takeApprentice' : 'marry', person: r.pick(people).id };
  }
  return { type: 'advanceTime', minutes: 60 };
}

function newChronicle(
  db: ContentDatabase,
  seed: number,
  r: IRandom,
  problem: (what: string) => void,
): Game {
  const game = Game.newGame({ content: db, seed });
  try {
    const created = game.dispatch({ type: 'createGuardian', ...choices(db, r) });
    if (!created.ok) problem(`createGuardian rejected: ${created.reason}`);
  } catch (err) {
    problem(`createGuardian threw: ${String(err)}`);
  }
  return game;
}

export function playBot(db: ContentDatabase, options: BotOptions): BotReport {
  const r = createRandom(options.seed ^ 0x5eed);
  const report: BotReport = {
    seed: options.seed,
    nights: 0,
    commands: 0,
    rejected: 0,
    deaths: 0,
    heirs: 0,
    endings: 0,
    events: 0,
    problems: [],
  };
  const problem = (what: string) => {
    if (report.problems.length < 20) report.problems.push(`seed ${String(options.seed)}: ${what}`);
  };
  let game = newChronicle(db, options.seed, r, problem);
  // Day each chronicle's nights are counted from (a restart continues the count).
  const startDays = [game.snapshot().clock.day];
  const max = options.maxCommands ?? options.nights * 2000;
  let lastTime = minutes(game.snapshot());
  let stalled = 0;
  let lastDay = game.snapshot().clock.day;

  const count = (events: readonly CoreEvent[]) => {
    report.events += events.length;
    for (const e of events) if (e.type === 'guardian/died') report.deaths++;
  };

  while (report.nights < options.nights && report.commands < max) {
    const s = game.snapshot();
    let command: Command;
    if (s.lineage.awaitingHeir) {
      const heirs = game.heirCandidates();
      if (s.lineage.ended) {
        // "The line ends": the chronicle is over (lineage.md); the player starts a new one.
        report.endings++;
        game = newChronicle(db, options.seed + report.endings * 7919, r, problem);
        lastTime = minutes(game.snapshot());
        lastDay = game.snapshot().clock.day;
        startDays.push(lastDay - report.nights);
        continue;
      }
      if (heirs.length > 0) {
        command = { type: 'chooseHeir', heir: r.pick(heirs) };
        report.heirs++;
      } else if (waitingHeir(s)) command = { type: 'skipYears', years: 1 };
      else {
        // The heir screen would show nothing and cannot be closed (HeirChoice.tsx).
        problem(`awaiting an heir with none, none growing up and the line not ended (soft-lock)`);
        break;
      }
    } else command = nextCommand(game, db, r);

    let result;
    try {
      result = game.dispatch(command);
    } catch (err) {
      problem(`${command.type} threw: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
    report.commands++;
    count(result.events);
    if (!result.ok) report.rejected++;

    const after = game.snapshot();
    for (const p of impossibleStates(after)) problem(`after ${command.type}: ${p}`);
    if (report.problems.length > 0) break;

    // Soft-lock: game time must keep moving when the bot asks it to.
    const now = minutes(after);
    if (now < lastTime) problem(`time went backwards after ${command.type}`);
    if (now > lastTime) stalled = 0;
    else if (command.type === 'advanceTime' || command.type === 'rest') {
      stalled++;
      if (stalled >= 20) {
        problem(
          `time stuck at day ${String(after.clock.day)} ${String(after.clock.minute)}: ${result.ok ? 'no progress' : result.reason}`,
        );
        break;
      }
    }
    lastTime = now;

    // A new day: the night before is done; saves must round-trip.
    if (after.clock.day > lastDay) {
      lastDay = after.clock.day;
      report.nights = after.clock.day - (startDays.at(-1) ?? after.clock.day);
      try {
        const loaded = Game.load(JSON.parse(JSON.stringify(game.save())), { content: db });
        const before = JSON.parse(JSON.stringify(game.snapshot())) as unknown;
        const diff = diffPaths(before, JSON.parse(JSON.stringify(loaded.snapshot())) as unknown);
        if (diff.length > 0)
          problem(
            `save/load round-trip differs on day ${String(after.clock.day)}: ${diff.join(', ')}`,
          );
      } catch (err) {
        problem(`save/load threw: ${String(err)}`);
      }
    }
  }
  if (report.nights < options.nights && report.problems.length === 0)
    problem(`only ${String(report.nights)} nights in ${String(report.commands)} commands`);
  return report;
}
