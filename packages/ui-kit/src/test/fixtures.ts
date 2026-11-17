import type { Binding } from '../input/devices';
import { createUiStrings, type UiStringKey } from '../strings';

/** English strings for tests: the key itself, so assertions do not depend on copy. */
export const testStrings = createUiStrings((key: UiStringKey) => {
  const text: Partial<Record<UiStringKey, string>> = {
    'ui.quantity': '×{n}',
    'ui.of-max': '{value} of {max}',
    'ui.disabled-because': 'Unavailable: {reason}',
    'ui.key.space': 'Space',
  };
  return text[key] ?? key;
});

export const testBindings: Record<string, Binding> = {
  interact: { keys: ['KeyE', 'Space'], pad: 'a' },
  journal: { keys: ['KeyJ'], pad: 'view' },
};
