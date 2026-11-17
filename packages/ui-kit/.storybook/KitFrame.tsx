import { locales } from '@mrak/content';
import { useEffect, type ReactNode } from 'react';
import { ToastProvider } from '../src/components/Toast';
import type { Binding, PadType } from '../src/input/devices';
import { InputProvider } from '../src/input/InputProvider';
import { createUiStrings } from '../src/strings';
import { UiKitProvider } from '../src/UiKitProvider';

/** Real English copy from locales/en.json. */
const strings = createUiStrings((key) => locales.en[key]);

const bindings: Record<string, Binding> = {
  interact: { keys: ['KeyE'], pad: 'a' },
  journal: { keys: ['KeyJ'], pad: 'view' },
  back: { keys: ['Escape'], pad: 'b' },
  quickSave: { keys: ['F5'] },
};

/** Applies the toolbar globals and the kit providers around every story. */
export function KitFrame({
  globals,
  children,
}: {
  globals: Record<string, unknown>;
  children: ReactNode;
}) {
  const text = (k: string, fallback: string): string => {
    const v = globals[k];
    return typeof v === 'string' ? v : fallback;
  };
  const colorblind = text('colorblind', 'none');
  const textScale = text('textScale', '1');
  const device = text('device', 'keyboard');
  useEffect(() => {
    const root = document.documentElement;
    root.dataset['mrakColorblind'] = colorblind;
    root.style.setProperty('--mrak-text-scale', textScale);
  }, [colorblind, textScale]);
  const pad: PadType | null =
    device === 'xbox' || device === 'playstation' || device === 'nintendo' ? device : null;
  const force = pad
    ? { mode: 'gamepad' as const, padType: pad }
    : { mode: 'keyboard' as const, padType: 'generic' as const };
  return (
    <UiKitProvider strings={strings}>
      <InputProvider bindings={bindings} force={force} gamepadNavigation>
        <ToastProvider>
          <div className="mrak-root" style={{ padding: 24 }}>
            {children}
          </div>
        </ToastProvider>
      </InputProvider>
    </UiKitProvider>
  );
}
