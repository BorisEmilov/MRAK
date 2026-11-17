import { t } from '../i18n/t';
import { useUi } from '../state/hooks';

/** Browsers keep audio locked until the first gesture; say so instead of failing silently. */
export function AudioHint() {
  const locked = useUi((s) => s.audioLocked);
  const screen = useUi((s) => s.screen);
  if (!locked || screen === 'error' || screen === 'booting') return null;
  return (
    <div className="audio-hint" aria-live="polite">
      <span aria-hidden="true">♪</span> {t('audio.locked-hint')}
    </div>
  );
}
