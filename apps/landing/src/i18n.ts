import { locales, type LocaleKey } from '@mrak/content';

export type SiteKey = Extract<LocaleKey, `site.${string}`>;

export function t(key: LocaleKey, params?: Readonly<Record<string, string | number>>): string {
  const template: string = locales.en[key];
  return params
    ? template.replace(/\{(\w+)\}/g, (m, n: string) =>
        params[n] === undefined ? m : String(params[n]),
      )
    : template;
}

/** Only the site.* strings: what islands receive (the full table stays out of the bundle). */
export function siteStrings(): Record<string, string> {
  return Object.fromEntries(Object.entries(locales.en).filter(([k]) => k.startsWith('site.')));
}
