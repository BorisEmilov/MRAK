/**
 * In game: a chronicle without a guardian (a save from before progression) asks for one before
 * play continues (docs/systems/progression.md §1).
 */
import { progressionRules } from '@mrak/core';
import { Modal } from '@mrak/ui-kit';
import { useEffect } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { GenerationSummary } from './GenerationSummary';
import { GuardianForm } from './GuardianForm';

export function GuardianCreation() {
  const { host } = useApp();
  const missing = useUi((s) => s.snapshot !== null && s.snapshot.guardian.callingId === null);
  const open = missing && progressionRules(host.content) !== null;
  const summary = useUi((s) => s.snapshot?.lineage.summary !== null);
  useEffect(() => {
    host.setPaused('creation', open);
    return () => {
      host.setPaused('creation', false);
    };
  }, [host, open]);
  if (!open) return null;
  return (
    <Modal
      open
      title={t('creation.title')}
      size="xl"
      variant="parchment"
      dismissible={false}
      onClose={() => undefined}
    >
      {summary ? <GenerationSummary /> : <p>{t('creation.old-save')}</p>}
      <GuardianForm
        content={host.content}
        onSubmit={(choices) => {
          host.dispatch({ type: 'createGuardian', ...choices, bloodline: host.bloodline() });
        }}
      />
    </Modal>
  );
}
