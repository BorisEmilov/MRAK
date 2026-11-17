/**
 * Collection progress by category (docs/systems/collection.md rules 6–7): what was found, what
 * is still missing (unnamed), and where to look.
 */
import type { LocaleKey } from '@mrak/content';
import type { Category, CategoryProgress } from '@mrak/core';
import { IconGlyph, ProgressMeter, type IconName } from '@mrak/ui-kit';
import { useMemo, useState } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';

function entryText(
  host: ReturnType<typeof useApp>['host'],
  category: Category,
  id: string,
): { name: string; desc?: string } {
  const db = host.content;
  const key = (k: string | undefined) => (k ? t(k as LocaleKey) : id);
  switch (category) {
    case 'herbs':
    case 'cursed': {
      const item = db.find('items', id);
      return { name: key(item?.nameKey), desc: key(item?.descKey) };
    }
    case 'recipes': {
      const r = db.find('recipes', id);
      return { name: key(r?.nameKey), desc: key(r?.descKey) };
    }
    case 'photos': {
      const l = db.find('photo-layers', id);
      return { name: key(l?.nameKey), desc: key(l?.descKey) };
    }
    case 'memories': {
      const c = db.find('cursed-objects', id);
      return { name: key(c?.nameKey), desc: key(c?.memoryKey) };
    }
    default: {
      const c = db.find('collectibles', id);
      return { name: key(c?.nameKey), desc: key(c?.descKey) };
    }
  }
}

export function CollectionTab() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const progress = useMemo<CategoryProgress[]>(
    () => (snapshot ? host.collectionProgress() : []),
    [host, snapshot],
  );
  const [open, setOpen] = useState<Category>('herbs');
  const current = progress.find((p) => p.category === open);

  return (
    <div className="items-tab items-collection">
      <ul className="collection-categories">
        {progress.map((p) => (
          <li key={p.category}>
            <button
              type="button"
              className="collection-category mrak-focusable"
              aria-pressed={open === p.category}
              onClick={() => {
                setOpen(p.category);
              }}
            >
              <ProgressMeter
                label={t(`items.collection.cat.${p.category}` as LocaleKey)}
                icon={`collection.${p.category}` as IconName}
                value={p.have}
                max={Math.max(1, p.total)}
                valueText={t('items.collection.progress', { have: p.have, total: p.total })}
              />
            </button>
          </li>
        ))}
      </ul>
      {current && (
        <section className="collection-entries" aria-live="polite">
          <h3>
            <IconGlyph
              name={`collection.${current.category}` as IconName}
              size={24}
              tone="inherit"
            />{' '}
            {t(`items.collection.cat.${current.category}` as LocaleKey)}
          </h3>
          <p className="items-hint">
            {t(`items.collection.hint.${current.category}` as LocaleKey)}
          </p>
          <ul>
            {current.ids.map((id) => {
              const owned = current.owned.includes(id);
              const { name, desc } = entryText(host, current.category, id);
              return (
                <li key={id} data-owned={owned || undefined}>
                  {owned ? (
                    <details>
                      <summary>{name}</summary>
                      {desc && <p>{desc}</p>}
                    </details>
                  ) : (
                    <span className="collection-unknown">{t('items.collection.unknown')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
