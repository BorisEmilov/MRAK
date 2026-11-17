/**
 * In-game HUD (docs/ui/hud.md): resources with icons, time and phase, village notices and the
 * interaction prompt. Fades to 35 % when nothing needs attention.
 */
import type { LocaleKey } from '@mrak/content';
import { dayPhaseAt, jdnToJulian } from '@mrak/core';
import {
  Icon,
  IconButton,
  IconGlyph,
  KeyHint,
  ProgressMeter,
  ResourceCounter,
  type IconName,
} from '@mrak/ui-kit';
import { useEffect, useState } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { describeDay, formatTime } from '../format';
import { hudResources, LOW_SANITY } from './resources';
import { useHudFade } from './useHudFade';

const SANITY_BANDS = [
  { upTo: 0.2, label: t('sanity.band-breaking') },
  { upTo: 0.4, label: t('sanity.band-shaken') },
  { upTo: 0.7, label: t('sanity.band-uneasy') },
  { upTo: 1, label: t('sanity.band-steady') },
];

/** Re-renders while notices are visible so expired ones disappear. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [active]);
  return now;
}

export function Hud() {
  const { host, store } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const zoneLoading = useUi((s) => s.zoneLoading);
  const notices = useUi((s) => s.notices);
  const interaction = useUi((s) => s.interaction);
  const autoFade = useUi((s) => s.options.hudAutoFade);
  const hudWake = useUi((s) => s.hudWake);
  const now = useNow(notices.length > 0);

  const r = snapshot ? hudResources(snapshot, host.content) : null;
  const phase = snapshot
    ? dayPhaseAt(snapshot.clock.minute, jdnToJulian(snapshot.clock.day).month)
    : 'day';
  const lowSanity = r !== null && r.sanityMax > 0 && r.sanity / r.sanityMax < LOW_SANITY;
  const visibleNotices = notices.filter((n) => n.expiresAt > now);
  const lantern = snapshot?.light;
  const lanternLabel = !lantern?.lantern
    ? t('hud.lantern.none')
    : lantern.lit
      ? t('hud.lantern.lit')
      : t('hud.lantern.unlit');
  const key = r
    ? `${lanternLabel}|${String(r.light)}|${String(r.food)}|${String(r.faith)}|${String(r.corruption)}|${String(r.sanity)}|${phase}|${String(visibleNotices.length)}|${String(hudWake)}`
    : '';
  const { faded, wake } = useHudFade(
    key,
    !autoFade || lowSanity || phase === 'night' || interaction !== null,
  );

  if (!snapshot || !r) return null;
  const { clock, calendar, currentZone } = snapshot;
  const day = describeDay(clock.day, clock.minute);
  const chapter = calendar.chapterId
    ? host.content.find('festivals', calendar.chapterId)
    : undefined;
  const zone = currentZone ? host.content.find('zones', currentZone) : undefined;

  return (
    <div className="hud" data-faded={faded || undefined} onPointerEnter={wake} onFocus={wake}>
      <section className="hud-resources" aria-label={t('hud.resources')}>
        <ResourceCounter
          icon="resource.light"
          label={t('resource.light.name')}
          description={t('resource.light.desc')}
          value={r.light}
          low={r.light === 0}
          lowLabel={t('resource.low')}
        />
        <div className="hud-lantern" data-lit={lantern?.lit === true || undefined}>
          <Icon
            name="resource.light"
            size={20}
            tone={lantern?.lit ? 'auto' : 'muted'}
            label={lanternLabel}
            description={t('hud.lantern.desc')}
          />
          <span>{lanternLabel}</span>
          {lantern?.lantern && <KeyHint action="lantern" />}
        </div>
        <ResourceCounter
          icon="resource.food"
          label={t('resource.food.name')}
          description={t('resource.food.desc')}
          value={r.food}
          low={r.food === 0}
          lowLabel={t('resource.low')}
        />
        <ResourceCounter
          icon="resource.faith"
          label={t('resource.faith.name')}
          description={t('resource.faith.desc')}
          value={r.faith}
        />
        <ResourceCounter
          icon="resource.corruption"
          label={t('resource.corruption.name')}
          description={t('resource.corruption.desc')}
          value={r.corruption}
        />
        <ProgressMeter
          label={t('resource.sanity.name')}
          description={t('resource.sanity.desc')}
          icon="resource.sanity"
          tone={lowSanity ? 'danger' : 'gold'}
          value={r.sanity}
          max={r.sanityMax}
          qualitative={SANITY_BANDS}
        />
      </section>

      <section className="hud-time" aria-label={t('hud.label')}>
        <div className="hud-clock">
          <Icon
            name={`phase.${phase}` as IconName}
            label={day.phase}
            description={t('hud.phase-desc')}
            size={32}
          />
          <span className="hud-clock-time">{formatTime(clock.minute)}</span>
        </div>
        <div>{day.date}</div>
        <div className="hud-moon">
          <Icon name="phase.moon" label={t('hud.moon')} description={day.moon} size={20} />
          <span>{day.moon}</span>
        </div>
        {chapter && (
          <div className="hud-chapter">
            {t(chapter.nameKey as LocaleKey)}
            {calendar.nightIndex > 0 &&
              ` · ${t('hud.night', { night: calendar.nightIndex, total: chapter.nights })}`}
          </div>
        )}
        {zone && <div className="hud-zone">{t(zone.nameKey as LocaleKey)}</div>}
      </section>

      {visibleNotices.length > 0 && (
        <ul className="hud-notices" aria-label={t('hud.notices')} aria-live="polite">
          {[...visibleNotices].reverse().map((n) => (
            <li key={n.id} className="hud-notice" data-tone={n.tone}>
              <IconGlyph
                name={n.icon}
                size={20}
                tone={n.tone === 'bad' ? 'bad' : n.tone === 'good' ? 'good' : 'auto'}
              />
              <span>{t(n.key, n.params)}</span>
            </li>
          ))}
        </ul>
      )}

      {interaction && (
        <div className="hud-interaction" role="status">
          <IconGlyph
            name={
              interaction.action === 'house'
                ? 'ui.storage'
                : (`action.${interaction.action}` as IconName)
            }
            size={24}
          />
          <span>
            {t(`interaction.${interaction.action}`, {
              target: t(interaction.targetKey as LocaleKey),
            })}
          </span>
          <KeyHint action="interact" />
        </div>
      )}

      {zoneLoading && (
        <div className="hud-loading" role="status">
          {t('hud.zone-loading')}
        </div>
      )}

      <div className="hud-corner">
        <IconButton
          icon="faction.village"
          label={t('village.title')}
          description={t('village.open-hint')}
          variant="secondary"
          onClick={() => {
            store.setState({ villageOpen: true });
          }}
        />
        <IconButton
          icon="ui.character"
          label={t('character.title')}
          description={t('character.open-hint')}
          variant="secondary"
          onClick={() => {
            store.setState({ character: 'sheet' });
          }}
        />
        <IconButton
          icon="ui.journal"
          label={t('journal.title')}
          description={t('journal.open-hint')}
          variant="secondary"
          onClick={() => {
            store.setState({ journal: 'clues' });
          }}
        />
        <IconButton
          icon="ui.inventory"
          label={t('items.title')}
          description={t('items.open-hint')}
          variant="secondary"
          onClick={() => {
            store.setState({ belongings: 'pack' });
          }}
        />
        <IconButton
          icon="ui.glossary"
          label={t('glossary.title')}
          description={t('glossary.open-hint')}
          variant="secondary"
          onClick={() => {
            store.setState({ glossary: { open: true } });
          }}
        />
      </div>
    </div>
  );
}
