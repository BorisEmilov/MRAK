import { createUiStrings } from '@mrak/ui-kit';
import { t } from './t';

/** ui-kit labels (Close, Undo, key names…) from locales/en.json. */
export const uiStrings = createUiStrings((key) => t(key));
