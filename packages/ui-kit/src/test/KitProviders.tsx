import type { ReactNode } from 'react';
import { ToastProvider } from '../components/Toast';
import { InputProvider } from '../input/InputProvider';
import { UiKitProvider } from '../UiKitProvider';
import { testBindings, testStrings } from './fixtures';

export function KitProviders({ children }: { children: ReactNode }) {
  return (
    <UiKitProvider strings={testStrings}>
      <InputProvider bindings={testBindings}>
        <ToastProvider>{children}</ToastProvider>
      </InputProvider>
    </UiKitProvider>
  );
}
