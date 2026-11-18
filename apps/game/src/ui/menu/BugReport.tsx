/**
 * "Report a bug" (docs/systems/testing.md → Bug reports). Sends the description and the game
 * version; the save and its seed only with the consent box ticked. Without an API (offline
 * builds) the report is downloaded as a file instead.
 */
import { useState } from 'react';
import { t } from '../../i18n/t';
import { useApp } from '../../state/hooks';

const API = (import.meta.env as Record<string, string | undefined>)['VITE_API_URL'];

export function BugReport({ onBack }: { onBack: () => void }) {
  const { host } = useApp();
  const [text, setText] = useState('');
  const [attach, setAttach] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const send = async (): Promise<void> => {
    const body = {
      ...host.bugReport(attach),
      platform: 'web',
      description: text.trim().slice(0, 2000),
    };
    setState('sending');
    try {
      if (!API) {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(body)], { type: 'application/json' }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = `mrak-bug-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const res = await fetch(`${API}/v1/bug-reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'omit',
        });
        if (!res.ok) throw new Error(String(res.status));
      }
      setState('sent');
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="menu-buttons bug-report">
      <label className="field">
        <span>{t('bug.describe')}</span>
        <textarea
          rows={5}
          maxLength={2000}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </label>
      <label className="field check">
        <input
          type="checkbox"
          checked={attach}
          onChange={(e) => {
            setAttach(e.target.checked);
          }}
        />
        <span>{t('bug.attach')}</span>
      </label>
      <p className="muted">{t('bug.privacy')}</p>
      {state === 'sent' && <p role="status">{t('bug.sent')}</p>}
      {state === 'failed' && <p role="alert">{t('bug.failed')}</p>}
      <button
        type="button"
        className="mrak-button"
        data-variant="primary"
        disabled={text.trim() === '' || state === 'sending' || state === 'sent'}
        onClick={() => void send()}
      >
        {t(API ? 'bug.send' : 'bug.download')}
      </button>
      <button type="button" className="mrak-button" onClick={onBack}>
        {t('bug.back')}
      </button>
    </div>
  );
}
