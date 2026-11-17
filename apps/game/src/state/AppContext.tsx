import type { ReactNode } from 'react';
import { AppContext, type AppServices } from './context';

export function AppProvider({ value, children }: { value: AppServices; children: ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
