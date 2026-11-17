import { useContext } from 'react';
import { useStore } from 'zustand';
import { AppContext, type AppServices } from './context';
import type { UiState } from './ui-store';

export function useApp(): AppServices {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp() outside <AppProvider>');
  return value;
}

/** Subscribes a component to a slice of the UI store. */
export function useUi<T>(selector: (state: UiState) => T): T {
  return useStore(useApp().store, selector);
}
