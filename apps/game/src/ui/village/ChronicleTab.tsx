/**
 * The Chronicle board (docs/systems/endless-chronicle.md → Implementation): long-term goals of the
 * village, the line and the collection; the Endless Chronicle once a route has ended — its
 * Darkness level and the relic talents it unlocks; and the titles live seasons gave the family.
 */
import type { LocaleKey } from '@mrak/content';
import { endlessRules, type Snapshot } from '@mrak/core';
import { Button } from '@mrak/ui-kit';
import { useState } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';

const CATEGORIES = ['village', 'lineage', 'collection'] as const;

export function ChronicleTab({ snapshot }: { snapshot: Snapshot }) {
  const { host } = useApp();
  const titles = useUi((s) => s.profile.titles);
  const db = host.content;
  const rules = endlessRules(db);
  const e = snapshot.endless;
  const [darkness, setDarkness] = useState(e.darkness);
  if (!rules) return <p className="village-empty">{t('chronicle.none')}</p>;
  const goals = host.chronicleGoals();
  const levels = Array.from({ length: Math.min(rules.maxDarkness, e.best + 1) + 1 }, (_, i) => i);
  const lastHarvest = e.harvests.at(-1);
  const harvestName = lastHarvest
    ? rules.harvests.find((h) => h.id === lastHarvest.harvest)?.nameKey
    : undefined;

  return (
    <div className="chronicle-tab">
      {CATEGORIES.map((c) => (
        <section key={c} aria-labelledby={`chronicle-${c}`}>
          <h3 id={`chronicle-${c}`}>{t(`chronicle.category.${c}`)}</h3>
          <ul className="chronicle-goals">
            {goals
              .filter((g) => g.category === c)
              .map((g) => (
                <li key={g.id} data-done={g.done}>
                  <span>{t(g.nameKey as LocaleKey)}</span>
                  <progress max={g.target} value={Math.min(g.value, g.target)} />
                  <small>
                    {t('chronicle.progress', {
                      value: Math.floor(Math.min(g.value, g.target)),
                      target: g.target,
                    })}
                    {g.legacy > 0 ? ` · ${t('chronicle.reward', { legacy: g.legacy })}` : ''}
                  </small>
                </li>
              ))}
          </ul>
        </section>
      ))}

      <section aria-labelledby="chronicle-endless">
        <h3 id="chronicle-endless">{t('chronicle.endless')}</h3>
        {!e.unlocked ? (
          <p className="village-hint">{t('chronicle.locked')}</p>
        ) : (
          <>
            <p>
              {e.active
                ? t('chronicle.status', { years: e.years, darkness: e.darkness })
                : t('chronicle.ready')}
              {harvestName ? ` · ${t(harvestName as LocaleKey)}` : ''}
            </p>
            <label className="chronicle-darkness">
              {t('chronicle.darkness')}{' '}
              <select
                value={darkness}
                onChange={(ev) => {
                  setDarkness(Number(ev.target.value));
                }}
              >
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {l === 0
                      ? t('chronicle.darkness-none')
                      : t(`darkness-level.darkness-${String(l)}.name` as LocaleKey)}
                  </option>
                ))}
              </select>{' '}
              <Button
                variant="primary"
                onClick={() => {
                  host.dispatch(
                    e.active
                      ? { type: 'setDarkness', level: darkness }
                      : { type: 'startEndless', darkness },
                  );
                }}
              >
                {e.active ? t('chronicle.set-darkness') : t('chronicle.begin')}
              </Button>
            </label>
            {darkness > 0 && (
              <p className="village-hint">
                {t(`darkness-level.darkness-${String(darkness)}.desc` as LocaleKey)}
              </p>
            )}
            <h4>{t('chronicle.relics')}</h4>
            <p className="village-hint">{t('chronicle.relics-hint')}</p>
            <ul className="chronicle-relics">
              {rules.relics.map((r) => {
                const key = `${r.tree}/${r.cell}`;
                const chosen = e.swaps[key] === r.talent;
                const talent = db.get('talents', r.talent);
                return (
                  <li key={r.id}>
                    <strong>{t(talent.nameKey as LocaleKey)}</strong>{' '}
                    <small>{t(talent.descKey as LocaleKey)}</small>{' '}
                    <Button
                      {...(e.best < r.darkness
                        ? { disabledReason: t('chronicle.relic-locked', { level: r.darkness }) }
                        : snapshot.guardian.talents.includes(key)
                          ? { disabledReason: t('chronicle.relic-bought') }
                          : {})}
                      onClick={() => {
                        host.dispatch({ type: 'chooseRelic', relic: r.id, on: !chosen });
                      }}
                    >
                      {chosen ? t('chronicle.relic-off') : t('chronicle.relic-on')}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {titles.length > 0 && (
        <section aria-labelledby="chronicle-titles">
          <h3 id="chronicle-titles">{t('chronicle.titles')}</h3>
          <p>{titles.map((k) => t(k as LocaleKey)).join(' · ')}</p>
        </section>
      )}
    </div>
  );
}
