/** One villager in the management panel: portrait, needs in words, activity, task slots, traits. */
import type { LocaleKey } from '@mrak/content';
import type { Villager } from '@mrak/content-schema';
import type { CommandResult, VillagerView } from '@mrak/core';
import { IconGlyph, Portrait, Tooltip, type IconName, type PortraitState } from '@mrak/ui-kit';
import { useState, type DragEvent } from 'react';
import { t } from '../../i18n/t';
import { useApp } from '../../state/hooks';
import { portraitUrl } from './portrait';
import { bandOf, efficiencyKey, NEEDS, severity } from './village-ui';

export const TASK_MIME = 'application/x-mrak-task';

const REASONS: Readonly<Record<string, LocaleKey>> = {
  'too afraid for the night': 'village.reason.afraid',
  'too sick to work': 'village.reason.sick',
  dead: 'village.reason.dead',
  'requirements not met': 'village.reason.requires',
  'not a day task': 'village.reason.slot',
  'not a night task': 'village.reason.slot',
};

function statusIcon(view: VillagerView): PortraitState | null {
  if (view.status === 'returned')
    return { icon: 'villager-state.returned', label: t('village.status.returned') };
  if (!view.alive) return { icon: 'villager-state.dead', label: t('village.status.dead') };
  if (view.possessed)
    return { icon: 'villager-state.possessed', label: t('village.status.possessed') };
  if (view.status === 'sick')
    return { icon: 'villager-state.sick', label: t('village.status.sick') };
  if (view.status === 'terrified')
    return { icon: 'villager-state.afraid', label: t('village.status.terrified') };
  return { icon: 'villager-state.calm', label: t('village.status.healthy') };
}

export interface VillagerCardProps {
  def: Villager;
  view: VillagerView;
  /** Name of a POI of the village (or of "home"). */
  placeName: (poi: string | null) => string;
  dragging: string | null;
}

export function VillagerCard({ def, view, placeName, dragging }: VillagerCardProps) {
  const { host } = useApp();
  const [error, setError] = useState<{ slot: 'day' | 'night'; key: LocaleKey } | null>(null);
  const name = t(def.nameKey as LocaleKey);
  const status = statusIcon(view);
  const src = portraitUrl(def.id, def.look, view.status === 'returned' ? 'returned' : 'living');
  const tasks = host.content.all('tasks');

  const assign = (slot: 'day' | 'night', task: string | null): void => {
    const result: CommandResult = host.dispatch({
      type: 'assignTask',
      villager: def.id,
      slot,
      task,
    });
    setError(result.ok ? null : { slot, key: REASONS[result.reason] ?? 'village.reason.other' });
  };

  const activity = view.activity;
  const taskDef = activity.task ? host.content.find('tasks', activity.task) : undefined;
  const activityText = t(`village.activity.${activity.activity}` as LocaleKey, {
    place: activity.place === def.home ? t('village.place.home') : placeName(activity.place),
    task: taskDef ? t(taskDef.nameKey as LocaleKey) : '',
  });

  return (
    <article
      className="villager-card"
      data-status={view.alive ? view.status : 'dead'}
      aria-label={name}
    >
      <Portrait
        name={name}
        caption={t(def.tradeKey as LocaleKey)}
        {...(src ? { src } : {})}
        states={status ? [status] : []}
        dead={!view.alive}
        size="sm"
      />
      <div className="villager-card-body">
        <p className="villager-activity">{activityText}</p>
        {view.alive ? (
          <ul className="villager-needs" aria-label={t('village.needs')}>
            {NEEDS.map((need) => {
              const value = view[need.id];
              const word = t(bandOf(need, value));
              return (
                <li key={need.id}>
                  <Tooltip title={t(need.labelKey)} description={word}>
                    <span
                      className="villager-need mrak-focusable"
                      role="img"
                      aria-label={`${t(need.labelKey)}: ${word}`}
                      tabIndex={0}
                    >
                      <IconGlyph name={need.icon} size={16} tone="inherit" />
                      <span className="villager-need-bar" aria-hidden="true">
                        <span
                          style={{ width: `${String(Math.max(4, Math.min(100, value)))}%` }}
                          data-severity={
                            severity(need, value) >= 0.7
                              ? 'high'
                              : severity(need, value) >= 0.4
                                ? 'mid'
                                : 'low'
                          }
                        />
                      </span>
                    </span>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="villager-burial">
            {view.status === 'returned'
              ? t('village.burial.returned')
              : t(`village.burial.${view.death?.burial ?? 'pending'}` as LocaleKey)}
          </p>
        )}
        {view.alive && (
          <div className="villager-slots">
            {(['day', 'night'] as const).map((slot) => {
              const current = view.tasks[slot];
              const currentDef = current ? host.content.find('tasks', current) : undefined;
              const accepts =
                dragging !== null && host.content.find('tasks', dragging)?.slot === slot;
              const onDrop = (e: DragEvent): void => {
                e.preventDefault();
                const task = e.dataTransfer.getData(TASK_MIME);
                if (task) assign(slot, task);
              };
              const selectId = `task-${def.id}-${slot}`;
              return (
                <div
                  key={slot}
                  className="villager-slot"
                  data-accepts={accepts || undefined}
                  onDragOver={(e) => {
                    if (accepts) e.preventDefault();
                  }}
                  onDrop={onDrop}
                >
                  <label htmlFor={selectId} className="villager-slot-label">
                    <IconGlyph
                      name={slot === 'day' ? 'phase.day' : 'phase.night'}
                      size={16}
                      tone="inherit"
                    />
                    {t(`village.slot.${slot}`)}
                    {currentDef && (
                      <IconGlyph name={currentDef.icon as IconName} size={16} tone="inherit" />
                    )}
                  </label>
                  <select
                    id={selectId}
                    value={current ?? ''}
                    onChange={(e) => {
                      assign(slot, e.target.value === '' ? null : e.target.value);
                    }}
                  >
                    <option value="">{t('village.slot.none')}</option>
                    {tasks
                      .filter((task) => task.slot === slot)
                      .map((task) => (
                        <option key={task.id} value={task.id}>
                          {t('village.slot.option', {
                            task: t(task.nameKey as LocaleKey),
                            eff: t(efficiencyKey(view.efficiency[task.id] ?? 0)),
                          })}
                        </option>
                      ))}
                  </select>
                  {error?.slot === slot && (
                    <p className="villager-slot-error" role="alert">
                      {t(error.key, { name })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {def.traits.length > 0 && (
          <ul className="villager-traits" aria-label={t('village.traits')}>
            {def.traits.map((id) => {
              const trait = host.content.find('traits', id);
              if (!trait) return null;
              return (
                <li key={id}>
                  <Tooltip
                    title={t(trait.nameKey as LocaleKey)}
                    description={t(trait.descKey as LocaleKey)}
                  >
                    <span className="villager-trait mrak-focusable" tabIndex={0}>
                      {t(trait.nameKey as LocaleKey)}
                    </span>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </article>
  );
}
