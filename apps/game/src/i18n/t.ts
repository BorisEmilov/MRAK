import { locales, type LocaleKey } from '@mrak/content';

/** Translate a localization key, interpolating `{name}` placeholders. */
export function t(key: LocaleKey, params?: Readonly<Record<string, string | number>>): string {
  const template: string = locales.en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
