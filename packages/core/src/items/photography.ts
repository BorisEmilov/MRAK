/** The daguerreotype (docs/systems/photography.md). */
import type { Condition, Effect, ItemRules, PhotoLayer } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import type { PhotoSubject, ReadonlyPhotoSubject, WorldState } from '../state/world-state';
import { itemCount, takeItem } from './inventory';
import { ItemRuleError, type ReadState } from './rules';

/** Zone a subject is in (villagers live in the village zone). */
function zoneOfSubject(subject: ReadonlyPhotoSubject, villageZone: string | null): string | null {
  return 'villager' in subject ? villageZone : subject.zone;
}

/** Does a layer show on a photo of this subject (target only; `when` is the caller's)? */
export function layerMatches(
  state: ReadState,
  layer: PhotoLayer,
  subject: ReadonlyPhotoSubject,
  zone: string,
): boolean {
  const t = layer.target;
  if ('villager' in t) {
    if (!('villager' in subject)) return false;
    if (t.villager !== '*' && t.villager !== subject.villager) return false;
    if (t.possessed === undefined) return true;
    return state.possessions.some(
      (p) => p.host === subject.villager && (t.possessed === true || p.demon === t.possessed),
    );
  }
  if ('poi' in t) return 'poi' in subject && subject.zone === t.zone && subject.poi === t.poi;
  return t.zone === zone;
}

/** Layers a photo of this subject would show now. */
export function layersFor(
  state: ReadState,
  db: ContentDatabase,
  subject: ReadonlyPhotoSubject,
  zone: string,
  evaluate: (c: Condition) => boolean,
): PhotoLayer[] {
  return db
    .all('photo-layers')
    .filter((l) => layerMatches(state, l, subject, zone) && (!l.when || evaluate(l.when)));
}

export function takePhotograph(
  draft: WorldState,
  db: ContentDatabase,
  rules: ItemRules,
  subject: PhotoSubject,
  villageZone: string | null,
  evaluate: (c: Condition) => boolean,
): { events: CoreEvent[]; effects: Effect[]; minutes: number } {
  const { camera, plate, minutes, albumSize } = rules.photography;
  if (itemCount(draft, camera, 'pack') === 0) throw new ItemRuleError('no camera');
  if (itemCount(draft, plate, 'pack') === 0) throw new ItemRuleError('no plates');
  if (draft.collection.album.length >= albumSize) throw new ItemRuleError('album full');
  const zone = zoneOfSubject(subject, villageZone);
  if (zone === null || zone !== draft.currentZone) throw new ItemRuleError('not here');
  if ('villager' in subject) {
    const v = draft.villagers[subject.villager];
    db.get('villagers', subject.villager);
    if (!v || v.status === 'dead') throw new ItemRuleError('not here');
  } else if ('poi' in subject && !db.get('zones', zone).pois.some((p) => p.id === subject.poi))
    throw new ItemRuleError('not here');

  takeItem(draft, db, plate, 1, 'pack');
  const layers = layersFor(draft, db, subject, zone, evaluate);
  const id = draft.collection.nextPhoto;
  draft.collection.nextPhoto += 1;
  draft.collection.album.push({
    id,
    day: draft.clock.day,
    minute: draft.clock.minute,
    zone,
    subject,
    layers: layers.map((l) => l.id),
  });
  const events: CoreEvent[] = [
    event('inventory/itemRemoved', { item: plate, qty: 1 }),
    event('photo/taken', { id, layers: layers.map((l) => l.id) }),
  ];
  const effects: Effect[] = [];
  for (const l of layers)
    if (!draft.collection.layers.includes(l.id)) {
      draft.collection.layers.push(l.id);
      events.push(event('photo/layerRevealed', { layer: l.id }));
      effects.push(...l.effects);
    }
  return { events, effects, minutes };
}

export function discardPhoto(draft: WorldState, id: number): CoreEvent[] {
  const index = draft.collection.album.findIndex((p) => p.id === id);
  if (index < 0) throw new ItemRuleError('no such photo');
  draft.collection.album.splice(index, 1);
  return [event('photo/discarded', { id })];
}
