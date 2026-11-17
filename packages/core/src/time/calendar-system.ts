/**
 * Reacts to clock boundaries: festival chapters, night count, per-period ability resets and
 * calendar stats. Pure: mutates the given draft and returns the (enriched) event list.
 */
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { getStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { festivalsOn, jdnToJulian } from './calendar';

type UsePeriod = WorldState['abilities'][string]['per'];

function resetAbilities(draft: WorldState, per: UsePeriod): void {
  for (const ability of Object.values(draft.abilities)) {
    if (ability.per === per) ability.usesLeft = ability.uses;
  }
}

function setIfDeclared(
  draft: WorldState,
  db: ContentDatabase,
  stat: string,
  value: number,
): CoreEvent[] {
  if (!db.hasStat(stat)) return [];
  const [from, to] = setStat(draft, db, stat, value);
  return from === to ? [] : [event('state/statChanged', { stat, from, to })];
}

/**
 * Starts the festival chapter active on `day`, if no chapter is running. When joining mid-festival,
 * the nights already past are counted.
 */
export function syncChapter(draft: WorldState, db: ContentDatabase, day: number): CoreEvent[] {
  if (draft.calendar.chapterId !== null) return [];
  const active = festivalsOn(db.all('festivals'), day)[0];
  if (!active) return [];
  draft.calendar = {
    chapterId: active.festival.id,
    chapterStart: active.start,
    nightIndex: day - active.start,
  };
  resetAbilities(draft, 'chapter');
  return [
    event('time/chapterStarted', { chapter: active.festival.id, day }),
    ...setIfDeclared(draft, db, 'night-index', draft.calendar.nightIndex),
  ];
}

export function applyCalendar(
  draft: WorldState,
  db: ContentDatabase,
  clockEvents: readonly CoreEvent[],
): CoreEvent[] {
  const out: CoreEvent[] = [];
  for (const e of clockEvents) {
    switch (e.type) {
      case 'time/dayChanged':
        out.push(e);
        out.push(...setIfDeclared(draft, db, 'year', jdnToJulian(e.payload.day).year));
        out.push(...syncChapter(draft, db, e.payload.day));
        break;
      case 'time/nightStarted': {
        if (draft.calendar.chapterId !== null) draft.calendar.nightIndex += 1;
        resetAbilities(draft, 'night');
        out.push(
          event('time/nightStarted', { ...e.payload, nightIndex: draft.calendar.nightIndex }),
        );
        out.push(...setIfDeclared(draft, db, 'night-index', draft.calendar.nightIndex));
        break;
      }
      case 'time/dawn': {
        out.push(e);
        if (db.hasStat('nights-survived')) {
          out.push(
            ...setIfDeclared(
              draft,
              db,
              'nights-survived',
              getStat(draft, db, 'nights-survived') + 1,
            ),
          );
        }
        const { chapterId, chapterStart } = draft.calendar;
        if (chapterId !== null && chapterStart !== null) {
          const festival = db.get('festivals', chapterId);
          if (e.payload.day >= chapterStart + festival.nights) {
            draft.calendar = { chapterId: null, chapterStart: null, nightIndex: 0 };
            out.push(event('time/chapterEnded', { chapter: chapterId, day: e.payload.day }));
            out.push(...syncChapter(draft, db, e.payload.day));
          }
        }
        break;
      }
      case 'time/dayStarted':
        resetAbilities(draft, 'day');
        out.push(e);
        break;
      default:
        out.push(e);
    }
  }
  return out;
}
