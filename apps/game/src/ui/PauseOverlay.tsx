import { useState } from 'react';
import { t } from '../i18n/t';
import { useApp, useUi } from '../state/hooks';
import { MANUAL_SLOTS } from '../storage/save-store';
import { OptionsPanel } from './menu/OptionsPanel';
import { saveWithNotice } from './menu/SaveLabels';

export function PauseOverlay() {
  const { host, store } = useApp();
  const paused = useUi((s) => s.paused);
  // Re-evaluated with every snapshot, so the lock lifts at dawn.
  const canSave = useUi((s) => s.snapshot !== null) && host.canManualSave();
  const menuOpen = useUi((s) => s.pauseMenuOpen);
  const [view, setView] = useState<'main' | 'save' | 'options'>('main');
  const [notice, setNotice] = useState<string | null>(null);

  if (!paused) return null;

  // Paused because the tab lost focus: one click or key resumes.
  if (!menuOpen) {
    return (
      <button
        type="button"
        className="focus-pause"
        onClick={() => {
          host.setPaused('focus', false);
        }}
      >
        <span className="focus-pause-title">{t('pause.title')}</span>
        <span>{t('pause.focus-resume')}</span>
      </button>
    );
  }

  const close = (): void => {
    store.setState({ pauseMenuOpen: false });
    host.setPaused('menu', false);
    setView('main');
    setNotice(null);
  };

  return (
    <div className="modal-backdrop">
      <div className="panel menu" role="dialog" aria-modal="true" aria-label={t('pause.title')}>
        <h2>{t('pause.title')}</h2>
        {view === 'main' && (
          <div className="menu-buttons">
            <button
              type="button"
              className="mrak-button"
              data-variant="primary"
              onClick={close}
              autoFocus
            >
              {t('pause.resume')}
            </button>
            <button
              type="button"
              className="mrak-button"
              onClick={() => {
                setView('save');
              }}
            >
              {t('pause.save')}
            </button>
            <button
              type="button"
              className="mrak-button"
              onClick={() => {
                setView('options');
              }}
            >
              {t('menu.options')}
            </button>
            <button
              type="button"
              className="mrak-button"
              onClick={() => {
                store.setState({ glossary: { open: true } });
              }}
            >
              {t('glossary.title')}
            </button>
            <button
              type="button"
              className="mrak-button"
              onClick={() => {
                host.quitToMenu();
              }}
            >
              {t('pause.quit-to-menu')}
            </button>
          </div>
        )}
        {view === 'save' && (
          <div className="menu-buttons">
            {!canSave && <p className="muted">{t('pause.save-night')}</p>}
            {[...MANUAL_SLOTS, 'quick' as const].map((slot) => (
              <button
                key={slot}
                type="button"
                className="mrak-button"
                disabled={!canSave}
                title={canSave ? undefined : t('save.night-locked')}
                onClick={() => {
                  saveWithNotice(host, slot)
                    .then(setNotice)
                    .catch(() => {
                      setNotice(t('pause.save-failed'));
                    });
                }}
              >
                {slot === 'quick' ? t('pause.quick-save') : t(`save.${slot}`)}
              </button>
            ))}
            {notice && <p role="status">{notice}</p>}
            <button
              type="button"
              className="mrak-button"
              data-variant="primary"
              onClick={() => {
                setView('main');
              }}
            >
              {t('menu.back')}
            </button>
          </div>
        )}
        {view === 'options' && (
          <OptionsPanel
            onBack={() => {
              setView('main');
            }}
          />
        )}
      </div>
    </div>
  );
}
