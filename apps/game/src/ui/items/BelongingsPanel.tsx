/**
 * Belongings (docs/systems/inventory.md, alchemy.md, collection.md, photography.md): the pack and
 * the house store, the mortar, the cellar cabinet, the collection and the album. Opened with I
 * (pack) or at the house door; the game waits while it is open. J opens the journal.
 */
import { atHome, itemRules } from '@mrak/core';
import { Modal, Tabs } from '@mrak/ui-kit';
import { useEffect } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import type { BelongingsTab } from '../../state/ui-store';
import { AlbumTab } from './AlbumTab';
import { CabinetTab } from './CabinetTab';
import { CollectionTab } from './CollectionTab';
import { MortarTab } from './MortarTab';
import { PackTab } from './PackTab';

export function BelongingsPanel() {
  const { host, store } = useApp();
  const tab = useUi((s) => s.belongings);
  const snapshot = useUi((s) => s.snapshot);
  const open = tab !== null;

  useEffect(() => {
    host.setPaused('panel', open);
    return () => {
      host.setPaused('panel', false);
    };
  }, [host, open]);

  if (!snapshot || !open) return null;
  const home = atHome(snapshot, itemRules(host.content));
  const away = <p className="items-away">{t('items.away')}</p>;
  const select = (id: string): void => {
    store.setState({ belongings: id as BelongingsTab });
  };

  return (
    <Modal
      open={open}
      title={t('items.title')}
      size="xl"
      variant="parchment"
      onClose={() => {
        store.setState({ belongings: null });
      }}
    >
      <Tabs
        label={t('items.tabs')}
        value={tab}
        onChange={select}
        tabs={[
          { id: 'pack', label: t('items.tab.pack'), icon: 'ui.inventory', content: <PackTab /> },
          {
            id: 'store',
            label: t('items.tab.store'),
            icon: 'ui.storage',
            content: home ? <PackTab storeFirst /> : away,
          },
          {
            id: 'mortar',
            label: t('items.tab.mortar'),
            icon: 'ui.mortar',
            content: home ? <MortarTab /> : away,
          },
          {
            id: 'cabinet',
            label: t('items.tab.cabinet'),
            icon: 'ui.cabinet',
            content: <CabinetTab home={home} />,
          },
          {
            id: 'collection',
            label: t('items.tab.collection'),
            icon: 'ui.collection',
            content: <CollectionTab />,
          },
          {
            id: 'album',
            label: t('items.tab.album'),
            icon: 'collection.photos',
            content: <AlbumTab />,
          },
        ]}
      />
    </Modal>
  );
}
