/**
 * Gear with blessing slots (docs/systems/progression.md G1–G5): what is equipped in each slot, its
 * live blessings, applying a blessing (a check) and workshop upgrades.
 */
import type { LocaleKey } from '@mrak/content';
import { blessingProblem, blessingSlots, itemCount, progressionRules, slotsFor } from '@mrak/core';
import { Button, IconGlyph, type IconName } from '@mrak/ui-kit';
import { useState } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { progressionReasonKey } from './progression-ui';

const SLOTS = ['weapon', 'amulet', 'amulet-2', 'tool', 'clothing'] as const;

export function GearTab() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const [message, setMessage] = useState<string | null>(null);
  const db = host.content;
  const rules = progressionRules(db);
  if (!snapshot || !rules) return null;
  const g = snapshot.guardian;
  const name = (id: string) => t((db.find('gear', id)?.nameKey ?? id) as LocaleKey);
  const itemName = (id: string) => t((db.find('items', id)?.nameKey ?? id) as LocaleKey);
  const run = (command: Parameters<typeof host.dispatch>[0], ok: string): void => {
    const r = host.dispatch(command);
    if (!r.ok) {
      setMessage(t(progressionReasonKey(r.reason)));
      return;
    }
    const failed = r.events.some((e) => e.type === 'gear/blessingFailed');
    setMessage(failed ? t('gear.bless-failed') : ok);
  };
  const owned = [...(snapshot.light.lantern ? [snapshot.light.lantern] : []), ...g.gear];

  return (
    <div className="gear-tab">
      <p className="items-hint">{t('gear.hint')}</p>
      <section aria-labelledby="gear-slots">
        <h3 id="gear-slots">{t('gear.slots')}</h3>
        <ul className="gear-slots">
          <li className="gear-slot">
            <IconGlyph name="gear.lantern" size={32} tone="inherit" />
            <span className="gear-slot-name">{t('gear.slot.lantern')}</span>
            <strong>
              {snapshot.light.lantern ? name(snapshot.light.lantern) : t('gear.empty')}
            </strong>
          </li>
          {SLOTS.map((slot) => {
            const current = g.equipment[slot];
            const fits = g.gear.filter((id) => {
              const gear = db.find('gear', id);
              const worn = Object.values(g.equipment).includes(id);
              return gear !== undefined && slotsFor(gear).includes(slot) && !worn;
            });
            return (
              <li key={slot} className="gear-slot">
                <IconGlyph
                  name={
                    (current
                      ? (db.find('gear', current)?.icon ?? 'ui.inventory')
                      : 'ui.inventory') as IconName
                  }
                  size={32}
                  tone="inherit"
                />
                <span className="gear-slot-name">{t(`gear.slot.${slot}` as LocaleKey)}</span>
                <strong>{current ? name(current) : t('gear.empty')}</strong>
                {fits.map((id) => (
                  <Button
                    key={id}
                    variant="ghost"
                    onClick={() => {
                      run(
                        { type: 'equipGear', slot, gear: id },
                        t('gear.equipped', { name: name(id) }),
                      );
                    }}
                  >
                    {t('gear.equip', { name: name(id) })}
                  </Button>
                ))}
                {current && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      run(
                        { type: 'equipGear', slot, gear: null },
                        t('gear.unequipped', { name: name(current) }),
                      );
                    }}
                  >
                    {t('gear.unequip')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="gear-blessings">
        <h3 id="gear-blessings">{t('gear.blessings')}</h3>
        <ul className="gear-items">
          {owned.map((id) => {
            const gear = db.find('gear', id);
            if (!gear) return null;
            const live = g.blessings[id] ?? [];
            const slots = blessingSlots(snapshot, gear);
            const applicable = db.all('blessings').filter((b) => b.appliesTo.includes(gear.slot));
            const done = g.upgrades[id] ?? [];
            return (
              <li key={id} className="gear-item">
                <h4>
                  <IconGlyph
                    name={(gear.icon ?? 'ui.inventory') as IconName}
                    size={24}
                    tone="inherit"
                  />{' '}
                  {name(id)}{' '}
                  <small>{t('gear.blessing-slots', { used: live.length, max: slots })}</small>
                </h4>
                <p className="items-hint">{t(gear.descKey as LocaleKey)}</p>
                {live.length > 0 && (
                  <ul className="gear-live">
                    {live.map((b) => (
                      <li key={b.blessing}>
                        <IconGlyph name="ui.blessing" size={16} tone="inherit" />{' '}
                        {t((db.find('blessings', b.blessing)?.nameKey ?? b.blessing) as LocaleKey)}{' '}
                        —{' '}
                        {b.usesLeft !== null
                          ? t('gear.uses-left', { n: b.usesLeft })
                          : b.nightsLeft !== null
                            ? t('gear.nights-left', { n: b.nightsLeft })
                            : t('gear.permanent')}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="gear-actions">
                  {applicable.map((b) => {
                    const problem = blessingProblem(snapshot, db, rules, id, b.id);
                    const materials = b.materials
                      .map((m) => `${String(m.qty)} ${itemName(m.item)}`)
                      .join(', ');
                    return (
                      <Button
                        key={b.id}
                        variant="secondary"
                        icon="ui.blessing"
                        consequence={t(b.descKey as LocaleKey)}
                        {...(problem ? { disabledReason: t(progressionReasonKey(problem)) } : {})}
                        onClick={() => {
                          run(
                            { type: 'blessGear', gear: id, blessing: b.id },
                            t('gear.blessed', {
                              blessing: t(b.nameKey as LocaleKey),
                              gear: name(id),
                            }),
                          );
                        }}
                      >
                        {t('gear.bless', {
                          blessing: t(b.nameKey as LocaleKey),
                          materials,
                          skill: t(`skill.${b.check.skill}.name` as LocaleKey),
                        })}
                      </Button>
                    );
                  })}
                  {gear.upgrades.map((u) => {
                    const materials = u.materials
                      .map((m) => `${String(m.qty)} ${itemName(m.item)}`)
                      .join(', ');
                    return (
                      <Button
                        key={u.id}
                        variant="ghost"
                        icon="ui.upgrade"
                        {...(done.includes(u.id)
                          ? { disabledReason: t('progression.reason.done') }
                          : !u.materials.every((m) => itemCount(snapshot, m.item) >= m.qty)
                            ? { disabledReason: t('progression.reason.materials') }
                            : {})}
                        onClick={() => {
                          run(
                            { type: 'upgradeGear', gear: id, upgrade: u.id },
                            t('gear.upgraded', { name: t(u.nameKey as LocaleKey) }),
                          );
                        }}
                      >
                        {t('gear.upgrade', { name: t(u.nameKey as LocaleKey), materials })}
                      </Button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
