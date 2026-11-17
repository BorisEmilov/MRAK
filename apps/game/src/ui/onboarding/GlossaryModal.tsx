/** Glossary (docs/systems/onboarding.md): searchable, by category, reachable from any screen (F2). */
import type { LocaleKey } from '@mrak/content';
import { Modal, Tabs } from '@mrak/ui-kit';
import { useEffect, useId, useMemo, useState } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';

const CATEGORIES = [
  ['folklore', 'glossary.tab-folklore'],
  ['history', 'glossary.tab-history'],
  ['game', 'glossary.tab-game'],
] as const;

export function GlossaryModal() {
  const { host, store } = useApp();
  const glossary = useUi((s) => s.glossary);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const entries = host.content.all('glossary');
  const focusTerm = glossary.term;
  const focused = focusTerm ? entries.find((e) => e.id === focusTerm) : undefined;
  const [tab, setTab] = useState<string>(focused?.category ?? 'folklore');
  const [lastTerm, setLastTerm] = useState(focusTerm);
  if (lastTerm !== focusTerm) {
    setLastTerm(focusTerm);
    if (focused) setTab(focused.category);
  }

  useEffect(() => {
    if (!glossary.open || !focusTerm) return;
    document.getElementById(`glossary-${focusTerm}`)?.scrollIntoView({ block: 'center' });
  }, [glossary.open, focusTerm, tab]);

  const close = (): void => {
    store.setState({ glossary: { open: false } });
    setQuery('');
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .map((e) => ({ e, term: t(e.termKey as LocaleKey), desc: t(e.descKey as LocaleKey) }))
      .filter(
        ({ term, desc }) =>
          q === '' || term.toLowerCase().includes(q) || desc.toLowerCase().includes(q),
      )
      .sort((a, b) => a.term.localeCompare(b.term));
  }, [entries, query]);

  const list = (category: string) => {
    const items = matches.filter(({ e }) => e.category === category);
    if (items.length === 0) return <p className="muted">{t('glossary.no-results')}</p>;
    return (
      <dl className="glossary-list">
        {items.map(({ e, term, desc }) => (
          <div
            key={e.id}
            id={`glossary-${e.id}`}
            className="glossary-entry"
            data-focused={e.id === focusTerm || undefined}
          >
            <dt>{term}</dt>
            <dd>{desc}</dd>
          </div>
        ))}
      </dl>
    );
  };

  return (
    <Modal open={glossary.open} title={t('glossary.title')} onClose={close} size="lg">
      <label className="field" htmlFor={searchId}>
        <span>{t('glossary.search')}</span>
      </label>
      <input
        id={searchId}
        type="search"
        className="glossary-search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      <Tabs
        label={t('glossary.title')}
        value={tab}
        onChange={setTab}
        tabs={CATEGORIES.map(([id, key]) => ({
          id,
          label: `${t(key)} (${String(matches.filter(({ e }) => e.category === id).length)})`,
          content: list(id),
        }))}
      />
    </Modal>
  );
}
