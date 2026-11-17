/**
 * Data-driven quests (docs/systems/quests.md → Implementation): stage advance, failure, rival
 * routes that exclude each other, and points of no return.
 */
import type { Condition, Effect } from '@mrak/content-schema';
import type { ContentDatabase } from './content/database';
import { event, type CoreEvent } from './events';
import type { Snapshot, WorldState } from './state/world-state';

type ReadState = Snapshot | WorldState;

/** The quest that blocks starting `questId` (active or done, excluding it either way), or null. */
export function questBlockedBy(
  state: ReadState,
  db: ContentDatabase,
  questId: string,
): string | null {
  const quest = db.get('quests', questId);
  for (const [id, q] of Object.entries(state.quests)) {
    if (id === questId || q.status === 'failed') continue;
    const other = db.find('quests', id);
    if (quest.excludes.includes(id) || other?.excludes.includes(questId)) return id;
  }
  return null;
}

/** Starts a quest unless a rival route blocks it. */
export function startQuest(draft: WorldState, db: ContentDatabase, questId: string): CoreEvent[] {
  const quest = db.get('quests', questId);
  if (draft.quests[quest.id]) return [];
  const by = questBlockedBy(draft, db, quest.id);
  if (by) return [event('quest/blocked', { quest: quest.id, by })];
  const stage = quest.stages[0];
  draft.quests[quest.id] = { status: 'active', stage: stage?.id ?? '' };
  return [
    event('quest/started', { quest: quest.id, stage: stage?.id ?? '' }),
    ...(stage?.noReturn ? [event('quest/noReturn', { quest: quest.id, stage: stage.id })] : []),
  ];
}

/** Rival quests still active fail when a quest completes. */
function failRivals(draft: WorldState, db: ContentDatabase, questId: string): CoreEvent[] {
  const events: CoreEvent[] = [];
  for (const [id, q] of Object.entries(draft.quests)) {
    if (q.status !== 'active' || id === questId) continue;
    const other = db.find('quests', id);
    if (db.get('quests', questId).excludes.includes(id) || other?.excludes.includes(questId)) {
      q.status = 'failed';
      events.push(event('quest/failed', { quest: id, by: questId }));
    }
  }
  return events;
}

/**
 * Evaluates active quests until nothing changes (a stage's effects may complete the next one).
 * `apply` runs effect lists with a source.
 */
export function advanceQuests(
  draft: WorldState,
  db: ContentDatabase,
  evaluate: (c: Condition) => boolean,
  apply: (effects: readonly Effect[], source: string) => CoreEvent[],
): CoreEvent[] {
  const events: CoreEvent[] = [];
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const quest of db.all('quests'))
      if (
        quest.startWhen &&
        !draft.quests[quest.id] &&
        questBlockedBy(draft, db, quest.id) === null &&
        evaluate(quest.startWhen)
      ) {
        events.push(...startQuest(draft, db, quest.id));
        changed = true;
      }
    for (const [id, q] of Object.entries(draft.quests)) {
      if (q.status !== 'active') continue;
      const quest = db.find('quests', id);
      if (!quest) continue;
      if (quest.failWhen && evaluate(quest.failWhen)) {
        q.status = 'failed';
        events.push(event('quest/failed', { quest: id }));
        changed = true;
        continue;
      }
      const index = quest.stages.findIndex((s) => s.id === q.stage);
      const stage = quest.stages[index];
      if (!stage || !stage.objectives.every((o) => o.optional || evaluate(o.condition))) continue;
      changed = true;
      events.push(...apply(stage.onComplete, `quest:${id}`));
      const next = quest.stages[index + 1];
      if (next) {
        q.stage = next.id;
        events.push(event('quest/stageAdvanced', { quest: id, stage: next.id }));
        if (next.noReturn) events.push(event('quest/noReturn', { quest: id, stage: next.id }));
      } else {
        q.status = 'done';
        events.push(event('quest/completed', { quest: id }), ...failRivals(draft, db, id));
      }
    }
    if (!changed) break;
  }
  return events;
}
