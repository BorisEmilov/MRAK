import { ApiError } from '@mrak/api-client';
import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  account,
  errorKey,
  Notice,
  PasswordStrength,
  StringsProvider,
  Turnstile,
  useT,
  type IslandProps,
} from './shared';

type Mode = 'signup' | 'login' | 'forgot' | 'verify' | 'reset';

const value = (form: HTMLFormElement, name: string): string =>
  (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';

/** Token from the URL fragment, removed from the address bar and history at once. */
function takeToken(): string | null {
  const token = /(?:^#|&)token=([\w-]{20,128})/.exec(window.location.hash)?.[1] ?? null;
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  return token;
}

function AuthForms({ config, props }: IslandProps) {
  const t = useT();
  const mode = props['mode'] as Mode;
  const api = account(config.apiUrl);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [needCaptcha, setNeedCaptcha] = useState(mode === 'signup' || mode === 'forgot');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [token] = useState(() => (mode === 'verify' || mode === 'reset' ? takeToken() : null));
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (mode !== 'verify') return;
    if (!token) {
      setMessage({ text: t('site.error.link'), bad: true });
      return;
    }
    api
      .verifyEmail(token)
      .then(() => {
        setDone(true);
        setMessage({ text: t('site.auth.verified'), bad: false });
      })
      .catch((err: unknown) => {
        setMessage({ text: t(errorKey(err)), bad: true });
      });
  }, []);

  const run = (form: HTMLFormElement, work: () => Promise<string | null>): void => {
    setBusy(true);
    setMessage(null);
    work()
      .then((ok) => {
        form.reset();
        setPassword('');
        if (ok) {
          setDone(true);
          setMessage({ text: ok, bad: false });
        }
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'captcha_required') setNeedCaptcha(true);
        const pw = form.elements.namedItem('password');
        if (pw instanceof HTMLInputElement) pw.value = '';
        setPassword('');
        setMessage({ text: t(errorKey(err)), bad: true });
      })
      .finally(() => {
        setBusy(false);
        setCaptcha(null);
      });
  };

  const submit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = e.currentTarget;
    const mail = value(form, 'email');
    if (mode === 'signup')
      run(form, async () => {
        const name = value(form, 'displayName').trim();
        await api.register({
          email: mail,
          password: value(form, 'password'),
          captcha: captcha ?? '',
          ...(name ? { displayName: name } : {}),
        });
        return t('site.auth.check-email');
      });
    else if (mode === 'login')
      run(form, async () => {
        await api.login({
          email: mail,
          password: value(form, 'password'),
          ...(captcha ? { captcha } : {}),
        });
        const next = new URLSearchParams(window.location.search).get('next');
        window.location.assign(
          next?.startsWith('/') && !next.startsWith('//') ? next : '/account/',
        );
        return null;
      });
    else if (mode === 'forgot')
      run(form, async () => {
        await api.forgotPassword(mail, captcha ?? '');
        return t('site.auth.check-email');
      });
    else if (mode === 'reset' && token)
      run(form, async () => {
        await api.resetPassword(token, value(form, 'password'));
        return t('site.auth.reset-done');
      });
  };

  if (mode === 'verify')
    return (
      <>
        {!message && <p role="status">{t('site.common.working')}</p>}
        <Notice text={message?.text ?? null} bad={message?.bad ?? false} />
        {done && (
          <p className="row">
            <a className="mrak-button" data-variant="primary" href="/login/">
              {t('site.nav.login')}
            </a>
            <a href={config.playUrl}>{t('site.home.play')}</a>
          </p>
        )}
      </>
    );

  if (done)
    return (
      <>
        <Notice text={message?.text ?? null} />
        {mode === 'reset' && (
          <a className="mrak-button" data-variant="primary" href="/login/">
            {t('site.nav.login')}
          </a>
        )}
      </>
    );

  if (mode === 'reset' && !token) return <Notice text={t('site.error.link')} bad />;

  const newPassword = mode === 'signup' || mode === 'reset';
  const showCaptcha = needCaptcha && mode !== 'reset';
  return (
    <form className="form" onSubmit={submit}>
      {mode !== 'reset' && (
        <label className="field">
          <span>{t('site.form.email')}</span>
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete={mode === 'signup' ? 'email' : 'username'}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </label>
      )}
      {mode !== 'forgot' && (
        <label className="field">
          <span>{t(newPassword ? 'site.form.new-password' : 'site.form.password')}</span>
          <input
            type="password"
            name="password"
            required
            minLength={newPassword ? 12 : 1}
            maxLength={128}
            autoComplete={newPassword ? 'new-password' : 'current-password'}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </label>
      )}
      {newPassword && (
        <>
          <p className="muted">{t('site.password.rule')}</p>
          <PasswordStrength password={password} inputs={email ? [email] : []} />
        </>
      )}
      {mode === 'signup' && (
        <label className="field">
          <span>{t('site.form.display-name')}</span>
          <input
            type="text"
            name="displayName"
            minLength={3}
            maxLength={24}
            autoComplete="nickname"
          />
        </label>
      )}
      {showCaptcha && (
        <Turnstile
          siteKey={config.turnstileSiteKey}
          action={mode === 'signup' ? 'register' : mode}
          onToken={setCaptcha}
        />
      )}
      <button
        type="submit"
        className="mrak-button"
        data-variant="primary"
        disabled={busy || (showCaptcha && !captcha)}
      >
        {t(`site.auth.${mode}.submit`)}
      </button>
      <Notice text={message?.text ?? null} bad={message?.bad ?? false} />
      {mode === 'login' && (
        <p className="row">
          <a href="/forgot/">{t('site.auth.forgot.link')}</a>
          <a href="/signup/">{t('site.auth.signup.link')}</a>
        </p>
      )}
      {mode === 'signup' && (
        <p className="muted">
          {t('site.auth.signup.terms')} <a href="/terms/">{t('site.footer.terms')}</a> ·{' '}
          <a href="/privacy/">{t('site.footer.privacy')}</a>
        </p>
      )}
    </form>
  );
}

export default function Auth(p: IslandProps) {
  return (
    <StringsProvider strings={p.strings}>
      <AuthForms {...p} />
    </StringsProvider>
  );
}
