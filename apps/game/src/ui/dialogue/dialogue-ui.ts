/** Pure helpers of the dialogue UI (docs/systems/dialogue.md → Implementation). */
import type { LocaleKey } from '@mrak/content';
import type { ContentDatabase } from '@mrak/core';

type Translate = (key: LocaleKey, params?: Readonly<Record<string, string | number>>) => string;

/** "Needs 1 Salt" / "Needs Herbalism 2" / "Needs: something you have not learned yet". */
export function requirementText(tag: string, db: ContentDatabase, t: Translate): string {
  const [, kind, id = '', n = '1'] = tag.split(':');
  const name = (key: string | undefined) => (key ? t(key as LocaleKey) : id);
  switch (kind) {
    case 'item':
      return t('dialogue.requires.item', { qty: n, item: name(db.find('items', id)?.nameKey) });
    case 'skill':
      return t('dialogue.requires.skill', { skill: name(db.find('skills', id)?.nameKey), rank: n });
    case 'stat':
      return t('dialogue.requires.stat', { stat: t(`stat.${id}.name` as LocaleKey), value: n });
    default:
      // A flag is something the guardian has not learned or done yet; never spoil which.
      return t('dialogue.requires.flag');
  }
}
