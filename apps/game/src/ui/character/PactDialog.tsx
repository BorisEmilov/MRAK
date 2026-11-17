/**
 * A pact offered at its place and hour (docs/systems/progression.md D6): the offer, the visible
 * terms and an irreversible confirmation. Hidden clauses stay hidden.
 */
import type { LocaleKey } from '@mrak/content';
import { ConfirmModal, IconGlyph } from '@mrak/ui-kit';
import { useEffect } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';

export function PactDialog() {
  const { host, store, bus } = useApp();
  const pactId = useUi((s) => s.pact);
  const open = pactId !== null;
  useEffect(() => {
    host.setPaused('pact', open);
    return () => {
      host.setPaused('pact', false);
    };
  }, [host, open]);
  if (!pactId) return null;
  const pact = host.content.find('pacts', pactId);
  if (!pact) return null;
  const tree = pact.unlocksTree ? host.content.find('trees', pact.unlocksTree) : undefined;
  const debt = host.content.find('debt-sources', pact.debt);
  const close = (): void => {
    store.setState({ pact: null });
  };
  return (
    <ConfirmModal
      open
      title={t(pact.nameKey as LocaleKey)}
      confirmLabel={t('pact.sign')}
      onCancel={close}
      onConfirm={() => {
        const r = host.dispatch({ type: 'signPact', pact: pact.id });
        close();
        bus.emit('world:notice', {
          key: r.ok ? 'notice.pact-signed' : 'notice.pact-refused',
          icon: 'ui.pact',
          tone: 'bad',
        });
      }}
    >
      <p className="pact-offer">
        <IconGlyph name="ui.pact" size={24} tone="inherit" /> {t(pact.offerKey as LocaleKey)}
      </p>
      <div className="pact-contract">
        <h3>{t('pact.terms')}</h3>
        <ul>
          {pact.visibleTerms.map((k) => (
            <li key={k}>{t(k as LocaleKey)}</li>
          ))}
          {pact.hiddenClauses.map((c) => (
            // Hidden clauses are there, but unreadable until they come due.
            <li key={c.id} className="pact-hidden-clause" aria-label={t('pact.hidden-clause')}>
              <span aria-hidden="true">{t(c.descKey as LocaleKey)}</span>
            </li>
          ))}
        </ul>
        <p className="pact-blood">
          {t('pact.blood', {
            amount: pact.blood.amount,
            stat: t(`pact.stat.${pact.blood.stat}`),
          })}
        </p>
      </div>
      <p className="items-warning">
        {t('pact.price', {
          debt: debt?.amount ?? 0,
          tree: tree ? t(tree.nameKey as LocaleKey) : '',
        })}
      </p>
    </ConfirmModal>
  );
}
