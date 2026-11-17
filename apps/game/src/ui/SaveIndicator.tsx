import type { LocaleKey } from '@mrak/content';
import { useEffect, useState } from 'react';
import { t } from '../i18n/t';
import { useUi } from '../state/hooks';

const VISIBLE_MS = 2500;

const KEYS = {
  saving: 'save.indicator-saving',
  saved: 'save.indicator-saved',
  failed: 'save.indicator-failed',
  refused: 'save.night-locked',
} as const satisfies Record<string, LocaleKey>;

/** Small corner notice for saves (autosaves included), announced politely to screen readers. */
export function SaveIndicator() {
  const activity = useUi((s) => s.saveActivity);
  // The activity whose notice has timed out (each save produces a new activity object).
  const [expired, setExpired] = useState<typeof activity>(null);

  useEffect(() => {
    if (!activity || activity.state === 'saving') return undefined;
    const timer = window.setTimeout(() => {
      setExpired(activity);
    }, VISIBLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activity]);

  if (!activity || activity === expired) return null;
  const key = KEYS[activity.state];
  return (
    <div className={`save-indicator ${activity.state}`} role="status" aria-live="polite">
      <span className="save-indicator-icon" aria-hidden="true">
        ✦
      </span>
      {t(key)}
    </div>
  );
}
