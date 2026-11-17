/**
 * Night simulator of the event director (docs/systems/event-director.md → Implementation 9):
 * runs a real Game through N nights in 30-minute steps and returns the tension curve.
 */
import type { ContentDatabase } from '../content/database';
import { Game } from '../game';
import type { DirectorDecision } from '../state/world-state';
import { lightBoundaries, jdnToJulian } from '../time/calendar';

export interface TensionSample {
  night: number;
  at: number;
  phase: DirectorDecision['phase'];
  target: number;
  tension: number;
  outcome: DirectorDecision['outcome'];
  event: string | null;
  category: string | null;
}

export interface NightSummary {
  night: number;
  fired: number;
  peak: number;
  peakPhase: DirectorDecision['phase'] | null;
  /** Lowest tension after the night's peak. */
  valleyAfterPeak: number;
  categories: Record<string, number>;
}

export interface SimulateNightsOptions {
  seed: number;
  nights: number;
  /** Sanity lost per night by the simulated guardian (darkness, sightings…). */
  sanityLossPerNight?: number;
}

export function simulateNights(
  db: ContentDatabase,
  options: SimulateNightsOptions,
): { samples: TensionSample[]; nights: NightSummary[] } {
  const game = Game.newGame({ content: db, seed: options.seed });
  // Start at the first nightfall.
  const s0 = game.snapshot();
  const { nightStart } = lightBoundaries(jdnToJulian(s0.clock.day).month);
  const wait = (nightStart - s0.clock.minute + 1440) % 1440;
  if (wait > 0) game.dispatch({ type: 'advanceTime', minutes: wait });
  const samples: TensionSample[] = [];
  const nightDays: number[] = [];
  for (let step = 0; step < options.nights * 48; step++) {
    const result = game.dispatch({ type: 'advanceTime', minutes: 30 });
    if (!result.ok) throw new Error(`simulation stalled: ${result.reason}`);
    if (options.sanityLossPerNight && step % 48 === 47)
      game.dispatch({
        type: 'applyEffects',
        source: 'simulation',
        effects: [{ addStat: 'sanity', value: -options.sanityLossPerNight }],
      });
    const log = game.snapshot().director.log;
    // The log is capped; read only the decisions added since the last step.
    const fresh = log.filter(
      (d) => samples.length === 0 || d.at > (samples[samples.length - 1]?.at ?? -1),
    );
    for (const d of fresh) {
      if (!nightDays.includes(d.night)) nightDays.push(d.night);
      samples.push({
        night: nightDays.indexOf(d.night) + 1,
        at: d.at,
        phase: d.phase,
        target: d.target,
        tension: d.tension,
        outcome: d.outcome,
        event: d.event,
        category: d.category,
      });
    }
  }
  const nights: NightSummary[] = [];
  for (let n = 1; n <= nightDays.length && n <= options.nights; n++) {
    const list = samples.filter((x) => x.night === n);
    let peak = -1;
    let peakIndex = -1;
    list.forEach((x, i) => {
      if (x.tension > peak) {
        peak = x.tension;
        peakIndex = i;
      }
    });
    const after = list.slice(peakIndex + 1).map((x) => x.tension);
    const categories: Record<string, number> = {};
    for (const x of list)
      if (x.category) categories[x.category] = (categories[x.category] ?? 0) + 1;
    nights.push({
      night: n,
      fired: list.filter((x) => x.outcome === 'fired').length,
      peak: Math.max(0, peak),
      peakPhase: list[peakIndex]?.phase ?? null,
      valleyAfterPeak: after.length > 0 ? Math.min(...after) : Math.max(0, peak),
      categories,
    });
  }
  return { samples, nights };
}
