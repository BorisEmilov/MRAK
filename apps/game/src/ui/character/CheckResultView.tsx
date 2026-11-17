/**
 * Check result (UI task 15): a short, clear animation of the dice (success/failure × omen) and an
 * explanation of every die, so the player learns the system. Reduced motion shows it at once.
 * It never pauses the game; Escape or the close button dismisses it, and it fades by itself.
 */
import type { LocaleKey } from '@mrak/content';
import { IconButton, IconGlyph } from '@mrak/ui-kit';
import { useEffect, useState } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { faceSymbols, omenIcon, partDice, partLabel, resultTitle } from './progression-ui';

const VISIBLE_MS = 9000;

export function CheckResultView() {
  const { host, store } = useApp();
  const check = useUi((s) => s.lastCheck);
  // Held open while the player reads it (pointer over it, or the explanation open).
  const [held, setHeld] = useState<object | null>(null);
  const pinned = held !== null && held === check;
  useEffect(() => {
    if (!check) return;
    const close = (): void => {
      store.setState({ lastCheck: null });
    };
    const timer = pinned ? undefined : window.setTimeout(close, VISIBLE_MS);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [check, store, pinned]);
  if (!check) return null;
  const db = host.content;
  const skill = t((db.find('skills', check.skill)?.nameKey ?? check.skill) as LocaleKey);

  return (
    <aside
      className="check-result"
      data-success={check.success || undefined}
      data-omen={check.omen}
      role="status"
      aria-live="polite"
      aria-label={t('check.title', { skill })}
      onPointerEnter={() => {
        setHeld(check);
      }}
    >
      <header>
        <IconGlyph name="check.dice" size={24} tone="inherit" />
        <h2>{t('check.title', { skill })}</h2>
        <IconButton
          icon="ui.close"
          label={t('ui.close')}
          variant="secondary"
          onClick={() => {
            store.setState({ lastCheck: null });
          }}
        />
      </header>
      <div className="check-dice" aria-hidden="true">
        {check.fateFaces.map((f, i) => (
          <span
            key={`f${String(i)}`}
            className="check-die"
            data-kind="fate"
            style={{ animationDelay: `${String(i * 70)}ms` }}
          >
            {faceSymbols('fate', f).map((s) => (
              <IconGlyph key={s} name={s} size={16} tone="inherit" />
            ))}
          </span>
        ))}
        {check.shadowFaces.map((f, i) => (
          <span
            key={`s${String(i)}`}
            className="check-die"
            data-kind="shadow"
            style={{ animationDelay: `${String((check.fateFaces.length + i) * 70)}ms` }}
          >
            {faceSymbols('shadow', f).map((s) => (
              <IconGlyph key={s} name={s} size={16} tone="inherit" />
            ))}
          </span>
        ))}
      </div>
      <p className="check-verdict">
        <IconGlyph
          name={check.success ? 'check.success' : 'check.failure'}
          size={24}
          tone="inherit"
        />
        <IconGlyph name={omenIcon(check.omen)} size={24} tone="inherit" />
        <strong>{resultTitle(check, t)}</strong>
      </p>
      <p className="check-counts">
        {t('check.counts', {
          successes: check.successes,
          failures: check.failures,
          good: check.good,
          bad: check.bad,
        })}
      </p>
      {check.outcomeKey && <p className="check-outcome">{t(check.outcomeKey as LocaleKey)}</p>}
      <details
        className="check-why"
        onToggle={() => {
          setHeld(check);
        }}
      >
        <summary>{t('check.why')}</summary>
        <ul>
          {check.parts.map((p) => (
            <li key={p.source}>
              <span>{partLabel(p.source, db, t)}</span> <strong>{partDice(p, t)}</strong>
            </li>
          ))}
          {check.adjustments.map((a) => (
            <li key={a}>{t(`check.adjust.${a.replace('talent:', 'talent-')}` as LocaleKey)}</li>
          ))}
        </ul>
        <p className="items-hint">{t('check.rules')}</p>
      </details>
    </aside>
  );
}
