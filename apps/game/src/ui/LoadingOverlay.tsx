import { useEffect, useState } from 'react';
import { t } from '../i18n/t';
import { useUi } from '../state/hooks';

const TIP_KEYS = [
  'loading.tip-1',
  'loading.tip-2',
  'loading.tip-3',
  'loading.tip-4',
  'loading.tip-5',
  'loading.tip-6',
] as const;

/** Loading screen text, at native resolution over Phaser's ambient backdrop. */
export function LoadingOverlay() {
  const progress = useUi((s) => s.loadProgress);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIP_KEYS.length));

  useEffect(() => {
    const id = window.setInterval(() => {
      setTip((i) => (i + 1) % TIP_KEYS.length);
    }, 5000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="loading" role="status" aria-live="polite">
      <h1 className="title">{t('game.title')}</h1>
      <div
        className="progress"
        role="progressbar"
        aria-label={t('loading.label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div className="progress-bar" style={{ width: `${String(Math.round(progress * 100))}%` }} />
      </div>
      <p className="tip">{t(TIP_KEYS[tip] ?? 'loading.tip-1')}</p>
    </div>
  );
}
