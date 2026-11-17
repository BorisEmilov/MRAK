import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { fixtureDb } from '../test/fixture';
import { itemCount } from './inventory';

/** At home with the camera and `plates` plates in the pack. */
function photographer(plates = 3, minute = 600): Game {
  const g = Game.newGame(
    { content: fixtureDb, seed: 8 },
    { start: { year: 1835, month: 1, day: 10 }, startMinute: minute, startZone: 'village' },
  );
  g.dispatch({
    type: 'applyEffects',
    effects: [
      { giveItem: 'camera', qty: 1 },
      ...(plates > 0 ? [{ giveItem: 'plate', qty: plates }] : []),
    ],
  });
  return g;
}
const shoot = (g: Game, subject: { villager: string } | { zone: string; poi?: string }) =>
  g.dispatch({ type: 'takePhotograph', subject });
const layersOf = (r: ReturnType<typeof shoot>) =>
  r.events.flatMap((e) => (e.type === 'photo/taken' ? e.payload.layers : []));

describe('the daguerreotype', () => {
  it('a possessed villager shows the hidden sign; an ordinary one does not', () => {
    const g = photographer();
    g.dispatch({
      type: 'applyEffects',
      effects: [{ startPossession: 'lesser-bes', host: 'velika' }],
    });
    expect(layersOf(shoot(g, { villager: 'todor' }))).toEqual([]);
    const r = shoot(g, { villager: 'velika' });
    expect(layersOf(r)).toEqual(['second-face', 'bes-mark']);
    expect(r.events).toContainEqual({
      type: 'photo/layerRevealed',
      payload: { layer: 'bes-mark' },
    });
    // The demon's layer gives its clue; the possession is still hidden from the village.
    expect(g.snapshot().mysteries['m1']?.clues).toContain('c-witness');
    expect(g.snapshot().possessions[0]?.revealed).toBe(false);
  });

  it('places show their own layers; zone layers follow their condition', () => {
    const g = photographer();
    expect(layersOf(shoot(g, { zone: 'village', poi: 'well' }))).toEqual(['well-sign']);
    expect(layersOf(shoot(g, { zone: 'village', poi: 'church' }))).toEqual([]);
    const night = photographer(2, 22 * 60);
    night.dispatch({ type: 'enterZone', zone: 'forest' });
    expect(layersOf(shoot(night, { zone: 'forest' }))).toEqual(['forest-ghosts']);
    const day = photographer();
    day.dispatch({ type: 'enterZone', zone: 'forest' });
    expect(layersOf(shoot(day, { zone: 'forest' }))).toEqual([]);
  });

  it('consumes a plate, takes time and fills the album', () => {
    const g = photographer(2);
    const minute = g.snapshot().clock.minute;
    shoot(g, { zone: 'village', poi: 'well' });
    expect(itemCount(g.snapshot(), 'plate')).toBe(1);
    expect(g.snapshot().clock.minute).toBe(minute + 10);
    expect(g.snapshot().collection.album).toEqual([
      expect.objectContaining({
        id: 1,
        zone: 'village',
        subject: { zone: 'village', poi: 'well' },
        layers: ['well-sign'],
      }),
    ]);
  });

  it('first reveals count once', () => {
    const g = photographer();
    expect(shoot(g, { zone: 'village', poi: 'well' }).events).toContainEqual({
      type: 'photo/layerRevealed',
      payload: { layer: 'well-sign' },
    });
    expect(
      shoot(g, { zone: 'village', poi: 'well' }).events.some(
        (e) => e.type === 'photo/layerRevealed',
      ),
    ).toBe(false);
    expect(g.snapshot().collection.layers).toEqual(['well-sign']);
  });

  it('is refused without camera, without plates, elsewhere, or with a full album', () => {
    const none = photographer(0);
    expect(shoot(none, { zone: 'village' })).toMatchObject({ ok: false, reason: 'no plates' });
    const g = photographer(5);
    expect(shoot(g, { zone: 'forest' })).toMatchObject({ ok: false, reason: 'not here' });
    g.dispatch({ type: 'enterZone', zone: 'forest' });
    expect(shoot(g, { villager: 'velika' })).toMatchObject({ ok: false, reason: 'not here' });
    g.dispatch({ type: 'enterZone', zone: 'village' });
    for (let i = 0; i < 3; i++) shoot(g, { zone: 'village' });
    expect(shoot(g, { zone: 'village' })).toMatchObject({ ok: false, reason: 'album full' });
    expect(g.dispatch({ type: 'discardPhoto', id: 2 }).ok).toBe(true);
    expect(shoot(g, { zone: 'village' }).ok).toBe(true);
    expect(g.snapshot().collection.album.map((p) => p.id)).toEqual([1, 3, 4]);
    const noCamera = Game.newGame({ content: fixtureDb, seed: 1 }, { startZone: 'village' });
    expect(shoot(noCamera, { zone: 'village' })).toMatchObject({ ok: false, reason: 'no camera' });
  });
});
