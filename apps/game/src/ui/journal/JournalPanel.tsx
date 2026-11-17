/**
 * The journal (docs/systems/progression.md J1–J3): Clues, Demons, Bestiary, Recipes, People,
 * Revelation and Notes. Entries can be marked to pass to the heir, up to the journal's pages.
 * Opened with J; the game waits while it is open.
 */
import type { LocaleKey } from '@mrak/content';
import { heirCapacity, jdnToJulian } from '@mrak/core';
import { Button, IconGlyph, Modal, Tabs, type IconName } from '@mrak/ui-kit';
import { useEffect, useState } from 'react';
import { formatDate, formatTime } from '../format';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import type { JournalTab } from '../../state/ui-store';
import {
  journalEntries,
  progressionReasonKey,
  type JournalEntry,
} from '../character/progression-ui';

function HeirToggle({ entry }: { entry: string }) {
  const { host } = useApp();
  const marked = useUi((s) => s.snapshot?.journal.heir.includes(entry) ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <label className="journal-heir" title={t('journal.heir-hint')}>
      <input
        type="checkbox"
        checked={marked}
        onChange={(e) => {
          const r = host.dispatch({ type: 'markForHeir', entry, heir: e.target.checked });
          setProblem(r.ok ? null : t(progressionReasonKey(r.reason)));
        }}
      />
      <IconGlyph name="ui.heir" size={16} tone="inherit" /> {t('journal.heir')}
      {problem && <span role="alert"> — {problem}</span>}
    </label>
  );
}

function EntryList({ entries, empty }: { entries: JournalEntry[]; empty: LocaleKey }) {
  if (entries.length === 0) return <p className="items-empty">{t(empty)}</p>;
  return (
    <ul className="journal-entries">
      {entries.map((e) => (
        <li key={e.key}>
          <strong>{e.title}</strong>
          {e.body && <p>{e.body}</p>}
          <HeirToggle entry={e.key} />
        </li>
      ))}
    </ul>
  );
}

