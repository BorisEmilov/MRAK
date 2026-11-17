import { useState, type SyntheticEvent } from 'react';
import { t } from '../../i18n/t';

/**
 * Login / registration UI. The online-api auth endpoints do not exist yet, so submitting says so
 * plainly. When they do: access token in memory only, refresh token in an HttpOnly cookie, never
 * localStorage (CLAUDE.md security rules). Passwords are never stored or logged by the client.
 */
export function AccountPanel({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [message, setMessage] = useState<string | null>(null);

  const submit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    form.reset(); // do not keep the password in the DOM
    setMessage(t('account.unavailable'));
  };

  return (
    <>
      <h2>{t('menu.account')}</h2>
      <p className="muted">{t('account.guest-note')}</p>
      <div className="tabs" role="tablist">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`tab ${mode === m ? 'active' : ''}`}
            onClick={() => {
              setMode(m);
              setMessage(null);
            }}
          >
            {t(`account.${m}`)}
          </button>
        ))}
      </div>
      <form className="form" onSubmit={submit} noValidate={false}>
        <label className="field">
          <span>{t('account.email')}</span>
          <input type="email" name="email" required maxLength={254} autoComplete="email" />
        </label>
        <label className="field">
          <span>{t('account.password')}</span>
          <input
            type="password"
            name="password"
            required
            minLength={mode === 'register' ? 12 : 1}
            maxLength={256}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
        </label>
        {mode === 'register' && <p className="muted">{t('account.password-rule')}</p>}
        <button type="submit" className="mrak-button" data-variant="primary">
          {t(mode === 'login' ? 'account.login' : 'account.register')}
        </button>
        {message && <p role="status">{message}</p>}
      </form>
      <button type="button" className="mrak-button" onClick={onBack}>
        {t('menu.back')}
      </button>
    </>
  );
}
