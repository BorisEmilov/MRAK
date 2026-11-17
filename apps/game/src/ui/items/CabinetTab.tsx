/**
 * The cellar cabinet (docs/systems/collection.md rules 2–5): cursed objects you keep, where they
 * are, what they do carried or displayed, the sets, and their memories.
 */
import type { LocaleKey } from '@mrak/content';
import { completeSets, itemCount, itemRules } from '@mrak/core';
import { Button, IconGlyph, ItemSlot, Modal } from '@mrak/ui-kit';
import { useState } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { itemIcon, modifiersText, reasonKey } from './items-ui';

export function CabinetTab({ home }: { home: boolean }) {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const [message, setMessage] = useState<string | null>(null);
  const [memory, setMemory] = useState<string | null>(null);
  const db = host.content;
  const rules = itemRules(db);
  if (!snapshot || !rules) return null;
  const cabinet = snapshot.collection.cabinet;
  const owned = db
    .all('items')
    .filter((i) => i.cursed && (cabinet.includes(i.id) || itemCount(snapshot, i.id) > 0));
  const complete = new Set(completeSets(snapshot, db).map((s) => s.id));
  const found = new Set(snapshot.collection.found);
  const objectName = (cursed: string): string => {
    const item = db.all('items').find((i) => i.cursed === cursed);
    return item && found.has(item.id) ? t(item.nameKey as LocaleKey) : t('items.cabinet.unknown');
  };
  const run = (command: Parameters<typeof host.dispatch>[0]): void => {
    const r = host.dispatch(command);
    setMessage(r.ok ? null : t(reasonKey(r.reason).key));
  };
  const where = (id: string): LocaleKey =>
    cabinet.includes(id)
      ? 'items.cabinet.where.cabinet'
      : itemCount(snapshot, id, 'pack') > 0
        ? 'items.cabinet.where.pack'
        : 'items.cabinet.where.storage';
  const recalled = memory ? db.find('cursed-objects', memory) : undefined;

  return (
    <div className="items-tab items-cabinet">
      <p className="items-hint">{t('items.cabinet.hint')}</p>
      {!home && <p className="items-away">{t('items.away')}</p>}
      {message && (
        <p className="items-error" role="alert">
          {message}
        </p>
      )}
      <section aria-labelledby="cabinet-shelf">
        <h3 id="cabinet-shelf">
          <IconGlyph name="ui.cabinet" size={20} tone="inherit" />{' '}
          {t('items.cabinet.slots', { used: cabinet.length, slots: rules.cabinet.slots })}
        </h3>
        <ul className="items-grid cabinet-shelf">
          {Array.from({ length: rules.cabinet.slots }, (_, i) => {
            const id = cabinet[i];
            const item = id ? db.find('items', id) : undefined;
            return (
              <li key={id ?? `empty-${String(i)}`}>
                <ItemSlot
                  size="lg"
                  emptyLabel={t('items.cabinet.empty-slot')}
                  {...(item
                    ? {
                        item: {
                          icon: itemIcon(item),
                          label: t(item.nameKey as LocaleKey),
                          description: t(item.descKey as LocaleKey),
                        },
                      }
                    : {})}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="cabinet-owned">
        <h3 id="cabinet-owned">{t('items.cabinet.owned')}</h3>
        {owned.length === 0 ? (
          <p className="items-empty">{t('items.cabinet.none')}</p>
        ) : (
          <ul className="cabinet-objects">
            {owned.map((item) => {
              const def = item.cursed ? db.find('cursed-objects', item.cursed) : undefined;
              if (!def) return null;
              const shown = cabinet.includes(item.id);
              return (
                <li key={item.id}>
                  <IconGlyph name={itemIcon(item)} size={32} tone="inherit" />
                  <div>
                    <strong>{t(item.nameKey as LocaleKey)}</strong> · {t(where(item.id))}
                    <p>{t(def.descKey as LocaleKey)}</p>
                    <p>
                      {t('items.cabinet.carried', {
                        effects: def.carried.length
                          ? modifiersText(def.carried, t)
                          : t('items.cabinet.nothing'),
                      })}{' '}
                      {def.whisper > 0 && t('items.cursed.whisper')}
                    </p>
                    <p>
                      {t('items.cabinet.displayed', {
                        effects: def.displayed.length
                          ? modifiersText(def.displayed, t)
                          : t('items.cabinet.nothing'),
                      })}
                    </p>
                    <div className="items-actions">
                      {home &&
                        (shown ? (
                          <Button
                            onClick={() => {
                              run({ type: 'removeObject', item: item.id });
                            }}
                          >
                            {t('items.action.remove')}
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            icon="ui.cabinet"
                            onClick={() => {
                              run({ type: 'displayObject', item: item.id });
                            }}
                          >
                            {t('items.action.display')}
                          </Button>
                        ))}
                      <Button
                        variant="ghost"
                        icon="collection.memories"
                        onClick={() => {
                          const r = host.dispatch({ type: 'recallMemory', object: def.id });
                          if (r.ok) setMemory(def.id);
                          else setMessage(t(reasonKey(r.reason).key));
                        }}
                      >
                        {t('items.action.recall')}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="cabinet-sets">
        <h3 id="cabinet-sets">{t('items.cabinet.sets')}</h3>
        <ul className="cabinet-sets">
          {db.all('cabinet-sets').map((set) => (
            <li key={set.id} data-complete={complete.has(set.id) || undefined}>
              <strong>{t(set.nameKey as LocaleKey)}</strong>{' '}
              <span>{set.objects.map(objectName).join(' + ')}</span>
              <p>{t(set.descKey as LocaleKey)}</p>
              <p>
                {complete.has(set.id)
                  ? t('items.cabinet.set-complete', { effects: modifiersText(set.modifiers, t) })
                  : t('items.cabinet.set-incomplete')}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <Modal
        open={recalled !== undefined}
        title={recalled ? t('items.memory.title', { name: objectName(recalled.id) }) : ''}
        variant="parchment"
        onClose={() => {
          setMemory(null);
        }}
        footer={
          <Button
            onClick={() => {
              setMemory(null);
            }}
          >
            {t('items.memory.close')}
          </Button>
        }
      >
        {recalled && <p className="memory-text">{t(recalled.memoryKey as LocaleKey)}</p>}
      </Modal>
    </div>
  );
}
