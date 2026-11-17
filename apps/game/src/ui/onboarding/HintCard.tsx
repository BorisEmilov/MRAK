/** The current onboarding hint: never pauses, never covers the centre, announced politely. */
import type { LocaleKey } from '@mrak/content';
import { Button, IconGlyph, type IconName } from '@mrak/ui-kit';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';

export function HintCard() {
  const { host, store, presentation } = useApp();
  const hint = useUi((s) => s.hint);
  if (!hint) return null;
  return (
    <aside className="hint-card mrak-panel" aria-live="polite" aria-label={t('hint.label')}>
      <div className="hint-head">
        <IconGlyph name={(hint.icon ?? 'ui.hint') as IconName} size={32} />
        <h2 className="mrak-display hint-title">{t(hint.titleKey as LocaleKey)}</h2>
      </div>
      <p>{t(hint.textKey as LocaleKey)}</p>
      {hint.glossary.length > 0 && (
        <p className="hint-terms">
          {t('hint.see-also')}{' '}
          {hint.glossary.map((id, i) => {
            const entry = host.content.find('glossary', id);
            return (
              <span key={id}>
                {i > 0 && ', '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    store.setState({ glossary: { open: true, term: id } });
                  }}
                >
                  {entry ? t(entry.termKey as LocaleKey) : id}
                </button>
              </span>
            );
          })}
        </p>
      )}
      <div className="hint-actions">
        <Button variant="primary" icon="ui.check" onClick={presentation.dismissHint}>
          {t('hint.got-it')}
        </Button>
        <Button variant="ghost" onClick={presentation.disableHints}>
          {t('hint.turn-off')}
        </Button>
      </div>
    </aside>
  );
}
