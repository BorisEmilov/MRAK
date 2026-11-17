import type { LocaleKey } from '@mrak/content';
import type { GameHost } from '../../host/GameHost';
import { t } from '../../i18n/t';
import type { ManualSlot, SaveEntry } from '../../storage/save-store';

/** "Chronicle II", "Quick save", "Autosave · Dawn". */
export function slotLabel(entry: Pick<SaveEntry, 'slot' | 'reason'>): string {
  const base = t(`save.${entry.slot}` as LocaleKey);
  return entry.slot === 'auto' && entry.reason
    ? `${base} · ${t(`save.reason.${entry.reason}` as LocaleKey)}`
    : base;
}

/** Real-world save time in the player's locale. */
export function realTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Manual or quick save with a player-facing outcome message. */
export async function saveWithNotice(host: GameHost, slot: ManualSlot | 'quick'): Promise<string> {
  const result = await host.saveManual(slot);
  if (result.ok) return t('pause.saved', { slot: slotLabel(result.entry) });
  return result.problem === 'night' ? t('save.night-locked') : t('pause.save-failed');
}
