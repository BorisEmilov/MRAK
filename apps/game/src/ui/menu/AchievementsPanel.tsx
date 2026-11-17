import { useState } from 'react';
import type { LocaleKey } from '@mrak/content';
import { cycleUnlocks } from '@mrak/core';
import { Icon } from '@mrak/ui-kit';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';

const FILTERS = ['all', 'unlocked', 'locked'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Achievements of the account (docs/systems/achievements.md): kept in the profile, never in a save.
 * Hidden ones read "???" until unlocked; numeric ones show progress in the running chronicle.
 */
export function AchievementsPanel({ onBack }: { onBack: () => void }) {
  const { host } = useApp();
  const profile = useUi((s) => s.profile);
  const [filter, setFilter] = useState<Filter>('all');
  const achievements = host.content.all('achievements');
  const unlockedAt = new Map(profile.achievements.map((a) => [a.id, a.at]));
  const unlockedCount = achievements.filter((a) => unlockedAt.has(a.id)).length;
  const shown = achievements.filter((a) =>
    filter === 'all' ? true : (filter === 'unlocked') === unlockedAt.has(a.id),
  );
  const { stats } = profile;
  const cycle = cycleUnlocks(profile);
  return (
    <>
      <h2>{t('menu.achievements')}</h2>
      <p className="muted">
        {t('achievements.progress', { unlocked: unlockedCount, total: achievements.length })}
      </p>
      <p className="muted">{t('achievements.account-note')}</p>
      <div className="village-filters" role="group" aria-label={t('achievements.filter.label')}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="village-chip mrak-focusable"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
            }}
          >
            {t(`achievements.filter.${f}`)}
          </button>
        ))}
      </div>
      <ul className="achievement-list">
        {shown.map((a) => {
          const at = unlockedAt.get(a.id);
          const open = at !== undefined;
          const secret = a.hidden && !open;
          const progress = open || secret ? null : host.conditionProgress(a.condition);
          return (
            <li key={a.id} className={open ? 'achievement' : 'achievement locked'}>
              <strong>
                <Icon name="ui.achievements" size={16} decorative />{' '}
                {secret ? t('achievements.hidden-name') : t(a.nameKey as LocaleKey)}
              </strong>
              <span className="muted">
                {secret ? t('achievements.hidden-desc') : t(a.descKey as LocaleKey)}
              </span>
              {open && (
                <span className="muted">
                  {t('achievements.unlocked-on', { date: new Date(at).toLocaleDateString() })}
                </span>
              )}
              {progress && (
                <progress
                  value={progress.have}
                  max={progress.total}
                  aria-label={t('achievements.step', progress)}
                  title={t('achievements.step', progress)}
                />
              )}
            </li>
          );
        })}
      </ul>
      <section aria-labelledby="achievement-stats">
        <h3 id="achievement-stats">{t('achievements.stats.title')}</h3>
        <ul className="achievement-list">
          <li>{t('achievements.stats.nights', { n: stats.nights })}</li>
          <li>{t('achievements.stats.exorcisms', { n: stats.exorcisms })}</li>
          <li>{t('achievements.stats.routes', { n: stats.routes.length })}</li>
          <li>{t('achievements.stats.endings', { n: stats.endings.length })}</li>
        </ul>
        <p className="muted">
          {cycle.open ? t('achievements.cycle.open') : t('achievements.cycle.locked')}
        </p>
      </section>
      <button type="button" className="mrak-button" data-variant="primary" onClick={onBack}>
        {t('menu.back')}
      </button>
    </>
  );
}
