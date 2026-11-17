import type { IconName } from './names';
import spriteUrl from './sprite.svg?url';

/** `<use href>` of an icon in the single SVG sprite. */
export function symbolHref(name: IconName): string {
  return `${spriteUrl}#mrak-${name.replace('.', '--')}`;
}
