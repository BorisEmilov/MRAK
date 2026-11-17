/**
 * A generation has ended (docs/systems/lineage.md → Implementation): the epitaph and its Legacy,
 * then the heir — a child or apprentice of age, else whoever the village chooses. If only a child
 * is left, the years pass until they come of age. With nobody left, the line ends.
 */
import type { LocaleKey } from '@mrak/content';
import { ageOf, waitingHeir } from '@mrak/core';
import { Button, Modal } from '@mrak/ui-kit';
import { useEffect } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';

export function HeirChoice() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const open = snapshot?.lineage.awaitingHeir === true;
  useEffect(() => {
    host.setPaused('creation', open);
    return () => {
      host.setPaused('creation', false);
    };
  }, [host, open]);
  if (!snapshot || !open) return null;
  const db = host.content;
  const past = snapshot.lineage.past.at(-1);
  const nameOf = (id: string): string => {
    const p = snapshot.village.people.find((x) => x.id === id);
    return p ? t(p.nameKey as LocaleKey) : id;
  };
  const candidates = host.heirCandidates();
  return (
    <Modal
      open
      title={t('heir.title')}
      size="lg"
      variant="parchment"
      dismissible={false}
      onClose={() => undefined}
    >
      {past && (
        <p className="lineage-epitaph">
          {t('heir.epitaph', { name: nameOf(past.person) })}{' '}
          {t(`lineage.cause.${past.cause}`, { legacy: past.legacy })}
        </p>
      )}
      {snapshot.lineage.ended ? (
        <p>{t('heir.line-ended')}</p>
      ) : candidates.length > 0 ? (
        <>
          <p>{t('heir.choose')}</p>
          <ul className="heir-list">
            {candidates.map((id) => (
              <li key={id}>
                <Button
                  onClick={() => {
                    host.dispatch({ type: 'chooseHeir', heir: id });
                  }}
                >
                  {t('heir.option', { name: nameOf(id), age: ageOf(snapshot, db, id) ?? 0 })}
                </Button>
              </li>
            ))}
          </ul>
          <p className="village-hint">{t('heir.inherits')}</p>
        </>
      ) : waitingHeir(snapshot) ? (
        <>
          <p>{t('heir.too-young')}</p>
          <Button
            onClick={() => {
              host.dispatch({ type: 'skipYears', years: 1 });
            }}
          >
            {t('heir.wait')}
          </Button>
        </>
      ) : null}
    </Modal>
  );
}
