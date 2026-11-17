/**
 * Village management (docs/systems/villagers.md → Presentation, tasks.md): villager cards with
 * needs, activity and day/night task slots (drag a task, or choose it from the slot's list), the
 * stores and what comes home at dusk, filters, and the relationship graph. Opened with the
 * `village` action (V / RT); the game waits while it is open.
 */
import type { LocaleKey } from '@mrak/content';
import { itemCount, villageRules } from '@mrak/core';
import { IconGlyph, KeyHint, Modal, Tabs, Tooltip, type IconName } from '@mrak/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { BuildingsTab } from './BuildingsTab';
import { ChronicleTab } from './ChronicleTab';
import { LineageTab } from './LineageTab';
import { RelationshipGraph } from './RelationshipGraph';
import { TASK_MIME, VillagerCard } from './VillagerCard';
import { comingAtDusk, FILTERS, matches, type Filter } from './village-ui';

/** Stores worth watching while giving work. */
const STORES = ['bread', 'firewood', 'lamp-oil', 'garlic', 'red-thread', 'beeswax', 'incense'];

export function VillagePanel() {
  const { host, store } = useApp();
  const open = useUi((s) => s.villageOpen);
  const snapshot = useUi((s) => s.snapshot);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [tab, setTab] = useState('villagers');

  useEffect(() => {
    host.setPaused('panel', open);
    return () => {
      host.setPaused('panel', false);
    };
  }, [host, open]);

  // Views are recomputed whenever the (throttled) snapshot changes.
  const views = useMemo(() => (open && snapshot ? host.villagers() : []), [host, open, snapshot]);
  const zone = host.content.find('zones', villageRules(host.content)?.zone ?? '');
  const placeName = (poi: string | null): string => {
    const def = poi ? zone?.pois.find((p) => p.id === poi) : undefined;
    return def ? t(def.nameKey as LocaleKey) : t('village.place.unknown');
  };

  if (!snapshot) return null;
  const close = (): void => {
    store.setState({ villageOpen: false });
  };
  const needle = query.trim().toLowerCase();
  const shown = views.filter((v) => {
    if (!matches(v, filter)) return false;
    if (!needle) return true;
    const def = host.content.find('villagers', v.id);
    return def
      ? t(def.nameKey as LocaleKey)
          .toLowerCase()
          .includes(needle)
      : false;
  });
  const coming = comingAtDusk(snapshot, host.content);
  const itemName = (id: string): string =>
    t((host.content.find('items', id)?.nameKey ?? id) as LocaleKey);

  const villagersTab = (
    <div className="village-tab">
      <section className="village-stores" aria-label={t('village.stores')}>
        <h3>{t('village.stores')}</h3>
        <ul>
          {STORES.filter((id) => host.content.has('items', id)).map((id) => (
            <li key={id}>
              {itemName(id)} <strong>{itemCount(snapshot, id, 'storage')}</strong>
            </li>
          ))}
        </ul>
        <p className="village-dusk">
          <IconGlyph name="phase.dusk" size={16} tone="inherit" />{' '}
          {Object.keys(coming).length === 0
            ? t('village.dusk.nothing')
            : t('village.dusk.coming', {
                items: Object.entries(coming)
                  .map(([id, qty]) => `${String(qty)} ${itemName(id)}`)
                  .join(', '),
              })}
        </p>
      </section>

      <section className="village-palette" aria-labelledby="village-palette-title">
        <h3 id="village-palette-title">{t('village.palette.title')}</h3>
        <p className="village-hint">{t('village.palette.hint')}</p>
        <ul>
          {host.content.all('tasks').map((task) => (
            <li key={task.id}>
              <Tooltip
                title={t(task.nameKey as LocaleKey)}
                description={t(task.descKey as LocaleKey)}
                extra={t(`village.slot.${task.slot}`)}
              >
                <span
                  className="village-task-chip mrak-focusable"
                  data-slot={task.slot}
                  draggable
                  tabIndex={0}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(TASK_MIME, task.id);
                    e.dataTransfer.effectAllowed = 'copy';
                    setDragging(task.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                  }}
                >
                  <IconGlyph name={task.icon as IconName} size={20} tone="inherit" />
                  {t(task.nameKey as LocaleKey)}
                </span>
              </Tooltip>
            </li>
          ))}
        </ul>
      </section>

      <div className="village-filters" role="group" aria-label={t('village.filter.label')}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="village-chip mrak-focusable"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
            }}
          >
            {t(`village.filter.${f}`)}
          </button>
        ))}
        <label className="village-search">
          <span className="mrak-sr-only">{t('village.filter.search')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('village.filter.search')}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="village-empty">{t('village.filter.empty')}</p>
      ) : (
        <div className="village-cards">
          {shown.map((view) => {
            const def = host.content.find('villagers', view.id);
            return def ? (
              <VillagerCard
                key={view.id}
                def={def}
                view={view}
                placeName={placeName}
                dragging={dragging}
              />
            ) : null;
          })}
        </div>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      title={t('village.title')}
      onClose={close}
      size="xl"
      variant="parchment"
      footer={
        <span className="map-footer">
          <KeyHint action="village" /> {t('village.close')}
        </span>
      }
    >
      <Tabs
        label={t('village.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'villagers',
            label: t('village.tab.villagers'),
            icon: 'faction.village',
            content: villagersTab,
          },
          {
            id: 'relations',
            label: t('village.tab.relations'),
            icon: 'ui.relationships',
            content: <RelationshipGraph views={views} />,
          },
          {
            id: 'buildings',
            label: t('village.tab.buildings'),
            icon: 'building.chapel',
            content: <BuildingsTab snapshot={snapshot} />,
          },
          {
            id: 'lineage',
            label: t('village.tab.lineage'),
            icon: 'ui.heir',
            content: <LineageTab snapshot={snapshot} />,
          },
          {
            id: 'chronicle',
            label: t('village.tab.chronicle'),
            icon: 'ui.history',
            content: <ChronicleTab snapshot={snapshot} />,
          },
        ]}
      />
    </Modal>
  );
}