function RevelationTab() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  if (!snapshot) return null;
  const ledger = [...snapshot.guardian.revelation.ledger].reverse();
  return (
    <div>
      <p className="journal-revelation">
        <IconGlyph name="resource.revelation" size={24} tone="inherit" />{' '}
        {t('journal.revelation-total', {
          available: snapshot.stats['revelation'] ?? 0,
          lifetime: snapshot.guardian.revelation.lifetime,
        })}
      </p>
      {ledger.length === 0 ? (
        <p className="items-empty">{t('journal.revelation-empty')}</p>
      ) : (
        <ol className="journal-ledger">
          {ledger.map((l, i) => (
            <li key={`${String(l.day)}-${String(l.minute)}-${String(i)}`}>
              <time>
                {formatDate(jdnToJulian(l.day))} {formatTime(l.minute)}
              </time>{' '}
              <strong>+{l.amount}</strong>{' '}
              {t(
                (host.content.find('milestones', l.milestone)?.reasonKey ??
                  l.milestone) as LocaleKey,
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NotesTab() {
  const { host } = useApp();
  const notes = useUi((s) => s.snapshot?.journal.notes ?? []);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div>
      <form
        className="journal-note-form"
        onSubmit={(e) => {
          e.preventDefault();
          const r = host.dispatch({ type: 'writeNote', text });
          if (r.ok) setText('');
          setProblem(r.ok ? null : t(progressionReasonKey(r.reason)));
        }}
      >
        <label htmlFor="journal-note">{t('journal.note-label')}</label>
        <textarea
          id="journal-note"
          value={text}
          maxLength={500}
          rows={3}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <Button variant="primary" type="submit" icon="ui.note">
          {t('journal.note-write')}
        </Button>
        {problem && <p role="alert">{problem}</p>}
      </form>
      {notes.length === 0 ? (
        <p className="items-empty">{t('journal.notes-empty')}</p>
      ) : (
        <ul className="journal-entries">
          {[...notes].reverse().map((n) => (
            <li key={n.id}>
              <time>
                {formatDate(jdnToJulian(n.day))} {formatTime(n.minute)}
              </time>
              <p>{n.text}</p>
              <HeirToggle entry={`note:${String(n.id)}`} />
              <Button
                variant="ghost"
                onClick={() => {
                  host.dispatch({ type: 'removeNote', id: n.id });
                }}
              >
                {t('journal.note-remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestsTab() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  if (!snapshot) return null;
  const db = host.content;
  const order = { active: 0, done: 1, failed: 2 } as const;
  const quests = Object.entries(snapshot.quests).sort(
    ([, a], [, b]) => order[a.status] - order[b.status],
  );
  if (quests.length === 0) return <p className="items-empty">{t('journal.quests-empty')}</p>;
  const check = (c: Parameters<typeof host.check>[0]) => host.check(c);
  return (
    <ul className="journal-entries journal-quests">
      {quests.map(([id, q]) => {
        const def = db.find('quests', id);
        if (!def) return null;
        const stage = def.stages.find((s) => s.id === q.stage);
        return (
          <li key={id} data-status={q.status}>
            <h4>
              <IconGlyph name={(def.icon ?? 'ui.quest') as IconName} size={24} tone="inherit" />{' '}
              {t(def.nameKey as LocaleKey)}{' '}
              <small>{t(`journal.quest.${q.status}` as LocaleKey)}</small>
            </h4>
            {q.status === 'active' && stage && (
              <>
                <p>{t(stage.descKey as LocaleKey)}</p>
                <ul className="journal-objectives">
                  {stage.objectives.map((o) => {
                    const done = check(o.condition);
                    return (
                      <li key={o.id} data-done={done || undefined}>
                        <IconGlyph name={done ? 'ui.check' : 'ui.quest'} size={16} tone="inherit" />{' '}
                        {t(o.descKey as LocaleKey)}
                        {o.optional && <small> {t('journal.quest.optional')}</small>}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function JournalPanel() {
  const { host, store } = useApp();
  const tab = useUi((s) => s.journal);
  const snapshot = useUi((s) => s.snapshot);
  const open = tab !== null && snapshot !== null;
  useEffect(() => {
    host.setPaused('panel', open);
    return () => {
      host.setPaused('panel', false);
    };
  }, [host, open]);
  if (!open) return null;
  const db = host.content;
  const list = (
    which: 'clues' | 'demons' | 'bestiary' | 'recipes' | 'people',
    empty: LocaleKey,
  ) => <EntryList entries={journalEntries(which, snapshot, db, t)} empty={empty} />;
  return (
    <Modal
      open
      title={t('journal.title')}
      size="xl"
      variant="parchment"
      onClose={() => {
        store.setState({ journal: null });
      }}
    >
      <p className="items-hint">
        {t('journal.heir-count', {
          used: snapshot.journal.heir.length,
          max: heirCapacity(snapshot, db),
        })}
      </p>
      <Tabs
        label={t('journal.tabs')}
        value={tab}
        onChange={(id) => {
          store.setState({ journal: id as JournalTab });
        }}
        tabs={[
          {
            id: 'clues',
            label: t('journal.tab.clues'),
            icon: 'ui.clues',
            content: (
              <>
                {Object.entries(snapshot.mysteries)
                  .filter(([, m]) => m.status === 'active')
                  .map(([id]) => (
                    <Button
                      key={id}
                      variant="primary"
                      icon="ui.clues"
                      onClick={() => {
                        store.setState({ journal: null, board: id });
                      }}
                    >
                      {t('board.open')}: {t((db.find('mysteries', id)?.nameKey ?? id) as LocaleKey)}
                    </Button>
                  ))}
                {list('clues', 'journal.clues-empty')}
              </>
            ),
          },
          {
            id: 'demons',
            label: t('journal.tab.demons'),
            icon: 'ui.demons',
            content: list('demons', 'journal.demons-empty'),
          },
          {
            id: 'bestiary',
            label: t('journal.tab.bestiary'),
            icon: 'ui.bestiary',
            content: list('bestiary', 'journal.bestiary-empty'),
          },
          {
            id: 'recipes',
            label: t('journal.tab.recipes'),
            icon: 'collection.recipes',
            content: list('recipes', 'journal.recipes-empty'),
          },
          {
            id: 'people',
            label: t('journal.tab.people'),
            icon: 'ui.relationships',
            content: list('people', 'journal.people-empty'),
          },
          {
            id: 'quests',
            label: t('journal.tab.quests'),
            icon: 'ui.quest',
            content: <QuestsTab />,
          },
          {
            id: 'revelation',
            label: t('journal.tab.revelation'),
            icon: 'resource.revelation',
            content: <RevelationTab />,
          },
          { id: 'notes', label: t('journal.tab.notes'), icon: 'ui.note', content: <NotesTab /> },
        ]}
      />
    </Modal>
  );
}
