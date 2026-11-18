import { useState, type SyntheticEvent } from 'react';
import { Notice, StringsProvider, Turnstile, useT, type IslandProps } from './shared';

function Form({ config }: IslandProps) {
  const t = useT();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    setBusy(true);
    fetch(`${config.apiUrl}/v1/newsletter/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, captcha }),
    })
      .then((res) => {
        setMessage(
          res.ok
            ? { text: t('site.newsletter.check'), bad: false }
            : {
                text: t(res.status === 429 ? 'site.error.slow-down' : 'site.error.generic'),
                bad: true,
              },
        );
        if (res.ok) form.reset();
      })
      .catch(() => {
        setMessage({ text: t('site.error.offline'), bad: true });
      })
      .finally(() => {
        setBusy(false);
        setCaptcha(null);
      });
  };
  return (
    <form className="form" onSubmit={submit}>
      <label className="field">
        <span>{t('site.form.email')}</span>
        <input type="email" name="email" required maxLength={254} autoComplete="email" />
      </label>
      <Turnstile siteKey={config.turnstileSiteKey} action="newsletter" onToken={setCaptcha} />
      <button
        type="submit"
        className="mrak-button"
        data-variant="primary"
        disabled={busy || !captcha}
      >
        {t('site.newsletter.submit')}
      </button>
      <p className="muted">{t('site.newsletter.privacy')}</p>
      <Notice text={message?.text ?? null} bad={message?.bad ?? false} />
    </form>
  );
}

export default function Newsletter(p: IslandProps) {
  return (
    <StringsProvider strings={p.strings}>
      <Form {...p} />
    </StringsProvider>
  );
}
