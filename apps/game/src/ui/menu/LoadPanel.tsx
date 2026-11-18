import type { LocaleKey } from '@mrak/content';
import { MAX_EXPORT_BYTES } from '@mrak/core';
import { useRef, useState } from 'react';
import type { ImportResult } from '../../host/GameHost';
import { t } from '../../i18n/t';
import { downloadText } from '../../platform';
import { useApp, useUi } from '../../state/hooks';
import { MANUAL_SLOTS, type ManualSlot, type SaveEntry } from '../../storage/save-store';
import { formatDate, formatPlaytime, formatTime } from '../format';
import { CloudSaves } from '../online/OnlineUi';
import { RecoveryNotice, type LoadFailure } from './RecoveryNotice';
import { realTime, slotLabel } from './SaveLabels';

const IMPORT_PROBLEM: Record<Extract<ImportResult, { ok: false }>['problem'], LocaleKey> = {
  corrupt: 'load.import-corrupt',
  'too-new': 'load.import-too-new',
  'too-large': 'load.import-too-large',
  failed: 'load.import-failed',
};

function SaveCard({
  save,
  zoneName,
  onLoad,
  onExport,
}: {
  save: SaveEntry;
  zoneName: string;
  onLoad: () => void;
  onExport: () => void;
}) {
  return (
    <li className="save-card">
      <button type="button" className="save-entry" onClick={onLoad}>
        {save.thumbnail ? (
          <img
            className="save-thumb"
            src={save.thumbnail}
            alt={t('load.thumbnail-alt', { zone: zoneName })}
            width={192}
            height={108}
          />
        ) : (
          <span className="save-thumb save-thumb-empty">{t('load.no-thumbnail')}</span>
        )}
        <span className="save-info">
          <strong>{slotLabel(save)}</strong>
          <span>
            {formatDate(save.gameDate)} · {formatTime(save.gameDate.minute)}
          </span>
          <span>
            {zoneName}
            {zoneName ? ' · ' : ''}
            {t('load.generation', { generation: save.generation })}
          </span>
          <span className="muted">
            {formatPlaytime(save.playtimeMs)} ·{' '}
            {t('load.saved-at', { when: realTime(save.savedAt) })}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="mrak-button small"
        title={t('load.export-hint')}
        onClick={onExport}
      >
        {t('load.export')}
      </button>
    </li>
  );
}

export function LoadPanel({ onBack }: { onBack: () => void }) {
  const { host } = useApp();
  const saves = useUi((s) => s.saves);
  const persistent = useUi((s) => s.savesPersistent);
  const persistence = useUi((s) => s.storagePersistence);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = (id: string): void => {
    setBusy(true);
    setFailure(null);
    host
      .load(id)
      .then((result) => {
        if (!result.ok) setFailure(result);
      })
      .catch(() => {
        setMessage(t('menu.load-failed'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const exportSave = (id: string): void => {
    host
      .exportSave(id)
      .then((file) => {
        if (file) downloadText(file.filename, file.text);
        else setMessage(t('load.export-failed'));
      })
      .catch(() => {
        setMessage(t('load.export-failed'));
      });
  };

  const chooseFile = (file: File | undefined): void => {
    if (!file) return;
    setMessage(null);
    if (file.size > MAX_EXPORT_BYTES) {
      setMessage(t('load.import-too-large'));
      return;
    }
    file
      .text()
      .then(setPendingImport)
      .catch(() => {
        setMessage(t('load.import-failed'));
      });
  };

  const importInto = (slot: ManualSlot): void => {
    if (pendingImport === null) return;
    setPendingImport(null);
    host
      .importSave(pendingImport, slot)
      .then((result) => {
        setMessage(
          result.ok
            ? t('load.imported', { slot: slotLabel(result.entry) })
            : t(IMPORT_PROBLEM[result.problem]),
        );
      })
      .catch(() => {
        setMessage(t('load.import-failed'));
      });
  };

  return (
    <>
      <h2>{t('menu.load')}</h2>
      {!persistent && <p className="muted">{t('load.not-persistent')}</p>}
      {persistent && (persistence === 'denied' || persistence === 'unsupported') && (
        <p className="muted">{t('load.not-persisted')}</p>
      )}
      {failure && (
        <RecoveryNotice
          failure={failure}
          onLoad={load}
          onDismiss={() => {
            setFailure(null);
          }}
        />
      )}
      {saves.length === 0 ? (
        <p className="muted">{t('load.empty')}</p>
      ) : (
        <ul className="save-list" aria-busy={busy}>
          {saves.map((save) => {
            const zone = save.zone ? host.content.find('zones', save.zone) : undefined;
            return (
              <SaveCard
                key={save.id}
                save={save}
                zoneName={zone ? t(zone.nameKey as LocaleKey) : ''}
                onLoad={() => {
                  if (!busy) load(save.id);
                }}
                onExport={() => {
                  exportSave(save.id);
                }}
              />
            );
          })}
        </ul>
      )}
      <CloudSaves onLoad={load} />
      {pendingImport !== null ? (
        <div className="import-slots" role="group" aria-label={t('load.import-choose-slot')}>
          <p>{t('load.import-choose-slot')}</p>
          {MANUAL_SLOTS.map((slot) => (
            <button
              key={slot}
              type="button"
              className="mrak-button"
              onClick={() => {
                importInto(slot);
              }}
            >
              {t(`save.${slot}`)}
            </button>
          ))}
          <button
            type="button"
            className="mrak-button"
            onClick={() => {
              setPendingImport(null);
            }}
          >
            {t('load.import-cancel')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="mrak-button"
          title={t('load.import-hint')}
          onClick={() => fileInput.current?.click()}
        >
          {t('load.import')}
        </button>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".mrak,application/json"
        hidden
        onChange={(e) => {
          chooseFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {message && <p role="status">{message}</p>}
      <button type="button" className="mrak-button" data-variant="primary" onClick={onBack}>
        {t('menu.back')}
      </button>
    </>
  );
}
