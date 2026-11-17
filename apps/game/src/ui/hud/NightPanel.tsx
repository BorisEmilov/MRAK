/**
 * The night at a glance (docs/systems/night-exploration.md → Implementation): tonight's
 * objective, and what the guardian can do against the creature that is here — fight, use a
 * ritual object, flash the lantern, dodge, or slip away.
 */
import type { LocaleKey } from '@mrak/content';
import { itemCount } from '@mrak/core';
import { Button, type IconName } from '@mrak/ui-kit';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';

const ACTIONS = [
  ['strike', 'skill.combat'],
  ['dodge', 'skill.survival'],
  ['sneak', 'skill.stealth'],
  ['flee', 'skill.survival'],
] as const;

export function NightPanel() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  if (!snapshot || snapshot.night.day === null || snapshot.night.completed) return null;
  const db = host.content;
  const night = snapshot.night;
  const here = night.encounters.filter(
    (e) => e.state === 'active' && e.zone === snapshot.currentZone,
  );
  const left = night.candidates.length - night.checked.length;
  const act = (
    encounter: number,
    action: 'flash' | 'ritual' | 'strike' | 'dodge' | 'flee' | 'sneak',
    item?: string,
  ): void => {
    host.dispatch({ type: 'nightAction', encounter, action, ...(item ? { item } : {}) });
  };
  return (
    <aside className="night-panel" aria-label={t('night.objective', { left })}>
      <p>{night.found ? t('night.objective-found') : t('night.objective', { left })}</p>
      {here.map((e) => {
        const creature = db.get('creatures', e.creature);
        const items = creature.weaknesses.flatMap((w) =>
          w.item && itemCount(snapshot, w.item, 'pack') > 0 ? [w.item] : [],
        );
        return (
          <div
            key={e.id}
            className="night-encounter"
            role="group"
            aria-label={t(creature.nameKey as LocaleKey)}
          >
            <strong>{t(creature.nameKey as LocaleKey)}</strong>
            <div className="night-actions">
              <Button
                variant="secondary"
                icon="resource.light"
                onClick={() => {
                  act(e.id, 'flash');
                }}
              >
                {t('night.action.flash')}
              </Button>
              {items.map((item) => (
                <Button
                  key={item}
                  variant="primary"
                  icon={`item.${item}` as IconName}
                  onClick={() => {
                    act(e.id, 'ritual', item);
                  }}
                >
                  {t('night.action.ritual', {
                    item: t(db.get('items', item).nameKey as LocaleKey),
                  })}
                </Button>
              ))}
              {ACTIONS.map(([action, icon]) => (
                <Button
                  key={action}
                  variant="secondary"
                  icon={icon}
                  onClick={() => {
                    act(e.id, action);
                  }}
                >
                  {t(`night.action.${action}`)}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
