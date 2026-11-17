/** The generation jump: what changed in the world, the village and the line while one served. */
import type { LocaleKey } from '@mrak/content';
import { t } from '../../i18n/t';
import { useUi } from '../../state/hooks';

const ROWS = [
  'population',
  'prosperity',
  'buildings',
  'dead',
  'corruption',
  'village-corruption',
  'debt',
  'pacts',
  'possessions',
] as const;

export function GenerationSummary() {
  const snapshot = useUi((s) => s.snapshot);
  const summary = snapshot?.lineage.summary;
  if (!snapshot || !summary) return null;
  const nameOf = (id: string): string => {
    const p = snapshot.village.people.find((x) => x.id === id);
    return p ? t(p.nameKey as LocaleKey) : id;
  };
  return (
    <section className="generation-summary" aria-labelledby="generation-summary-title">
      <h3 id="generation-summary-title">
        {t('summary.title', { from: summary.from, to: summary.to })}
      </h3>
      <p>
        {t('summary.handover', {
          heir: nameOf(summary.heir),
          predecessor: nameOf(summary.predecessor),
        })}{' '}
        {t('summary.legacy', { legacy: summary.legacy })}
      </p>
      <table className="generation-table">
        <tbody>
          {ROWS.map((k) => {
            const pair = summary.changes[k];
            const a = pair?.[0] ?? 0;
            const b = pair?.[1] ?? 0;
            return (
              <tr key={k} data-changed={a !== b}>
                <th scope="row">{t(`summary.row.${k}`)}</th>
                <td>{Math.round(a)}</td>
                <td aria-hidden="true">→</td>
                <td>{Math.round(b)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="village-hint">{t('summary.fresh-start')}</p>
    </section>
  );
}
