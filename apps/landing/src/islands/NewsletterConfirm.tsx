import { useEffect, useState } from 'react';
import { Notice, StringsProvider, useT, type IslandProps } from './shared';

/** Reads the token from the URL fragment (never sent to servers or logs) and confirms. */
function Confirm({ config }: IslandProps) {
  const t = useT();
  const [state, setState] = useState<'working' | 'ok' | 'bad'>('working');
  useEffect(() => {
    const token = /(?:^#|&)token=([\w-]{20,128})/.exec(window.location.hash)?.[1];
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setState('bad');
      return;
    }
    fetch(`${config.apiUrl}/v1/newsletter/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        setState(res.ok ? 'ok' : 'bad');
      })
      .catch(() => {
        setState('bad');
      });
  }, [config.apiUrl]);
  if (state === 'working') return <p role="status">{t('site.common.working')}</p>;
  return (
    <Notice
      text={t(state === 'ok' ? 'site.newsletter.confirmed' : 'site.error.link')}
      bad={state === 'bad'}
    />
  );
}

export default function NewsletterConfirm(p: IslandProps) {
  return (
    <StringsProvider strings={p.strings}>
      <Confirm {...p} />
    </StringsProvider>
  );
}
