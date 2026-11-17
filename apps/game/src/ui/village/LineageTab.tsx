/**
 * The guardian's house (docs/systems/lineage.md → Implementation): the family tree with
 * portraits, marriage, apprentices and retirement, and the Bloodline Tree bought with Legacy.
 */
import type { LocaleKey } from '@mrak/content';
import {
  ageOf,
  legacyOf,
  lineageRules,
  nodeBlocked,
  residents,
  type Person,
  type Snapshot,
} from '@mrak/core';
import { Button, IconGlyph, Tooltip } from '@mrak/ui-kit';
import { useState } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { personLook, portraitUrl } from './portrait';

function Portrait({ person }: { person: Snapshot['village']['people'][number] }) {
  const url = portraitUrl(person.id, personLook(person.look, person.sex), 'living');
  return url ? (
    <img className="lineage-portrait" src={url} alt="" width={40} height={40} />
  ) : (
    <span className="lineage-portrait" aria-hidden="true" />
  );
}

export function LineageTab({ snapshot }: { snapshot: Snapshot }) {
  const { host } = useApp();
  const profile = useUi((s) => s.profile);
  const db = host.content;
  const rules = lineageRules(db);
  const [partner, setPartner] = useState('');
  const [apprentice, setApprentice] = useState('');
  if (!rules) return <p className="village-empty">{t('lineage.none')}</p>;
  const people = snapshot.village.people;
  const nameOf = (id: string): string => {
    const p = people.find((x) => x.id === id);
    if (p) return t(p.nameKey as LocaleKey);
    const v = db.find('villagers', id);
    return v ? t(v.nameKey as LocaleKey) : id;
  };
  const me = snapshot.lineage.guardian;
  const myAge = me === null ? 0 : (ageOf(snapshot, db, me) ?? 0);
  const serving = me !== null && !snapshot.lineage.awaitingHeir;
  const married = me !== null && snapshot.village.partners[me] !== undefined;
  const singles = residents(snapshot, db).filter(
    (r) =>
      r.id !== me &&
      snapshot.village.partners[r.id] === undefined &&
      (ageOf(snapshot, db, r.id) ?? 0) >= rules.heirAge &&
      !r.parents.includes(me ?? ''),
  );
  const youths = people.filter(
    (p) =>
      p.alive &&
      !p.left &&
      p.role === 'villager' &&
      (ageOf(snapshot, db, p.id) ?? 0) >= rules.apprenticeMinAge,
  );
  const guardians = [...snapshot.lineage.past.map((p) => p.person), ...(me ? [me] : [])];

  const member = (p: Person | Snapshot['village']['people'][number]) => (
    <li key={p.id} className="lineage-member" data-alive={p.alive && !p.left}>
      <Portrait person={p} />
      <span>
        {t(p.nameKey as LocaleKey)}
        <small>
          {t(`lineage.role.${p.role}`)} · {t('lineage.born', { year: p.born })}
          {p.died !== null ? ` · ${t('lineage.died', { year: p.died })}` : ''}
        </small>
      </span>
    </li>
  );

  return (
    <div className="lineage-tab">
      <p className="build-summary">
        <IconGlyph name="ui.heir" size={16} tone="inherit" />{' '}
        {t('lineage.legacy-now', { legacy: legacyOf(snapshot, db) })}
      </p>

      <section aria-labelledby="lineage-tree-title">
        <h3 id="lineage-tree-title">{t('lineage.tree')}</h3>
        <ol className="lineage-tree">
          {guardians.map((g) => {
            const p = people.find((x) => x.id === g);
            if (!p) return null;
            const past = snapshot.lineage.past.find((x) => x.person === g);
            const spouse = people.find((x) => x.id === snapshot.village.partners[g]);
            const children = people.filter((x) => x.parents.includes(g));
            return (
              <li key={g} className="lineage-generation">
                <ul>
                  {member(p)}
                  {spouse && member(spouse)}
                </ul>
                {past && (
                  <p className="lineage-epitaph">
                    {t(`lineage.cause.${past.cause}`, { legacy: past.legacy })}
                  </p>
                )}
                {children.length > 0 && (
                  <ul className="lineage-children">{children.map(member)}</ul>
                )}
              </li>
            );
          })}
        </ol>
        {people.some((p) => p.role === 'apprentice') && (
          <>
            <h4>{t('lineage.apprentices')}</h4>
            <ul>{people.filter((p) => p.role === 'apprentice').map(member)}</ul>
          </>
        )}
      </section>

      {serving && (
        <section className="lineage-actions" aria-label={t('lineage.actions')}>
          {!married && (
            <label>
              {t('lineage.marry')}{' '}
              <select
                value={partner}
                onChange={(e) => {
                  setPartner(e.target.value);
                }}
              >
                <option value="">{t('lineage.choose')}</option>
                {singles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {nameOf(r.id)} ({ageOf(snapshot, db, r.id)})
                  </option>
                ))}
              </select>{' '}
              <Button
                {...(partner === '' ? { disabledReason: t('lineage.choose') } : {})}
                onClick={() => {
                  host.dispatch({ type: 'marry', person: partner });
                }}
              >
                {t('lineage.marry')}
              </Button>
            </label>
          )}
          <label>
            {t('lineage.apprentice')}{' '}
            <select
              value={apprentice}
              onChange={(e) => {
                setApprentice(e.target.value);
              }}
            >
              <option value="">{t('lineage.choose')}</option>
              {youths.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.nameKey as LocaleKey)} ({ageOf(snapshot, db, p.id)})
                </option>
              ))}
            </select>{' '}
            <Button
              {...(apprentice === '' ? { disabledReason: t('lineage.choose') } : {})}
              onClick={() => {
                host.dispatch({ type: 'takeApprentice', person: apprentice });
              }}
            >
              {t('lineage.take')}
            </Button>
          </label>
          <Tooltip
            title={t('lineage.retire')}
            description={t('lineage.retire-desc', { age: rules.retireAge })}
          >
            <Button
              variant="danger"
              irreversible
              {...(myAge < rules.retireAge
                ? { disabledReason: t('lineage.retire-desc', { age: rules.retireAge }) }
                : {})}
              onClick={() => {
                host.dispatch({ type: 'retire' });
              }}
            >
              {t('lineage.retire')}
            </Button>
          </Tooltip>
        </section>
      )}

      <section aria-labelledby="bloodline-title">
        <h3 id="bloodline-title">{t('bloodline.title')}</h3>
        <p className="village-hint">
          {t('bloodline.legacy', { available: profile.legacy.available })} · {t('bloodline.hint')}
        </p>
        <ul className="bloodline-nodes">
          {db.all('bloodline-nodes').map((n) => {
            const blocked = nodeBlocked(profile, db, n.id);
            return (
              <li key={n.id} className="bloodline-node" data-owned={blocked === 'owned'}>
                <strong>{t(n.nameKey as LocaleKey)}</strong>{' '}
                <small>{t('bloodline.tier', { level: n.level })}</small>
                <p>{t(n.descKey as LocaleKey)}</p>
                <Button
                  {...(blocked !== null
                    ? { disabledReason: t(`bloodline.blocked.${blocked}`, { cost: n.cost }) }
                    : {})}
                  onClick={() => {
                    host.buyBloodlineNode(n.id);
                  }}
                >
                  {t('bloodline.buy', { cost: n.cost })}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
