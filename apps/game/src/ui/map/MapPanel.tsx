/**
 * Player map (docs/systems/night-exploration.md → Player map): drawn from what the guardian has
 * seen — explored cells as ink on parchment, discovered places with their icon and name. It
 * never pauses the night. Opened and closed with the `map` action (M / LB).
 */
import type { LocaleKey } from '@mrak/content';
import { countRevealed, EXPLORE_CELL_TILES } from '@mrak/core';
import { Icon, IconGlyph, KeyHint, Modal, type IconName } from '@mrak/ui-kit';
import { useEffect, useMemo, useRef } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { paintMap, POI_ICONS, SCALE } from './map-paint';

export function MapPanel() {
  const { host, store } = useApp();
  const open = useUi((s) => s.mapOpen);
  const sketch = useUi((s) => s.mapSketch);
  const guardian = useUi((s) => s.mapGuardian);
  const snapshot = useUi((s) => s.snapshot);
  const canvas = useRef<HTMLCanvasElement>(null);
  const zoneState = sketch ? snapshot?.zones[sketch.zone] : undefined;
  const explored = zoneState?.explored ?? '';
  const zone = sketch ? host.content.find('zones', sketch.zone) : undefined;

  useEffect(() => {
    if (!open || !sketch || !canvas.current) return;
    const image = paintMap(sketch, explored);
    const ctx = canvas.current.getContext('2d');
    if (image && ctx) ctx.putImageData(image, 0, 0);
  }, [open, sketch, explored]);

  const places = useMemo(() => {
    if (!sketch || !zone) return [];
    const found = new Set(zoneState?.pois ?? []);
    return sketch.pois.flatMap((p) => {
      const def = zone.pois.find((d) => d.id === p.id);
      return def && found.has(p.id) ? [{ ...p, def }] : [];
    });
  }, [sketch, zone, zoneState?.pois]);

  // Markers of the current objectives of active quests in this zone (quests.md → Implementation).
  const markers = useMemo(() => {
    if (!sketch || !zone || !snapshot) return [];
    return Object.entries(snapshot.quests).flatMap(([id, q]) => {
      const def = q.status === 'active' ? host.content.find('quests', id) : undefined;
      const stage = def?.stages.find((s) => s.id === q.stage);
      return (stage?.objectives ?? []).flatMap((o) => {
        const at =
          o.marker?.zone === zone.id ? sketch.pois.find((p) => p.id === o.marker?.poi) : undefined;
        return def && at
          ? [{ key: `${id}/${o.id}`, x: at.x, y: at.y, quest: def, objective: o }]
          : [];
      });
    });
  }, [sketch, zone, snapshot, host]);

  // The build view: each building at its place, with its level or the work under way.
  const buildings = useMemo(() => {
    if (!sketch || !zone || !snapshot) return [];
    return host.content.all('buildings').flatMap((b) => {
      const at = b.poi ? sketch.pois.find((p) => p.id === b.poi) : undefined;
      const level = snapshot.village.buildings[b.id] ?? 0;
      const work = snapshot.village.projects.find((p) => p.building === b.id);
      return at && zone.pois.some((p) => p.id === b.poi)
        ? [{ b, x: at.x, y: at.y, level, work }]
        : [];
    });
  }, [sketch, zone, snapshot, host]);

  const close = (): void => {
    store.setState({ mapOpen: false });
  };
  if (!sketch || !zone) return null;
  const cells =
    Math.ceil(sketch.cols / EXPLORE_CELL_TILES) * Math.ceil(sketch.rows / EXPLORE_CELL_TILES);
  const percent = Math.min(100, Math.round((countRevealed(explored) / cells) * 100));
  const zoneName = t(zone.nameKey as LocaleKey);

  return (
    <Modal
      open={open}
      title={t('map.title', { zone: zoneName })}
      onClose={close}
      size="lg"
      variant="parchment"
      footer={
        <span className="map-footer">
          <KeyHint action="map" /> {t('map.close')}
        </span>
      }
    >
      <p className="map-description">
        {t('map.description')} · {t('map.explored', { percent: `${String(percent)} %` })}
      </p>
      <div
        className="map-sheet"
        style={{ aspectRatio: `${String(sketch.cols)} / ${String(sketch.rows)}` }}
      >
        <canvas
          ref={canvas}
          width={sketch.cols * SCALE}
          height={sketch.rows * SCALE}
          className="map-canvas"
          aria-hidden="true"
        />
        {places.map((p) => (
          <span
            key={p.id}
            className="map-poi"
            style={{
              left: `${String((p.x / sketch.cols) * 100)}%`,
              top: `${String((p.y / sketch.rows) * 100)}%`,
            }}
          >
            <Icon
              name={POI_ICONS[p.def.kind]}
              size={20}
              tone="inherit"
              label={t(p.def.nameKey as LocaleKey)}
              {...(p.def.descKey ? { description: t(p.def.descKey as LocaleKey) } : {})}
            />
          </span>
        ))}
        {buildings.map(({ b, x, y, level, work }) => (
          <span
            key={`building-${b.id}`}
            className="map-building"
            data-built={level > 0}
            data-work={work !== undefined}
            style={{
              left: `${String((x / sketch.cols) * 100)}%`,
              top: `${String((y / sketch.rows) * 100)}%`,
            }}
          >
            <Icon
              name={(b.icon ?? 'faction.village') as IconName}
              size={20}
              tone="inherit"
              label={t('map.building', {
                building: t(b.nameKey as LocaleKey),
                level,
                max: b.levels.length,
              })}
              description={
                work
                  ? t('build.in-progress', {
                      building: t(b.nameKey as LocaleKey),
                      level: work.level,
                      done: Math.floor(work.labour),
                      needed: work.needed,
                    })
                  : t(b.descKey as LocaleKey)
              }
            />
          </span>
        ))}
        {markers.map((m) => (
          <span
            key={m.key}
            className="map-quest"
            style={{
              left: `${String((m.x / sketch.cols) * 100)}%`,
              top: `${String((m.y / sketch.rows) * 100)}%`,
            }}
          >
            <Icon
              name={(m.quest.icon ?? 'ui.quest') as IconName}
              size={20}
              tone="inherit"
              label={t('map.quest', { quest: t(m.quest.nameKey as LocaleKey) })}
              description={t(m.objective.descKey as LocaleKey)}
            />
          </span>
        ))}
        {guardian && (
          <span
            className="map-you"
            style={{
              left: `${String((guardian.x / sketch.cols) * 100)}%`,
              top: `${String((guardian.y / sketch.rows) * 100)}%`,
            }}
          >
            <Icon name="poi.you" size={24} tone="inherit" label={t('map.you')} />
          </span>
        )}
      </div>
      <h3 className="map-places-title">{t('map.places')}</h3>
      {places.length === 0 ? (
        <p>{t('map.none')}</p>
      ) : (
        <ul className="map-places">
          {places.map((p) => (
            <li key={p.id}>
              <IconGlyph name={POI_ICONS[p.def.kind]} size={20} tone="inherit" />
              <span>{t(p.def.nameKey as LocaleKey)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
