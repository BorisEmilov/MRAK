/**
 * Choosing a guardian (docs/systems/progression.md C1–C4): calling, the free native tree, the
 * player's attribute point, virtue and sin, with a preview of the starting attributes. Used by
 * the new-game screen and, for older saves without a guardian, in game.
 */
import type { LocaleKey } from '@mrak/content';
import {
  progressionRules,
  startingAttributes,
  type ContentDatabase,
  type GuardianChoices,
} from '@mrak/core';
import { Button, IconGlyph, type IconName } from '@mrak/ui-kit';
import { useState } from 'react';
import { t } from '../../i18n/t';
import { defaultChoices } from './progression-ui';

export interface GuardianFormProps {
  content: ContentDatabase;
  onSubmit: (choices: GuardianChoices) => void;
  onCancel?: () => void;
  busy?: boolean;
}

export function GuardianForm({ content: db, onSubmit, onCancel, busy = false }: GuardianFormProps) {
  const [choices, setChoices] = useState<GuardianChoices>(() => defaultChoices(db));
  const rules = progressionRules(db);
  const calling = db.find('callings', choices.calling);
  if (!rules || !calling) return null;
  const attributes = startingAttributes(db, rules, calling.id, choices.bonus);
  const tooHigh = Object.values(attributes).some((v) => v > rules.attributes.creationMax);
  const set = (patch: Partial<GuardianChoices>): void => {
    setChoices((c) => ({ ...c, ...patch }));
  };
  const n = (key: string) => t(key as LocaleKey);

  return (
    <form
      className="guardian-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!tooHigh) onSubmit(choices);
      }}
    >
      <fieldset className="guardian-callings">
        <legend>{t('creation.calling')}</legend>
        {db.all('callings').map((c) => (
          <label
            key={c.id}
            className="guardian-calling"
            data-selected={c.id === calling.id || undefined}
          >
            <input
              type="radio"
              name="calling"
              value={c.id}
              checked={c.id === calling.id}
              onChange={() => {
                setChoices(defaultChoices(db, c.id));
              }}
            />
            <IconGlyph name={`calling.${c.id}` as IconName} size={32} tone="inherit" />
            <strong>{n(c.nameKey)}</strong>
            <span>{n(c.descKey)}</span>
            <small>
              {t('creation.calling-skills', {
                skills: c.callingSkills.map((s) => n(`skill.${s}.name`)).join(', '),
              })}
            </small>
            <small>
              <strong>{n(c.ability.nameKey)}</strong>: {n(c.ability.descKey)}
            </small>
          </label>
        ))}
      </fieldset>

      <div className="guardian-row">
        <fieldset>
          <legend>{t('creation.tree')}</legend>
          {calling.trees.map((id) => {
            const tree = db.find('trees', id);
            return (
              <label key={id} className="guardian-option">
                <input
                  type="radio"
                  name="tree"
                  value={id}
                  checked={choices.tree === id}
                  onChange={() => {
                    set({ tree: id });
                  }}
                />
                <IconGlyph name={`tree.${id}` as IconName} size={24} tone="inherit" />
                <span>
                  <strong>{n(tree?.nameKey ?? id)}</strong> — {n(tree?.descKey ?? id)}
                </span>
              </label>
            );
          })}
          <p className="items-hint">
            {t('creation.tree-hint', { cost: rules.trees.secondNativeCost })}
          </p>
        </fieldset>

        <fieldset>
          <legend>{t('creation.bonus')}</legend>
          <label className="guardian-select">
            <span>{t('creation.bonus-hint')}</span>
            <select
              value={choices.bonus}
              onChange={(e) => {
                set({ bonus: e.target.value });
              }}
            >
              {db.all('attributes').map((a) => (
                <option key={a.id} value={a.id}>
                  {n(a.nameKey)}
                </option>
              ))}
            </select>
          </label>
          <ul className="guardian-attributes" aria-label={t('character.attributes')}>
            {db.all('attributes').map((a) => (
              <li key={a.id}>
                <IconGlyph name={`attribute.${a.id}` as IconName} size={20} tone="inherit" />{' '}
                {n(a.nameKey)} <strong>{attributes[a.id]}</strong>
              </li>
            ))}
          </ul>
          {tooHigh && (
            <p role="alert">{t('creation.too-high', { max: rules.attributes.creationMax })}</p>
          )}
        </fieldset>

        <fieldset>
          <legend>{t('creation.soul')}</legend>
          <label className="guardian-select">
            <span>
              <IconGlyph name="ui.virtue" size={20} tone="inherit" /> {t('creation.virtue')}
            </span>
            <select
              value={choices.virtue}
              onChange={(e) => {
                set({ virtue: e.target.value });
              }}
            >
              {db.all('virtues').map((v) => (
                <option key={v.id} value={v.id}>
                  {n(v.nameKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="guardian-select">
            <span>
              <IconGlyph name="ui.sin" size={20} tone="inherit" /> {t('creation.sin')}
            </span>
            <select
              value={choices.sin}
              onChange={(e) => {
                set({ sin: e.target.value });
              }}
            >
              {db.all('sins').map((s) => (
                <option key={s.id} value={s.id}>
                  {n(s.nameKey)}
                </option>
              ))}
            </select>
          </label>
          <p className="items-hint">{t('creation.soul-hint')}</p>
        </fieldset>
      </div>

      <div className="guardian-actions">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t('creation.back')}
          </Button>
        )}
        <Button
          variant="primary"
          type="submit"
          {...(tooHigh
            ? { disabledReason: t('creation.too-high', { max: rules.attributes.creationMax }) }
            : {})}
          loading={busy}
        >
          {t('creation.begin')}
        </Button>
      </div>
    </form>
  );
}
