import en from '../locales/en.json' with { type: 'json' };

/** English locale table. All player-facing text comes from here. */
export const locales = { en } as const;
export type LocaleKey = keyof typeof en;
