import { Button, ICON_AUTHORS } from '@mrak/ui-kit';
import { t } from '../../i18n/t';

/** Credits, including the CC BY 3.0 attribution the icon licence requires. */
export function CreditsPanel({ onBack }: { onBack: () => void }) {
  return (
    <>
      <h2>{t('menu.credits')}</h2>
      <h3>{t('credits.icons-title')}</h3>
      <p>{t('credits.icons', { authors: ICON_AUTHORS.join(', ') })}</p>
      <p>
        <a href="https://game-icons.net" target="_blank" rel="noreferrer noopener">
          game-icons.net
        </a>{' '}
        ·{' '}
        <a
          href="https://creativecommons.org/licenses/by/3.0/"
          target="_blank"
          rel="noreferrer noopener"
        >
          CC BY 3.0
        </a>
      </p>
      <h3>{t('credits.fonts-title')}</h3>
      <p>{t('credits.fonts')}</p>
      <Button variant="primary" onClick={onBack}>
        {t('menu.back')}
      </Button>
    </>
  );
}
