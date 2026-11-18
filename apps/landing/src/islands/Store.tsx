/**
 * Store (docs/systems/store.md): edition choice with the EU consent checkbox → server-created
 * checkout → Paddle overlay on /buy/checkout/ → /buy/thanks/ waits for the entitlement that only
 * the verified webhook grants (the redirect itself grants nothing).
 */
import { createStoreClient, type Sku } from '@mrak/api-client';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { account, errorKey, Notice, StringsProvider, useT, type IslandProps } from './shared';

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (env: string) => void };
      Initialize: (opts: Record<string, unknown>) => void;
      Checkout: { open: (opts: Record<string, unknown>) => void };
    };
  }
}
const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js';

function Buy({ config }: IslandProps) {
  const t = useT();
  const api = account(config.apiUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    void api.resume().then(setSignedIn);
  }, [api]);
  if (!config.paddleToken) return <Notice text={t('site.buy.not-yet')} />;
  if (signedIn === false)
    return (
      <p className="row">
        <a className="mrak-button" data-variant="primary" href="/login/?next=/buy/">
          {t('site.store.sign-in')}
        </a>
        <a href="/signup/">{t('site.auth.signup.link')}</a>
      </p>
    );
  const submit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = e.currentTarget;
    const sku = (form.elements.namedItem('sku') as RadioNodeList).value as Sku;
    setBusy(true);
    setMsg(null);
    createStoreClient(api)
      .checkout(sku, true)
      .then(({ url }) => {
        const next = new URL(url);
        if (next.origin !== window.location.origin) throw new Error('unexpected checkout origin');
        window.location.assign(next.toString());
      })
      .catch((err: unknown) => {
        setMsg(t(errorKey(err)));
        setBusy(false);
      });
  };
  return (
    <form className="form" onSubmit={submit}>
      <fieldset>
        <legend>{t('site.store.edition')}</legend>
        <label className="choice">
          <input type="radio" name="sku" value="full-game" defaultChecked />{' '}
          {t('site.editions.full.name')}
        </label>
        <label className="choice">
          <input type="radio" name="sku" value="collector" /> {t('site.store.collector')}
        </label>
      </fieldset>
      <label className="choice">
        <input type="checkbox" name="consent" required /> {t('site.store.consent')}
      </label>
      <p className="muted">
        {t('site.store.terms')} <a href="/terms/#terms-of-sale">{t('site.footer.terms')}</a> ·{' '}
        <a href="/refunds/">{t('site.footer.refunds')}</a>
      </p>
      <button
        type="submit"
        className="mrak-button"
        data-variant="primary"
        disabled={busy || !signedIn}
      >
        {t('site.store.checkout')}
      </button>
      <Notice text={msg} bad />
    </form>
  );
}

function Checkout({ config }: IslandProps) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const txn = new URLSearchParams(window.location.search).get('_ptxn') ?? '';
    if (!/^txn_[a-z0-9]{1,60}$/.test(txn) || !config.paddleToken) {
      setFailed(true);
      return;
    }
    const open = (): void => {
      const P = window.Paddle;
      if (!P) {
        setFailed(true);
        return;
      }
      if (config.paddleEnv === 'sandbox') P.Environment.set('sandbox');
      P.Initialize({ token: config.paddleToken });
      P.Checkout.open({
        transactionId: txn,
        settings: {
          displayMode: 'overlay',
          theme: 'dark',
          successUrl: `${window.location.origin}/buy/thanks/`,
        },
      });
    };
    const script = document.createElement('script');
    script.src = PADDLE_JS;
    script.async = true;
    script.addEventListener('load', open);
    script.addEventListener('error', () => {
      setFailed(true);
    });
    document.head.append(script);
  }, [config]);
  return failed ? (
    <Notice text={t('site.store.checkout-failed')} bad />
  ) : (
    <p role="status">{t('site.store.opening')}</p>
  );
}

function Thanks({ config }: IslandProps) {
  const t = useT();
  const api = account(config.apiUrl);
  const [state, setState] = useState<'waiting' | 'ready' | 'slow' | 'signed-out'>('waiting');
  useEffect(() => {
    let stop = false;
    const started = Date.now();
    const poll = async (): Promise<void> => {
      if (!(await api.resume())) {
        setState('signed-out');
        return;
      }
      while (!stop) {
        const owned = await createStoreClient(api)
          .entitlements()
          .catch(() => []);
        if (owned.some((e) => e.status === 'active')) {
          setState('ready');
          return;
        }
        if (Date.now() - started > 120_000) {
          setState('slow');
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    };
    void poll();
    return () => {
      stop = true;
    };
  }, [api]);
  if (state === 'ready')
    return (
      <>
        <Notice text={t('site.store.ready')} />
        <a className="mrak-button" data-variant="primary" href={config.playUrl}>
          {t('site.home.play')}
        </a>
      </>
    );
  if (state === 'signed-out')
    return <a href="/login/?next=/buy/thanks/">{t('site.store.sign-in')}</a>;
  return <p role="status">{t(state === 'slow' ? 'site.store.slow' : 'site.store.waiting')}</p>;
}

export default function Store(p: IslandProps) {
  const mode = p.props['mode'];
  return (
    <StringsProvider strings={p.strings}>
      {mode === 'checkout' ? (
        <Checkout {...p} />
      ) : mode === 'thanks' ? (
        <Thanks {...p} />
      ) : (
        <Buy {...p} />
      )}
    </StringsProvider>
  );
}
