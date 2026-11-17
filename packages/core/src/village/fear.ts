/**
 * Fear contagion (docs/systems/villagers.md → Formulas). Pure: the caller gathers the inputs from
 * the start-of-hour state, so the update is simultaneous and independent of villager order.
 */
import type { VillageRules } from '@mrak/content-schema';

export interface ContagionInput {
  /** Villagers taking part, in a stable order. */
  ids: readonly string[];
  fear: Readonly<Record<string, number>>;
  /** Affinity of `from` toward `to` (undefined = no relationship). */
  affinity: (from: string, to: string) => number | undefined;
  /** Spent the hour at the same place. */
  together: (a: string, b: string) => boolean;
  /** How strongly a villager spreads fear (traits). */
  spread: (id: string) => number;
  /** Multiplier on the fear a villager gains (traits × faith). */
  gain: (id: string) => number;
}

/** How much `v` is touched by `u`'s fear: care (affinity) plus proximity. */
export function contagionWeight(
  input: Pick<ContagionInput, 'affinity' | 'together'>,
  rules: Pick<VillageRules['fear'], 'proximityWeight'>,
  v: string,
  u: string,
): number {
  const care = input.affinity(v, u) ?? input.affinity(u, v) ?? 0;
  return Math.max(0, care) / 100 + (input.together(v, u) ? rules.proximityWeight : 0);
}

/** Fear each villager gains this hour from the others (≥ 0, capped before the gain factor). */
export function contagion(
  input: ContagionInput,
  rules: Pick<VillageRules['fear'], 'contagionRate' | 'contagionCap' | 'proximityWeight'>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of input.ids) {
    const fv = input.fear[v] ?? 0;
    let sum = 0;
    for (const u of input.ids) {
      if (u === v) continue;
      const fu = input.fear[u] ?? 0;
      if (fu <= fv) continue;
      sum +=
        contagionWeight(input, rules, v, u) * (fu - fv) * rules.contagionRate * input.spread(u);
    }
    out[v] = Math.min(rules.contagionCap, sum) * input.gain(v);
  }
  return out;
}
