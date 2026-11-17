import { createContext } from 'react';
import type { TypedEventBus } from '../events/EventBus';
import type { GameHost } from '../host/GameHost';
import type { Presentation } from '../onboarding/controller';
import type { UiStore } from './ui-store';

export interface AppServices {
  host: GameHost;
  bus: TypedEventBus;
  store: UiStore;
  presentation: Presentation;
}

export const AppContext = createContext<AppServices | null>(null);
