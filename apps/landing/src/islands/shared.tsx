import { ApiError, createAccountClient, type AccountClient } from '@mrak/api-client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface IslandProps {
  strings: Record<string, string>;
  config: {
    apiUrl: string;
    playUrl: string;
    turnstileSiteKey: string;
    paddleToken: string;
    paddleEnv: string;
  };
  props: Record<string, unknown>;
}

const Strings = createContext<Record<string, string>>({});
export const StringsProvider = ({
  strings,
  children,
}: {
  strings: Record<string, string>;
  children: ReactNode;
}) => <Strings.Provider value={strings}>{children}</Strings.Provider>;

/** site.* strings from en.json, with {placeholders}. */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const strings = useContext(Strings);
  return (key, params) => {
    const s = strings[key] ?? key;
    return params
      ? s.replace(/\{(\w+)\}/g, (m, n: string) => (params[n] === undefined ? m : String(params[n])))
      : s;
  };
}

let client: AccountClient | null = null;
/** One account client per page: access token in memory only; refresh in the HttpOnly cookie. */
export function account(apiUrl: string): AccountClient {
  client ??= createAccountClient({ baseUrl: apiUrl });
  return client;
}

/** Generic messages: never reveal whether an email exists. */
export function errorKey(err: unknown): string {
  const code = err instanceof ApiError ? err.code : 'error';
  const known: Record<string, string> = {
    invalid_credentials: 'site.error.credentials',
    captcha_required: 'site.error.captcha',
    weak_password: 'site.error.weak',
    email_not_allowed: 'site.error.email',
    too_many_requests: 'site.error.slow-down',
    network: 'site.error.offline',
    invalid_token: 'site.error.link',
    feature_disabled: 'site.error.disabled',
    email_not_verified: 'site.error.unverified',
    already_owned: 'site.store.owned',
    purchases_blocked: 'site.store.blocked',
    entitlement_required: 'site.store.not-owned',
    invalid_name: 'site.store.name-invalid',
  };
  return known[code] ?? 'site.error.generic';
}

export function Notice({ text, bad = false }: { text: string | null; bad?: boolean }) {
  if (!text) return null;
  return (
    <p className={bad ? 'notice bad' : 'notice'} role={bad ? 'alert' : 'status'}>
      {text}
    </p>
  );
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Cloudflare Turnstile; `onToken` gets a single-use token (null when it expires). */
export function Turnstile({
  siteKey,
  action,
  onToken,
}: {
  siteKey: string;
  action: string;
  onToken: (token: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    let widget: string | null = null;
    let cancelled = false;
    const render = (): void => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widget = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        action,
        theme: 'dark',
        callback: (token: string) => {
          callback.current(token);
        },
        'expired-callback': () => {
          callback.current(null);
        },
      });
    };
    if (window.turnstile) render();
    else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
      if (!script) {
        script = document.createElement('script');
        script.src = TURNSTILE_SRC;
        script.async = true;
        document.head.append(script);
      }
      script.addEventListener('load', render);
    }
    return () => {
      cancelled = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, action]);
  return <div ref={ref} className="turnstile" />;
}

/**
 * Password strength (zxcvbn-ts, loaded on demand) — advice only: the server's policy decides.
 */
export function PasswordStrength({
  password,
  inputs = [],
}: {
  password: string;
  inputs?: string[];
}) {
  const t = useT();
  const [score, setScore] = useState<number | null>(null);
  useEffect(() => {
    if (!password) {
      setScore(null);
      return undefined;
    }
    const run = { live: true };
    void (async () => {
      const [{ ZxcvbnFactory }, common, en] = await Promise.all([
        import('@zxcvbn-ts/core'),
        import('@zxcvbn-ts/language-common'),
        import('@zxcvbn-ts/language-en'),
      ]);
      const checker = new ZxcvbnFactory({
        dictionary: { ...common.dictionary, ...en.dictionary },
        graphs: common.adjacencyGraphs,
      });
      const result = checker.check(password, inputs);
      if (run.live) setScore(result.score);
    })();
    return () => {
      run.live = false;
    };
  }, [password, inputs]);
  if (score === null) return null;
  return (
    <div className="strength" aria-live="polite">
      <meter
        min={0}
        max={4}
        low={2}
        high={3}
        optimum={4}
        value={score}
        aria-label={t('site.password.meter')}
      />
      <span>{t(`site.password.score.${String(score)}`)}</span>
    </div>
  );
}
