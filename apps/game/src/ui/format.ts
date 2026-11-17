import type { LocaleKey } from '@mrak/content';
import { dayPhaseAt, jdnToJulian, moonPhase } from '@mrak/core';
import { t } from '../i18n/t';

export function formatTime(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDate(date: { year: number; month: number; day: number }): string {
  return t('date.format', {
    day: date.day,
    month: t(`date.month-${String(date.month)}` as LocaleKey),
    year: date.year,
  });
}

export function formatPlaytime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  return t('time.playtime', { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 });
}

/** Phase and moon labels for the in-world day. */
export function describeDay(
  day: number,
  minute: number,
): { date: string; phase: string; moon: string } {
  const date = jdnToJulian(day);
  return {
    date: formatDate(date),
    phase: t(`phase.${dayPhaseAt(minute, date.month)}` as LocaleKey),
    moon: t(`moon.${moonPhase(day).phase}` as LocaleKey),
  };
}
