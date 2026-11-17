import { t } from '../../i18n/t';
import type { LoadResult } from '../../host/GameHost';
import { formatDate } from '../format';
import { slotLabel } from './SaveLabels';

export type LoadFailure = Extract<LoadResult, { ok: false }>;

/** Shown when a save cannot be opened: explains why and offers the newest intact save. */
export function RecoveryNotice({
  failure,
  onLoad,
  onDismiss,
}: {
  failure: LoadFailure;
  onLoad: (id: string) => void;
  onDismiss: () => void;
}) {
  const { fallback } = failure;
  return (
    <div className="recovery" role="alert">
      <p>{t(failure.problem === 'too-new' ? 'load.too-new' : 'load.corrupt')}</p>
      {fallback ? (
        <>
          <p>
            {t('load.fallback-offer', {
              slot: slotLabel(fallback),
              date: formatDate(fallback.gameDate),
            })}
          </p>
          <button
            type="button"
            className="mrak-button"
            data-variant="primary"
            autoFocus
            onClick={() => {
              onLoad(fallback.id);
            }}
          >
            {t('load.fallback-load')}
          </button>
        </>
      ) : (
        <p className="muted">{t('load.fallback-none')}</p>
      )}
      <button type="button" className="mrak-button" onClick={onDismiss}>
        {t('load.dismiss')}
      </button>
    </div>
  );
}
