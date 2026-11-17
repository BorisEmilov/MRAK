/**
 * The kit has no text of its own (CLAUDE.md: no hardcoded player-facing strings). Generic labels
 * come from the app through UiKitProvider, built with `createUiStrings(lookup)` from locale keys.
 */
import { createContext, useContext } from 'react';

/** Locale keys the kit needs; the game test checks they all exist in locales/en.json. */
export const UI_STRING_KEYS = [
  'ui.close',
  'ui.undo',
  'ui.cancel',
  'ui.confirm',
  'ui.cost',
  'ui.consequence',
  'ui.consequence-unknown',
  'ui.irreversible',
  'ui.empty-slot',
  'ui.quantity',
  'ui.of-max',
  'ui.notifications',
  'ui.disabled-because',
  'ui.or',
  'ui.key.space',
  'ui.key.enter',
  'ui.key.escape',
  'ui.key.tab',
  'ui.key.shift',
  'ui.key.control',
  'ui.key.alt',
  'ui.key.backspace',
  'ui.key.arrow-up',
  'ui.key.arrow-down',
  'ui.key.arrow-left',
  'ui.key.arrow-right',
  'ui.key.mouse-left',
  'ui.key.mouse-right',
  'ui.pad.cross',
  'ui.pad.circle',
  'ui.pad.square',
  'ui.pad.triangle',
] as const;
export type UiStringKey = (typeof UI_STRING_KEYS)[number];

export interface UiStrings {
  text: (key: UiStringKey, params?: Readonly<Record<string, string | number>>) => string;
}

/** Builds the kit strings from a key lookup (e.g. the game's `t`). `{name}` placeholders. */
export function createUiStrings(lookup: (key: UiStringKey) => string): UiStrings {
  return {
    text: (key, params) => {
      const template = lookup(key);
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (m, name: string) => {
        const v = params[name];
        return v === undefined ? m : String(v);
      });
    },
  };
}

export const UiStringsContext = createContext<UiStrings | null>(null);

export function useUiStrings(): UiStrings {
  const strings = useContext(UiStringsContext);
  if (!strings) throw new Error('ui-kit components need a <UiKitProvider>');
  return strings;
}
