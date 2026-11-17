/**
 * Character panel (docs/systems/progression.md, UI tasks 13–14): the sheet, the talent trees, gear
 * with blessing slots and the debt. Opened with C or the HUD button; the game waits while open.
 */
import { Modal, Tabs } from '@mrak/ui-kit';
import { useEffect } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import type { CharacterTab } from '../../state/ui-store';
import { DebtTab } from './DebtTab';
import { GearTab } from './GearTab';
import { SheetTab } from './SheetTab';
import { TalentsTab } from './TalentsTab';

export function CharacterPanel() {
  const { host, store } = useApp();
  const tab = useUi((s) => s.character);
  const created = useUi((s) => s.snapshot?.guardian.callingId != null);
  const open = tab !== null && created;

  useEffect(() => {
    host.setPaused('panel', open);
    return () => {
      host.setPaused('panel', false);
    };
  }, [host, open]);

  if (!open) return null;
  return (
    <Modal
      open
      title={t('character.title')}
      size="xl"
      variant="parchment"
      onClose={() => {
        store.setState({ character: null });
      }}
    >
      <Tabs
        label={t('character.tabs')}
        value={tab}
        onChange={(id) => {
          store.setState({ character: id as CharacterTab });
        }}
        tabs={[
          {
            id: 'sheet',
            label: t('character.tab.sheet'),
            icon: 'ui.character',
            content: <SheetTab />,
          },
          {
            id: 'talents',
            label: t('character.tab.talents'),
            icon: 'ui.talents',
            content: <TalentsTab />,
          },
          {
            id: 'gear',
            label: t('character.tab.gear'),
            icon: 'gear.lantern',
            content: <GearTab />,
          },
          { id: 'debt', label: t('character.tab.debt'), icon: 'debt.debt', content: <DebtTab /> },
        ]}
      />
    </Modal>
  );
}
