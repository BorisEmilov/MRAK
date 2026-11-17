import type { UiStore } from '../state/ui-store';
import { saveOptions, type Options } from './options';

function localStorageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Applies and persists an options change. */
export function updateOptions(store: UiStore, patch: Partial<Options>): void {
  const next = { ...store.getState().options, ...patch };
  store.setState({ options: next });
  saveOptions(localStorageOrUndefined(), next);
}
