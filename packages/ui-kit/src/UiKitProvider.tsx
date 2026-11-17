import type { ReactNode } from 'react';
import { UiStringsContext, type UiStrings } from './strings';

/** Supplies the kit's generic labels (see strings.ts). */
export function UiKitProvider({ strings, children }: { strings: UiStrings; children: ReactNode }) {
  return <UiStringsContext.Provider value={strings}>{children}</UiStringsContext.Provider>;
}
