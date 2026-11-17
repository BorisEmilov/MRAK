/**
 * Building management (docs/systems/village-growth.md → Implementation): every building with its
 * level, what the next level brings, its cost in materials, villager labour and sometimes blood,
 * and the work under way. Prosperity and population head the tab.
 */
import type { LocaleKey } from '@mrak/content';
import {
  ageOf,
  growthRules,
  itemCount,
  population,
  prosperityScore,
  villageLevel,
  type Snapshot,
} from '@mrak/core';
import { Button, IconGlyph, Tooltip, type IconName } from '@mrak/ui-kit';
import { useState } from 'react';
import { t } from '../../i18n/t';
import { useApp } from '../../state/hooks';

export function BuildingsTab({ snapshot }: { snapshot: Snapshot }) {
  const { host } = useApp();
  const db = host.content;
  const [shadow, setShadow] = useState('');
  const rules = growthRules(db);
  if (!rules) return <p className="village-empty">{t('build.none')}</p>;
  const previews = host.buildPreviews();
  const victims = db
    .all('villagers')
    .filter(
      (v) => snapshot.villagers[v.id]?.alive === true && (ageOf(snapshot, db, v.id) ?? 0) >= 14,
    );
  const name = (key: string): string => t(key as LocaleKey);

  return (
    <div className="build-tab">
      <p className="build-summary">
        <IconGlyph name="faction.village" size={16} tone="inherit" />{' '}
        {t('build.prosperity', {
          level: villageLevel(snapshot, db),
          score: Math.round(prosperityScore(snapshot, db)),
        })}{' '}
        · {t('build.population', { count: population(snapshot, db) })}
      </p>
      {snapshot.village.projects.map((p) => (
        <p key={p.building} className="build-project">
          {t('build.in-progress', {
            building: name(db.get('buildings', p.building).nameKey),
            level: p.level,
            done: Math.floor(p.labour),
            needed: p.needed,
          })}
        </p>
      ))}
      <p className="village-hint">{t('build.labour-hint')}</p>
      <ul className="build-list">
        {db.all('buildings').map((b) => {
          const built = snapshot.village.buildings[b.id] ?? 0;
          const preview = previews.find((p) => p.building === b.id);
          const next = b.levels.find((l) => l.level === built + 1);
          const current = b.levels.find((l) => l.level === built);
          const blocked = preview ? preview.blocked : 'max';
          return (
            <li key={b.id} className="build-card">
              <h4>
                <IconGlyph
                  name={(b.icon ?? 'faction.village') as IconName}
                  size={24}
                  tone="inherit"
                />{' '}
                {name(b.nameKey)}{' '}
                <span className="build-level">
                  {t('build.level', { level: built, max: b.levels.length })}
                </span>
              </h4>
              <p>{current ? name(current.descKey) : name(b.descKey)}</p>
              {next && (
                <div className="build-next">
                  <p>
                    <strong>{t('build.next', { level: next.level })}</strong> {name(next.descKey)}
                  </p>
                  <ul className="build-costs">
                    {next.cost.materials.map((m) => {
                      const have = itemCount(snapshot, m.item, 'storage');
                      return (
                        <li key={m.item} data-short={have < m.qty}>
                          {name(db.get('items', m.item).nameKey)} {have}/{m.qty}
                        </li>
                      );
                    })}
                    <li>{t('build.labour', { days: next.cost.labourDays })}</li>
                    <li>{t('build.prosperity-gain', { score: next.prosperity })}</li>
                    {next.minProsperity > 1 && (
                      <li>{t('build.min-prosperity', { level: next.minProsperity })}</li>
                    )}
                  </ul>
                  {next.blood !== undefined && (
                    <Tooltip title={t('build.blood')} description={t('build.blood-desc')}>
                      <label className="build-blood">
                        <IconGlyph name="ui.irreversible" size={16} tone="inherit" />{' '}
                        {t('build.blood')}{' '}
                        <select
                          value={shadow}
                          onChange={(e) => {
                            setShadow(e.target.value);
                          }}
                        >
                          <option value="">{t('build.blood-choose')}</option>
                          {victims.map((v) => (
                            <option key={v.id} value={v.id}>
                              {name(v.nameKey)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </Tooltip>
                  )}
                  <Button
                    variant="primary"
                    irreversible={next.blood !== undefined}
                    {...(blocked !== null
                      ? { disabledReason: t(`build.blocked.${blocked}`) }
                      : next.blood !== undefined && shadow === ''
                        ? { disabledReason: t('build.blood-choose') }
                        : {})}
                    onClick={() => {
                      host.dispatch({
                        type: 'build',
                        building: b.id,
                        ...(next.blood !== undefined ? { shadow } : {}),
                      });
                    }}
                  >
                    {t('build.start')}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
