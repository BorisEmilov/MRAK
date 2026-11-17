/**
 * The album (docs/systems/photography.md → Presentation): each plate drawn procedurally in sepia —
 * a villager's portrait or the place's icon — with its hidden layers as faint overlays.
 */
import type { LocaleKey } from '@mrak/content';
import { itemRules, jdnToJulian, type Snapshot } from '@mrak/core';
import { ConfirmModal, IconButton, IconGlyph, type IconName } from '@mrak/ui-kit';
import { useState } from 'react';
import { formatDate, formatTime } from '../format';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { portraitUrl } from '../village/portrait';

const LAYER_ICON: Record<string, IconName> = {
  presence: 'layer.presence',
  possessed: 'layer.possessed',
  symbol: 'layer.symbol',
};

function Plate({ photo }: { photo: Snapshot['collection']['album'][number] }) {
  const { host } = useApp();
  const db = host.content;
  const subject = photo.subject;
  const layers = photo.layers.flatMap((id) => db.find('photo-layers', id) ?? []);
  let image: React.ReactNode;
  let caption: string;
  if ('villager' in subject) {
    const v = db.find('villagers', subject.villager);
    const src = v ? portraitUrl(v.id, v.look, 'living') : null;
    caption = v ? t(v.nameKey as LocaleKey) : subject.villager;
    image = src ? (
      <>
        <img className="plate-portrait" src={src} alt="" />
        {layers.some((l) => l.kind === 'possessed') && (
          <img className="plate-second-face" src={src} alt="" />
        )}
      </>
    ) : (
      <IconGlyph name="villager-state.calm" size={48} tone="inherit" />
    );
  } else {
    const zone = db.find('zones', subject.zone);
    const poi = 'poi' in subject ? zone?.pois.find((p) => p.id === subject.poi) : undefined;
    caption = poi
      ? t(poi.nameKey as LocaleKey)
      : t('items.album.place', { zone: zone ? t(zone.nameKey as LocaleKey) : subject.zone });
    image = (
      <IconGlyph name={poi ? (`poi.${poi.kind}` as IconName) : 'ui.map'} size={48} tone="inherit" />
    );
  }
  return (
    <figure className="plate">
      <div className="plate-image" aria-hidden="true">
        {image}
        {layers
          // The generic possessed layer is drawn as the second face itself.
          .filter((l) => !('villager' in l.target && l.target.possessed === true))
          .map((l) => (
            <span key={l.id} className="plate-layer" data-kind={l.kind}>
              <IconGlyph name={LAYER_ICON[l.kind] ?? 'layer.presence'} size={48} tone="inherit" />
            </span>
          ))}
      </div>
      <figcaption>
        <strong>{caption}</strong>
        <span>
          {formatDate(jdnToJulian(photo.day))}, {formatTime(photo.minute)}
        </span>
        {layers.length === 0 ? (
          <span className="plate-nothing">{t('items.album.nothing')}</span>
        ) : (
          <ul>
            {layers.map((l) => (
              <li key={l.id}>
                <IconGlyph name={LAYER_ICON[l.kind] ?? 'layer.presence'} size={16} tone="inherit" />{' '}
                <strong>{t(l.nameKey as LocaleKey)}</strong> (
                {t(`items.layer.kind.${l.kind}` as LocaleKey)}). {t(l.descKey as LocaleKey)}
              </li>
            ))}
          </ul>
        )}
      </figcaption>
    </figure>
  );
}

export function AlbumTab() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const [discard, setDiscard] = useState<number | null>(null);
  const rules = itemRules(host.content);
  if (!snapshot || !rules) return null;
  const album = [...snapshot.collection.album].reverse();
  return (
    <div className="items-tab items-album">
      <p className="items-hint">
        {t('items.album.count', { n: album.length, max: rules.photography.albumSize })}
      </p>
      {album.length === 0 ? (
        <p className="items-empty">{t('items.album.empty')}</p>
      ) : (
        <ul className="album-grid">
          {album.map((photo) => (
            <li key={photo.id}>
              <Plate photo={photo} />
              <IconButton
                icon="ui.close"
                label={t('items.album.discard')}
                variant="ghost"
                onClick={() => {
                  setDiscard(photo.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <ConfirmModal
        open={discard !== null}
        title={t('items.album.discard-title')}
        confirmLabel={t('items.album.discard')}
        onCancel={() => {
          setDiscard(null);
        }}
        onConfirm={() => {
          if (discard !== null) host.dispatch({ type: 'discardPhoto', id: discard });
          setDiscard(null);
        }}
      >
        <p>{t('items.album.discard-body')}</p>
      </ConfirmModal>
    </div>
  );
}
