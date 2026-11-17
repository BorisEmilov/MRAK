import { createContext, useContext, type ReactNode } from 'react';
import type { IconName } from '../icons/names';

export const TOAST_DURATION_MS = 5000;
export const UNDO_DURATION_MS = 8000;

export interface ToastOptions {
  message: ReactNode;
  icon?: IconName;
  tone?: 'neutral' | 'good' | 'bad';
  action?: { label: string; onAction: () => void };
  durationMs?: number;
}

export interface ToastItem extends ToastOptions {
  id: number;
}

export interface ToastApi {
  show: (toast: ToastOptions) => number;
  /** Shows "<message> [Undo]" for 8 s. */
  showUndo: (message: ReactNode, onUndo: () => void) => number;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast needs a <ToastProvider>');
  return api;
}
