/**
 * Character sheet (UI task 13): calling, attributes, skills with practice and cap, virtue and sin,
 * Faith and Corruption, Revelation, and the hidden "seen by demons" in words.
 */
import type { LocaleKey } from '@mrak/content';
import {
  attributeCost,
  attributeMax,
  effectiveStat,
  isCallingSkill,
  isReadyToGrow,
  progressionRules,
  skillCapCost,
  threshold,
} from '@mrak/core';
import { Button, IconGlyph, ProgressMeter, type IconName } from '@mrak/ui-kit';
import { useState } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { noticeKey, progressionReasonKey } from './progression-ui';

export function SheetTab() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const [message, setMessage] = useState<string | null>(null);
  const db = host.content;
  const rules = progressionRules(db);
  if (!snapshot || !rules || !snapshot.guardian.callingId) return null;
  const g = snapshot.guardian;
  const calling = db.get('callings', snapshot.guardian.callingId);
  const revelation = snapshot.stats['revelation'] ?? 0;
  const stat = (id: string) => effectiveStat(snapshot, db, id);
  const run = (command: Parameters<typeof host.dispatch>[0]): void => {
    const r = host.dispatch(command);
    setMessage(r.ok ? null : t(progressionReasonKey(r.reason)));
  };
  const virtue = g.virtue ? db.find('virtues', g.virtue) : undefined;
  const sin = g.sin ? db.find('sins', g.sin) : undefined;
  const sinRules = stat('corruption') > stat('faith');

  return (
    <div className="character-sheet">
      <section className="sheet-identity" aria-labelledby="sheet-calling">
        <IconGlyph name={`calling.${calling.id}` as IconName} size={48} tone="inherit" />
        <div>
          <h3 id="sheet-calling">{t(calling.nameKey as LocaleKey)}</h3>
          <p>{t(calling.descKey as LocaleKey)}</p>
          <p className="sheet-ability">
            <strong>{t(calling.ability.nameKey as LocaleKey)}</strong> —{' '}
            {t(calling.ability.descKey as LocaleKey)}
          </p>
        </div>
        <div className="sheet-revelation" role="group" aria-label={t('character.revelation')}>
          <IconGlyph name="resource.revelation" size={32} tone="inherit" />
          <strong>{revelation}</strong>
          <span>{t('character.revelation')}</span>
          <small>{t('character.revelation-lifetime', { value: g.revelation.lifetime })}</small>
        </div>
      </section>

      <div className="sheet-columns">
        <section aria-labelledby="sheet-attributes">
          <h3 id="sheet-attributes">{t('character.attributes')}</h3>
          <ul className="sheet-list">
            {db.all('attributes').map((a) => {
              const value = g.attributes[a.id] ?? rules.attributes.base;
              const max = attributeMax(snapshot, db, rules, a.id);
              const cost = attributeCost(rules, value);
              const reason =
                value >= max
                  ? t('progression.reason.attribute-max')
                  : revelation < cost
                    ? t('progression.reason.revelation')
                    : undefined;
              return (
                <li key={a.id} className="sheet-row">
                  <IconGlyph name={`attribute.${a.id}` as IconName} size={24} tone="inherit" />
                  <span className="sheet-name" title={t(a.descKey as LocaleKey)}>
                    {t(a.nameKey as LocaleKey)}
                  </span>
                  <span
                    className="sheet-pips"
                    role="img"
                    aria-label={t('character.rating', { value, max: rules.attributes.absoluteMax })}
                  >
                    {Array.from({ length: rules.attributes.absoluteMax }, (_, i) => (
                      <span
                        key={i}
                        data-on={i < value || undefined}
                        data-locked={i >= max || undefined}
                      />
                    ))}
                  </span>
                  <Button
                    variant="ghost"
                    icon="resource.revelation"
                    aria-label={t('character.raise-attribute', {
                      name: t(a.nameKey as LocaleKey),
                      cost,
                    })}
                    {...(reason ? { disabledReason: reason } : {})}
                    onClick={() => {
                      run({ type: 'raiseAttribute', attribute: a.id });
                    }}
                  >
                    {t('character.raise', { cost })}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="sheet-skills">
          <h3 id="sheet-skills">{t('character.skills')}</h3>
          <p className="items-hint">{t('character.skills-hint')}</p>
          <ul className="sheet-list">
            {db.all('skills').map((s) => {
              const state = g.skills[s.id] ?? { rank: 0, cap: 0, practice: 0 };
              const own = isCallingSkill(snapshot, db, s.id);
              const ready = isReadyToGrow(rules, state);
              const atMax = state.rank >= rules.skills.maxCap;
              const cost = skillCapCost(snapshot, db, rules, s.id);
              const reason =
                state.cap >= rules.skills.maxCap
                  ? t('progression.reason.cap-max')
                  : revelation < cost
                    ? t('progression.reason.revelation')
                    : undefined;
              return (
                <li key={s.id} className="sheet-row sheet-skill" data-calling={own || undefined}>
                  <IconGlyph name={`skill.${s.id}` as IconName} size={24} tone="inherit" />
                  <span className="sheet-name" title={t(s.descKey as LocaleKey)}>
                    {t(s.nameKey as LocaleKey)}
                    {own && <small className="sheet-tag">{t('character.calling-skill')}</small>}
                  </span>
                  <span className="sheet-rank">
                    {t('character.rank', { rank: state.rank, cap: state.cap })}
                  </span>
                  <span className="sheet-practice">
                    <ProgressMeter
                      label={t('character.practice', { name: t(s.nameKey as LocaleKey) })}
                      value={atMax ? 1 : state.practice}
                      max={atMax ? 1 : threshold(rules, state.rank)}
                      tone="gold"
                      {...(ready ? { valueText: t('character.ready') } : {})}
                    />
                  </span>
                  <Button
                    variant={ready ? 'primary' : 'ghost'}
                    icon="resource.revelation"
                    aria-label={t('character.raise-cap', { name: t(s.nameKey as LocaleKey), cost })}
                    {...(reason ? { disabledReason: reason } : {})}
                    onClick={() => {
                      run({ type: 'raiseSkillCap', skill: s.id });
                    }}
                  >
                    {t('character.raise-cap-short', { cost })}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="sheet-soul">
          <h3 id="sheet-soul">{t('character.soul')}</h3>
          <div className="sheet-meters">
            <ProgressMeter
              label={t('stat.faith.name')}
              value={stat('faith')}
              max={100}
              tone="faith"
              icon="resource.faith"
            />
            <ProgressMeter
              label={t('stat.corruption.name')}
              value={stat('corruption')}
              max={100}
              tone="danger"
              icon="resource.corruption"
            />
          </div>
          {virtue && (
            <p className="sheet-virtue">
              <IconGlyph name="ui.virtue" size={24} tone="inherit" />{' '}
              <strong>{t(virtue.nameKey as LocaleKey)}</strong> — {t('character.virtue-hint')}
              {g.boonReady && <em> {t('character.boon')}</em>}
            </p>
          )}
          {sin && (
            <p className="sheet-sin" data-ruling={sinRules || undefined}>
              <IconGlyph name="ui.sin" size={24} tone="inherit" />{' '}
              <strong>{t(sin.nameKey as LocaleKey)}</strong> —{' '}
              {t(sinRules ? 'character.sin-rules' : 'character.sin-hint')}
            </p>
          )}
          <p className="sheet-notice">
            <IconGlyph name="ui.demons" size={24} tone="inherit" /> {t(noticeKey(stat('notice')))}
          </p>
          <p className="sheet-debt">
            <IconGlyph name="debt.debt" size={24} tone="inherit" />{' '}
            {t('character.debt-line', {
              value: snapshot.debt.entries.reduce((sum, e) => sum + e.amount, 0),
            })}
          </p>
        </section>
      </div>
      {message && (
        <p className="items-warning" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
