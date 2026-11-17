/**
 * The pack and, at home, the house store (docs/systems/inventory.md): slots and weight, sorting,
 * item details, comparison, use/drop/store, drag and drop between pack and store, the ground.
 */
import type { LocaleKey } from '@mrak/content';
import type { Item } from '@mrak/content-schema';
import { atHome, itemCount, itemRules, packLoad, type CommandResult } from '@mrak/core';
import { Button, IconGlyph, ItemSlot } from '@mrak/ui-kit';
import { useMemo, useState, type DragEvent } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import {
  compareRows,
  effectsText,
  itemIcon,
  potencyKey,
  reasonKey,
  sortStacks,
  SORTS,
  stackViews,
  type SortKey,
  type StackView,
} from './items-ui';

const STACK_MIME = 'application/x-mrak-stack';
const SORT_STORAGE = 'mrak.items.sort';

function savedSort(): SortKey {
  try {
    const v = localStorage.getItem(SORT_STORAGE);
    return (SORTS as readonly string[]).includes(v ?? '') ? (v as SortKey) : 'category';
  } catch {
    return 'category';
  }
}

type Where = 'pack' | 'storage' | 'ground';
interface Selected {
  where: Where;
  key: string;
}

export function PackTab({ storeFirst = false }: { storeFirst?: boolean }) {
  const { host, bus } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const [sort, setSort] = useState<SortKey>(savedSort);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [pinned, setPinned] = useState<StackView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState<Where | null>(null);
  const db = host.content;
  const rules = itemRules(db);
  const name = (item: Item): string => t(item.nameKey as LocaleKey);

  const views = useMemo(() => {
    if (!snapshot) return { pack: [], storage: [], ground: [] };
    const zone = snapshot.currentZone ?? '';
    return {
      pack: sortStacks(stackViews(snapshot.guardian.pack, db, name), sort),
      storage: sortStacks(stackViews(snapshot.guardian.storage, db, name), sort),
      ground: stackViews(snapshot.guardian.ground[zone] ?? [], db, name),
    };
  }, [snapshot, db, sort]);

  if (!snapshot) return null;
  const home = atHome(snapshot, rules);
  const load = packLoad(snapshot, db, rules);
  const current =
    selected && views[selected.where].find((v) => v.key === selected.key)
      ? (views[selected.where].find((v) => v.key === selected.key) ?? null)
      : null;

  const run = (command: Parameters<typeof host.dispatch>[0]): CommandResult => {
    const result = host.dispatch(command);
    if (result.ok) setMessage(null);
    else {
      const { key, item } = reasonKey(result.reason);
      setMessage(
        t(key, item ? { item: t((db.find('items', item)?.nameKey ?? item) as LocaleKey) } : {}),
      );
    }
    return result;
  };
  const potencyArg = (v: StackView) =>
    v.stack.potency !== undefined ? { potency: v.potency } : {};
  const move = (v: StackView, qty: number, to: 'pack' | 'storage'): void => {
    run({ type: 'moveItem', item: v.item.id, qty, to, ...potencyArg(v) });
  };
  const changeSort = (value: SortKey): void => {
    setSort(value);
    try {
      localStorage.setItem(SORT_STORAGE, value);
    } catch {
      // per-browser convenience only
    }
  };

  const slot = (v: StackView, where: Where) => (
    <li
      key={v.key}
      data-span={v.item.slotSize > 1 ? v.item.slotSize : undefined}
      draggable={where !== 'ground' && home}
      onDragStart={(e) => {
        e.dataTransfer.setData(STACK_MIME, JSON.stringify({ where, key: v.key }));
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <ItemSlot
        item={{
          icon: itemIcon(v.item),
          label: v.stack.potency !== undefined ? `${v.name} (${t(potencyKey(v.potency))})` : v.name,
          description: t(v.item.descKey as LocaleKey),
          quantity: v.stack.qty,
        }}
        selected={selected?.where === where && selected.key === v.key}
        onSelect={() => {
          setSelected({ where, key: v.key });
        }}
      />
    </li>
  );

  const dropZone = (target: 'pack' | 'storage') => ({
    onDragOver: (e: DragEvent) => {
      if (!home) return;
      e.preventDefault();
      setDropOver(target);
    },
    onDragLeave: () => {
      setDropOver(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropOver(null);
      try {
        const data = JSON.parse(e.dataTransfer.getData(STACK_MIME)) as Selected;
        if (data.where === target || data.where === 'ground') return;
        const v = views[data.where].find((x) => x.key === data.key);
        if (v) move(v, v.stack.qty, target);
      } catch {
        // not one of ours
      }
    },
  });

  const free = Math.max(0, load.slots - load.used);
  const packSection = (
    <section
      className="items-pack"
      aria-label={t('items.tab.pack')}
      data-drop={dropOver === 'pack' || undefined}
      {...dropZone('pack')}
    >
      <header className="items-meters">
        <span>
          <IconGlyph name="ui.inventory" size={16} tone="inherit" />{' '}
          {t('items.pack.slots', { used: load.used, slots: load.slots })}
        </span>
        <span data-warn={load.encumbered || undefined}>
          <IconGlyph name="ui.weight" size={16} tone="inherit" />{' '}
          {t('items.pack.weight', { weight: load.weight, capacity: load.capacity })}
        </span>
      </header>
      {load.encumbered && (
        <p className="items-warning" role="status">
          {t('items.pack.encumbered')}
        </p>
      )}
      {views.pack.length === 0 && <p className="items-empty">{t('items.pack.empty')}</p>}
      <ul className="items-grid">
        {views.pack.map((v) => slot(v, 'pack'))}
        {Array.from({ length: Math.min(free, 40) }, (_, i) => (
          <li key={`free-${String(i)}`}>
            <ItemSlot emptyLabel={t('items.pack.free')} />
          </li>
        ))}
      </ul>
    </section>
  );

  const storeSection = home && (
    <section
      className="items-store"
      aria-label={t('items.tab.store')}
      data-drop={dropOver === 'storage' || undefined}
      {...dropZone('storage')}
    >
      <h3>
        <IconGlyph name="ui.storage" size={16} tone="inherit" /> {t('items.tab.store')}
      </h3>
      {views.storage.length === 0 ? (
        <p className="items-empty">{t('items.store.empty')}</p>
      ) : (
        <ul className="items-grid">{views.storage.map((v) => slot(v, 'storage'))}</ul>
      )}
      <p className="items-hint">{t('items.drag-hint')}</p>
    </section>
  );

  const groundSection = views.ground.length > 0 && (
    <section className="items-ground" aria-label={t('items.ground.title')}>
      <h3>{t('items.ground.title')}</h3>
      <ul className="items-grid">{views.ground.map((v) => slot(v, 'ground'))}</ul>
    </section>
  );

  const camera = rules?.photography.camera;
  const detail = current ? (
    <section className="items-detail" aria-live="polite">
      <h3>
        <IconGlyph name={itemIcon(current.item)} size={32} tone="inherit" /> {current.name}
      </h3>
      <p>{t(current.item.descKey as LocaleKey)}</p>
      <ul className="items-facts">
        <li>{t(`items.category.${current.item.category}` as LocaleKey)}</li>
        {(current.item.category === 'herb' ||
          current.item.potency !== undefined ||
          (current.item.useEffects?.length ?? 0) > 0) && (
          <li>{t('items.potency.label', { word: t(potencyKey(current.potency)) })}</li>
        )}
        <li>{t('items.detail.weight', { weight: current.item.weight })}</li>
        <li>
          {current.item.unique
            ? t('items.detail.unique')
            : t('items.detail.stack', { n: current.item.stackSize })}
        </li>
        {current.item.slotSize > 1 && (
          <li>{t('items.detail.slots', { n: current.item.slotSize })}</li>
        )}
        {current.item.tags.length > 0 && (
          <li>{current.item.tags.map((tag) => t(`items.tag.${tag}` as LocaleKey)).join(', ')}</li>
        )}
        <li>{t('items.detail.qty', { qty: itemCount(snapshot, current.item.id, 'pack') })}</li>
        {home && (
          <li>
            {t('items.detail.qty-store', { qty: itemCount(snapshot, current.item.id, 'storage') })}
          </li>
        )}
      </ul>
      {current.item.useEffects && current.item.useEffects.length > 0 && (
        <p>
          {t('items.detail.uses', {
            effects: effectsText(
              current.item.useEffects,
              t,
              rules?.inventory.potencyScale[current.potency - 1] ?? 1,
            ),
          })}
        </p>
      )}
      {current.item.cursed && <p className="items-warning">{t('items.cursed.whisper')}</p>}
      <div className="items-actions">
        {selected?.where === 'pack' && current.item.useEffects?.length ? (
          <Button
            variant="primary"
            onClick={() => run({ type: 'useItem', item: current.item.id, ...potencyArg(current) })}
          >
            {t('items.action.use')}
          </Button>
        ) : null}
        {selected?.where === 'pack' && current.item.id === camera && (
          <Button
            variant="primary"
            icon="action.photograph"
            onClick={() => {
              bus.emit('ui:photograph', {});
            }}
          >
            {t('items.action.photograph')}
          </Button>
        )}
        {selected?.where === 'pack' && home && (
          <>
            <Button
              onClick={() => {
                move(current, 1, 'storage');
              }}
            >
              {t('items.action.store')}
            </Button>
            <Button
              onClick={() => {
                move(current, current.stack.qty, 'storage');
              }}
            >
              {t('items.action.store-all')}
            </Button>
          </>
        )}
        {selected?.where === 'storage' && (
          <>
            <Button
              onClick={() => {
                move(current, 1, 'pack');
              }}
            >
              {t('items.action.take')}
            </Button>
            <Button
              onClick={() => {
                move(current, current.stack.qty, 'pack');
              }}
            >
              {t('items.action.take-all')}
            </Button>
          </>
        )}
        {selected?.where === 'pack' && !home && (
          <Button
            variant="ghost"
            onClick={() =>
              run({ type: 'dropItem', item: current.item.id, qty: 1, ...potencyArg(current) })
            }
          >
            {t('items.action.drop')}
          </Button>
        )}
        {selected?.where === 'ground' && (
          <Button
            onClick={() => run({ type: 'pickUp', item: current.item.id, ...potencyArg(current) })}
          >
            {t('items.action.pick-up')}
          </Button>
        )}
        <Button
          variant="ghost"
          icon="ui.compare"
          onClick={() => {
            setPinned(pinned?.key === current.key ? null : current);
          }}
        >
          {pinned?.key === current.key ? t('items.action.uncompare') : t('items.action.compare')}
        </Button>
      </div>
      {pinned && pinned.key !== current.key && (
        <table className="items-compare">
          <caption>{t('items.compare.title', { a: pinned.name, b: current.name })}</caption>
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">{pinned.name}</th>
              <th scope="col">{current.name}</th>
            </tr>
          </thead>
          <tbody>
            {compareRows(pinned, current, t).map((row) => (
              <tr key={row.label}>
                <th scope="row">{t(row.label)}</th>
                <td data-better={row.better === 'a' || undefined}>
                  {row.a}
                  {row.better === 'a' && (
                    <span className="mrak-sr-only"> ({t('items.compare.better')})</span>
                  )}
                </td>
                <td data-better={row.better === 'b' || undefined}>
                  {row.b}
                  {row.better === 'b' && (
                    <span className="mrak-sr-only"> ({t('items.compare.better')})</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pinned && pinned.key === current.key && (
        <p className="items-hint">{t('items.compare.hint', { name: pinned.name })}</p>
      )}
    </section>
  ) : (
    <section className="items-detail">
      <p className="items-empty">{t('items.detail.none')}</p>
    </section>
  );

  return (
    <div className="items-tab items-pack-tab">
      <div className="items-toolbar">
        <label>
          <IconGlyph name="ui.sort" size={16} tone="inherit" /> {t('items.sort.label')}{' '}
          <select
            value={sort}
            onChange={(e) => {
              changeSort(e.target.value as SortKey);
            }}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`items.sort.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message && (
        <p className="items-error" role="alert">
          {message}
        </p>
      )}
      <div className="items-columns">
        {storeFirst ? storeSection : packSection}
        {storeFirst ? packSection : storeSection}
        {detail}
      </div>
      {groundSection}
    </div>
  );
}
