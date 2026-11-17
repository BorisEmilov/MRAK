import { t } from '../i18n/t';
import type { LocaleKey } from '@mrak/content';
import { useApp } from '../state/hooks';
import type { UiState } from '../state/ui-store';
import { useStore } from 'zustand';

const TEXT: Record<NonNullable<UiState['error']>['kind'], { title: LocaleKey; body: LocaleKey }> = {
  webgl: { title: 'error.webgl.title', body: 'error.webgl.body' },
  load: { title: 'error.load.title', body: 'error.load.body' },
  content: { title: 'error.content.title', body: 'error.content.body' },
  crash: { title: 'error.crash.title', body: 'error.crash.body' },
};

function ErrorView({ error }: { error: UiState['error'] }) {
  const text = TEXT[error?.kind ?? 'crash'];
  return (
    <div className="panel error-screen" role="alert">
      <h1>{t(text.title)}</h1>
      <p>{t(text.body)}</p>
      {error?.detail && import.meta.env.DEV && <pre className="error-detail">{error.detail}</pre>}
      <div className="row">
        <button
          type="button"
          className="mrak-button"
          data-variant="primary"
          onClick={() => {
            window.location.reload();
          }}
        >
          {t('error.retry')}
        </button>
      </div>
    </div>
  );
}

function ConnectedError() {
  const { store } = useApp();
  const error = useStore(store, (s) => s.error);
  return <ErrorView error={error} />;
}

/** Friendly error screen: WebGL missing, assets failed to load, broken content, crash. */
export function ErrorScreen({ error }: { error?: UiState['error'] } = {}) {
  return error === undefined ? <ConnectedError /> : <ErrorView error={error} />;
}
