/**
 * Debt (docs/systems/progression.md D1–D5): total and breakdown by source and creditor, tonight's
 * chance of a collection, the history of collections and the ways to pay.
 */
import type { LocaleKey } from '@mrak/content';
import { collectionChance, jdnToJulian, progressionRules } from '@mrak/core';
import { Button, ICON_NAMES, IconGlyph, type IconName } from '@mrak/ui-kit';
import { useState } from 'react';
import { formatDate } from '../format';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { progressionReasonKey } from './progression-ui';

function debtIcon(source: string): IconName {
  const name = `debt.${source}`;
  return (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : 'debt.debt';
}

export function DebtTab() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const [message, setMessage] = useState<string | null>(null);
  const db = host.content;
  const rules = progressionRules(db);
  if (!snapshot || !rules) return null;
  const entries = snapshot.debt.entries;
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const chance = Math.round(collectionChance(snapshot, db, rules) * 100);
  const sourceName = (id: string) => t((db.find('debt-sources', id)?.nameKey ?? id) as LocaleKey);
  const remedies = host.debtRemedies();

  return (
    <div className="debt-tab">
      <header className="debt-total">
        <IconGlyph name="debt.debt" size={48} tone="inherit" />
        <div>
          <strong>{t('debt.total', { value: total })}</strong>
          <p>{total > 0 ? t('debt.chance', { value: chance }) : t('debt.none')}</p>
          <p className="items-hint">{t('debt.hint')}</p>
        </div>
      </header>

      <section aria-labelledby="debt-breakdown">
        <h3 id="debt-breakdown">{t('debt.breakdown')}</h3>
        {entries.length === 0 ? (
          <p className="items-empty">{t('debt.none')}</p>
        ) : (
          <table className="debt-table">
            <thead>
              <tr>
                <th scope="col">{t('debt.col.source')}</th>
                <th scope="col">{t('debt.col.creditor')}</th>
                <th scope="col">{t('debt.col.amount')}</th>
                <th scope="col">{t('debt.col.since')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.source}-${String(i)}`}>
                  <td>
                    <IconGlyph name={debtIcon(e.source)} size={16} tone="inherit" />{' '}
                    {sourceName(e.source)}
                  </td>
                  <td>{t(`creditor.${e.creditor}` as LocaleKey)}</td>
                  <td>{e.amount}</td>
                  <td>{formatDate(jdnToJulian(e.at.day))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="debt-pay">
        <h3 id="debt-pay">{t('debt.pay')}</h3>
        <ul className="debt-remedies">
          {remedies.map((r) => {
            const def = db.get('debt-remedies', r.id);
            return (
              <li key={r.id}>
                <Button
                  variant="secondary"
                  irreversible
                  consequence={t(def.descKey as LocaleKey)}
                  showConsequence
                  {...(r.owed === 0
                    ? { disabledReason: t('progression.reason.nothing-owed') }
                    : !r.ok
                      ? { disabledReason: t('progression.reason.cannot-pay') }
                      : {})}
                  onClick={() => {
                    const res = host.dispatch({ type: 'payDebt', remedy: r.id });
                    setMessage(
                      res.ok
                        ? t('debt.paid', { name: t(def.nameKey as LocaleKey) })
                        : t(progressionReasonKey(res.reason)),
                    );
                  }}
                >
                  {t('debt.remedy', {
                    name: t(def.nameKey as LocaleKey),
                    creditor: t(`creditor.${r.creditor}` as LocaleKey),
                    reduce: r.reduce,
                  })}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="debt-history">
        <h3 id="debt-history">{t('debt.history')}</h3>
        {snapshot.debt.history.length === 0 ? (
          <p className="items-empty">{t('debt.history-empty')}</p>
        ) : (
          <ol className="debt-history">
            {[...snapshot.debt.history].reverse().map((h, i) => {
              const c = db.find('debt-collections', h.collection);
              return (
                <li key={`${String(h.day)}-${String(i)}`} data-severity={h.severity}>
                  <time>{formatDate(jdnToJulian(h.day))}</time>{' '}
                  {t(`debt.severity.${h.severity}` as LocaleKey)} —{' '}
                  {c ? t(c.descKey as LocaleKey) : h.collection}
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
