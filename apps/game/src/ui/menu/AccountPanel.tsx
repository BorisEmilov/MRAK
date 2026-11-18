import { ApiError } from '@mrak/api-client';
import type { LocaleKey } from '@mrak/content';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { t } from '../../i18n/t';
import { migrateGuest } from '../../online/wire';
import { useApp, useUi } from '../../state/hooks';
import { SyncStatus, Turnstile } from '../online/OnlineUi';

type Mode = 'login' | 'register' | 'forgot';

/** Message for an online-api error (RFC 9457 code). Never echoes server text. */
function errorText(err: unknown): string {
  const code = err instanceof ApiError ? err.code : 'error';
  const known: Record<string, LocaleKey> = {
    invalid_credentials: 'account.error.credentials',
    captcha_required: 'account.error.captcha',
    weak_password: 'account.error.weak',
    email_not_allowed: 'account.error.email',
    too_many_requests: 'account.error.slow-down',
    network: 'account.error.offline',
    invalid_token: 'account.error.link',
    feature_disabled: 'account.error.disabled',
  };
  return t(known[code] ?? 'account.error.generic');
}

const field = (form: HTMLFormElement, name: string): string =>
  (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';

/**
 * Sign-in, sign-up, recovery and the signed-in account (ADR 0007, 0009). Passwords are never
 * kept: the form is reset after each submit. Tokens never leave the account client's memory.
 */
export function AccountPanel({ onBack }: { onBack: () => void }) {
  const { online, host, store } = useApp();
  const account = useUi((s) => s.account);
  const link = useUi((s) => s.accountLink);
  const [mode, setMode] = useState<Mode>('login');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const onToken = useCallback((token: string | null) => {
    setCaptcha(token);
  }, []);

  // Email links: verify right away; reset shows the new-password form.
  useEffect(() => {
    if (!online || link?.kind !== 'verify') return;
    store.setState({ accountLink: null });
    online.account
      .verifyEmail(link.token)
      .then(() => {
        setMessage(t('account.verified'));
        if (online.account.user()) void online.account.me();
      })
      .catch((err: unknown) => {
        setMessage(errorText(err));
      });
  }, [online, link, store]);

  if (!online) {
    return (
      <>
        <h2>{t('menu.account')}</h2>
        <p className="muted">{t('account.unavailable')}</p>
        <button type="button" className="mrak-button" onClick={onBack}>
          {t('menu.back')}
        </button>
      </>
    );
  }

  const run = (form: HTMLFormElement, work: () => Promise<string | null>): void => {
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    setBusy(true);
    setMessage(null);
    work()
      .then((done) => {
        form.reset();
        setMessage(done);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'captcha_required') setNeedCaptcha(true);
        // Keep the email, never the password.
        const pw = form.elements.namedItem('password');
        if (pw instanceof HTMLInputElement) pw.value = '';
        setMessage(errorText(err));
      })
      .finally(() => {
        setBusy(false);
        setCaptcha(null);
      });
  };

  if (link?.kind === 'reset') {
    const submit = (e: SyntheticEvent<HTMLFormElement>): void => {
      e.preventDefault();
      const form = e.currentTarget;
      run(form, async () => {
        await online.account.resetPassword(link.token, field(form, 'password'));
        store.setState({ accountLink: null });
        setMode('login');
        return t('account.reset-done');
      });
    };
    return (
      <>
        <h2>{t('account.reset-title')}</h2>
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>{t('account.new-password')}</span>
            <input
              type="password"
              name="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <p className="muted">{t('account.password-rule')}</p>
          <button type="submit" className="mrak-button" data-variant="primary" disabled={busy}>
            {t('account.reset-submit')}
          </button>
          {message && <p role="status">{message}</p>}
        </form>
        <button type="button" className="mrak-button" onClick={onBack}>
          {t('menu.back')}
        </button>
      </>
    );
  }

  if (account) {
    return (
      <>
        <h2>{t('menu.account')}</h2>
        <p>{t('account.signed-in-as', { email: account.email })}</p>
        <SyncStatus />
        {!account.emailVerified && <p className="muted">{t('account.verify-needed')}</p>}
        <div className="row">
          <button
            type="button"
            className="mrak-button"
            disabled={busy || !account.emailVerified}
            title={t('account.upload-hint')}
            onClick={() => {
              setBusy(true);
              void migrateGuest(online, host, store, window.localStorage)
                .then(() => {
                  setMessage(t('account.upload-done'));
                })
                .catch((err: unknown) => {
                  setMessage(errorText(err));
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {t('account.upload')}
          </button>
          <button
            type="button"
            className="mrak-button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void online.account
                .logout()
                .catch(() => undefined)
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {t('account.logout')}
          </button>
        </div>
        {message && <p role="status">{message}</p>}
        <button type="button" className="mrak-button" onClick={onBack}>
          {t('menu.back')}
        </button>
      </>
    );
  }

  const submit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = field(form, 'email');
    if (mode === 'login')
      run(form, async () => {
        await online.account.login({
          email,
          password: field(form, 'password'),
          ...(captcha ? { captcha } : {}),
        });
        setNeedCaptcha(false);
        return null;
      });
    else if (mode === 'register')
      run(form, async () => {
        const name = field(form, 'displayName').trim();
        await online.account.register({
          email,
          password: field(form, 'password'),
          captcha: captcha ?? '',
          ...(name ? { displayName: name } : {}),
        });
        return t('account.check-email');
      });
    else
      run(form, async () => {
        await online.account.forgotPassword(email, captcha ?? '');
        return t('account.check-email');
      });
  };

  const showCaptcha = mode !== 'login' || needCaptcha;
  return (
    <>
      <h2>{t('menu.account')}</h2>
      <p className="muted">{t('account.guest-note')}</p>
      <div className="tabs" role="tablist">
        {(['login', 'register', 'forgot'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`tab ${mode === m ? 'active' : ''}`}
            onClick={() => {
              setMode(m);
              setMessage(null);
              setCaptcha(null);
            }}
          >
            {t(`account.${m}` as LocaleKey)}
          </button>
        ))}
      </div>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>{t('account.email')}</span>
          <input type="email" name="email" required maxLength={254} autoComplete="email" />
        </label>
        {mode !== 'forgot' && (
          <label className="field">
            <span>{t('account.password')}</span>
            <input
              type="password"
              name="password"
              required
              minLength={mode === 'register' ? 12 : 1}
              maxLength={128}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
          </label>
        )}
        {mode === 'register' && (
          <>
            <p className="muted">{t('account.password-rule')}</p>
            <label className="field">
              <span>{t('account.display-name')}</span>
              <input
                type="text"
                name="displayName"
                minLength={3}
                maxLength={24}
                pattern="[\p{L}\p{N} ._\-]{3,24}"
                autoComplete="nickname"
              />
            </label>
          </>
        )}
        {showCaptcha && (
          <Turnstile key={mode} siteKey={online.turnstileSiteKey} action={mode} onToken={onToken} />
        )}
        <button
          type="submit"
          className="mrak-button"
          data-variant="primary"
          disabled={busy || (showCaptcha && !captcha)}
        >
          {t(
            mode === 'login'
              ? 'account.login'
              : mode === 'register'
                ? 'account.register'
                : 'account.forgot-submit',
          )}
        </button>
        {message && <p role="status">{message}</p>}
      </form>
      <button type="button" className="mrak-button" onClick={onBack}>
        {t('menu.back')}
      </button>
    </>
  );
}
