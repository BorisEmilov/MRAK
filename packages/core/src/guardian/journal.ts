/**
 * Journal entries and forbidden knowledge (docs/systems/progression.md §10–§11): demons and
 * creatures learned, player notes, entries marked for the heir, and the hidden Notice stat.
 */
import type { ProgressionRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { effectiveStat, getStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { ProgressionError, type ReadState } from './rules';

export function addNotice(draft: WorldState, db: ContentDatabase, value: number): CoreEvent[] {
  if (value === 0 || !db.hasStat('notice')) return [];
  const [from, to] = setStat(draft, db, 'notice', getStat(draft, db, 'notice') + value);
  // Hidden stat: the change is an internal event only (the UI never shows the number).
  return from === to ? [] : [event('state/statChanged', { stat: 'notice', from, to })];
}

/** Weight multiplier of guardian-targeted director events (§10). */
export function directorWeight(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
): number {
  return 1 + effectiveStat(state, db, 'notice') / rules.notice.directorDivisor;
}

export function learn(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  kind: 'demon' | 'creature',
  id: string,
): CoreEvent[] {
  db.get(kind === 'demon' ? 'demons' : 'creatures', id);
  const entry = `${kind}:${id}`;
  if (draft.journal.learned.includes(entry)) return [];
  draft.journal.learned.push(entry);
  return [
    event('journal/learned', { kind, id, entry }),
    ...(kind === 'demon' ? addNotice(draft, db, rules.notice.learnDemon) : []),
  ];
}

export function writeNote(draft: WorldState, rules: ProgressionRules, text: string): CoreEvent[] {
  const clean = text.trim();
  if (clean.length === 0) throw new ProgressionError('empty note');
  if (clean.length > rules.journal.noteLength) throw new ProgressionError('note too long');
  if (draft.journal.notes.length >= rules.journal.maxNotes)
    throw new ProgressionError('journal full');
  const id = draft.journal.nextNote;
  draft.journal.nextNote += 1;
  draft.journal.notes.push({ id, text: clean, day: draft.clock.day, minute: draft.clock.minute });
  return [event('journal/noteWritten', { id })];
}

export function removeNote(draft: WorldState, id: number): CoreEvent[] {
  const before = draft.journal.notes.length;
  draft.journal.notes = draft.journal.notes.filter((n) => n.id !== id);
  if (draft.journal.notes.length === before) throw new ProgressionError('no such note');
  draft.journal.heir = draft.journal.heir.filter((e) => e !== `note:${String(id)}`);
  return [event('journal/noteRemoved', { id })];
}

/** Pages the heir can receive (the `journal-pages` stat). */
export function heirCapacity(state: ReadState, db: ContentDatabase): number {
  return db.hasStat('journal-pages') ? Math.floor(effectiveStat(state, db, 'journal-pages')) : 24;
}

export function markForHeir(
  draft: WorldState,
  db: ContentDatabase,
  entry: string,
  on: boolean,
): CoreEvent[] {
  const has = draft.journal.heir.includes(entry);
  if (on === has) return [];
  if (on) {
    if (draft.journal.heir.length >= heirCapacity(draft, db))
      throw new ProgressionError('journal full');
    draft.journal.heir.push(entry);
  } else draft.journal.heir = draft.journal.heir.filter((e) => e !== entry);
  return [event('journal/heirMarked', { entry, heir: on })];
}
