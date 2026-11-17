import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from '../../host/content';
import { t } from '../../i18n/t';
import { dawnRevelation, holdUntilDawn, makeNotice } from '../hud/notices';
import {
  defaultChoices,
  faceSymbols,
  moveInGrid,
  noticeKey,
  partDice,
  partLabel,
  progressionReasonKey,
  treeGrid,
} from './progression-ui';

const db = loadContentDatabase();

describe('progression ui helpers', () => {
  it('names every die in plain words', () => {
    expect(partLabel('attribute:wits', db, t)).toBe(t('attribute.wits.name'));
    expect(partLabel('talent:exorcist/B2', db, t)).toBe(t('talent.litany.name'));
    expect(partLabel('gear:wooden-cross', db, t)).toBe(t('gear.wooden-cross.name'));
    expect(partLabel('state:darkness', db, t)).toBe(t('check.part.darkness'));
    expect(partLabel('debt:talent:servant-of-the-horned-one/A1', db, t)).toBe(
      t('check.part.debt', { source: t('talent.crossroads-tongue.name') }),
    );
    expect(partDice({ source: 'x', fate: 2, shadow: -1 }, t)).toBe(
      `${t('check.fate-dice', { n: '+2' })}, ${t('check.shadow-dice', { n: '−1' })}`,
    );
  });

  it('die faces: Fate 4–6 succeed, 3 and 6 are suns; Shadow mirrors them', () => {
    expect([1, 2, 3, 4, 5, 6].map((f) => faceSymbols('fate', f))).toEqual([
      [],
      [],
      ['check.sun'],
      ['check.success'],
      ['check.success'],
      ['check.success', 'check.sun'],
    ]);
    expect(faceSymbols('shadow', 6)).toEqual(['check.failure', 'check.moon']);
  });

  it('arrow keys move through the tree grid', () => {
    const grid = treeGrid(db.get('trees', 'exorcist'));
    expect(grid).toMatchObject({ columns: 3, rows: 4 });
    expect(moveInGrid(grid.nodes, 'A1', 1, 0)).toBe('B1');
    expect(moveInGrid(grid.nodes, 'A1', 0, 1)).toBe('A2');
    expect(moveInGrid(grid.nodes, 'A1', -1, 0)).toBe('A1');
  });

  it('every refusal and notice level has words', () => {
    expect(progressionReasonKey('not at night')).toBe('progression.reason.night');
    expect(progressionReasonKey('something new')).toBe('progression.reason.other');
    expect([0, 10, 30, 60, 90].map(noticeKey)).toEqual([
      'character.notice.0',
      'character.notice.1',
      'character.notice.2',
      'character.notice.3',
      'character.notice.4',
    ]);
  });

  it('suggests the calling defaults', () => {
    expect(defaultChoices(db, 'znaharka')).toEqual({
      calling: 'znaharka',
      tree: 'folk-healer',
      bonus: 'wits',
      virtue: 'compassion',
      sin: 'wrath',
    });
  });

  it('Revelation won at night waits for dawn and is summed', () => {
    const r = makeNotice(
      'resource.revelation',
      'notice.revelation',
      { amount: 2, reason: 'x' },
      'good',
      0,
    );
    const other = makeNotice('debt.debt', 'notice.debt-paid', { amount: 1 }, 'good', 0);
    expect(holdUntilDawn([r, other], true)).toEqual({ show: [other], hold: [r] });
    expect(holdUntilDawn([r], false)).toEqual({ show: [r], hold: [] });
    expect(dawnRevelation([r, r], 0)[0]?.params).toEqual({ amount: 4 });
  });
});
