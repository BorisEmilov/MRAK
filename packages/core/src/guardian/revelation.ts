/**
 * Revelation milestones (docs/systems/progression.md R1–R5): awarded from content-declared core
 * events or by the `milestone` effect, recorded in a ledger. Never from killing (R3).
 */
import type { Milestone } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { getStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';

export const LEDGER_LIMIT = 2000;

/** The id a per-target milestone is keyed on, from the event payload. */
export function targetOf(e: CoreEvent): string | undefined {
  const p = e.payload as Record<string, unknown>;
  if (e.type === 'time/chapterEnded') return `${String(p['chapter'])}:${String(p['day'])}`;
  for (const key of [
    'zone',
    'layer',
    'entry',
    'recipe',
    'clue',
    'collectible',
    'object',
    'set',
    'category',
  ])
    if (typeof p[key] === 'string') return p[key];
  return undefined;
}

function matches(m: Milestone, e: CoreEvent): boolean {
  if (m.on?.event !== e.type) return false;
  const payload = e.payload as Record<string, unknown>;
  return Object.entries(m.on.match ?? {}).every(([k, v]) => payload[k] === v);
}

/** Grants a milestone once per its `repeat` rule. Returns [] when already granted. */
export function awardMilestone(
  draft: WorldState,
  db: ContentDatabase,
  id: string,
  target?: string,
): CoreEvent[] {
  const m = db.get('milestones', id);
  const g = draft.guardian;
  if (g.callingId === null) return [];
  const key =
    m.repeat === 'once' ? m.id : m.repeat === 'per-target' ? `${m.id}:${target ?? ''}` : null;
  if (key !== null) {
    if (g.milestones.includes(key)) return [];
    g.milestones.push(key);
  }
  const { day, minute } = draft.clock;
  g.revelation.ledger.push({
    milestone: m.id,
    amount: m.amount,
    ...(target !== undefined ? { target } : {}),
    day,
    minute,
  });
  if (g.revelation.ledger.length > LEDGER_LIMIT)
    g.revelation.ledger.splice(0, g.revelation.ledger.length - LEDGER_LIMIT);
  g.revelation.lifetime += m.amount;
  setStat(draft, db, 'revelation', getStat(draft, db, 'revelation') + m.amount);
  return [
    event('revelation/awarded', {
      milestone: m.id,
      amount: m.amount,
      reasonKey: m.reasonKey,
      ...(target !== undefined ? { target } : {}),
    }),
  ];
}

/** Milestones triggered by these events (R1). */
export function milestonesFor(
  draft: WorldState,
  db: ContentDatabase,
  events: readonly CoreEvent[],
): CoreEvent[] {
  if (draft.guardian.callingId === null) return [];
  const auto = db.all('milestones').filter((m) => m.on !== undefined);
  const out: CoreEvent[] = [];
  for (const e of events)
    for (const m of auto)
      if (matches(m, e)) out.push(...awardMilestone(draft, db, m.id, targetOf(e)));
  return out;
}
