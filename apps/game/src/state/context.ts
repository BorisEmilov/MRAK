import { createContext } from 'react';
import type { TypedEventBus } from '../events/EventBus';
import type { GameHost } from '../host/GameHost';
import type { Presentation } from '../onboarding/controller';
import type { AccountClient } from '@mrak/api-client';
import type { AccountSync } from '../storage/account-sync';
import type { HttpCloudSync } from '../storage/cloud-sync';
import type { UiStore } from './ui-store';

/** Online features; null when no online-api is configured (offline build). */
export interface OnlineServices {
  account: AccountClient;
  saves: HttpCloudSync;
  progress: AccountSync;
  /** Cloudflare Turnstile site key for sign-up/recovery. */
  turnstileSiteKey: string;
}

export interface AppServices {
  host: GameHost;
  bus: TypedEventBus;
  store: UiStore;
  presentation: Presentation;
  online?: OnlineServices | null;
}

export const AppContext = createContext<AppServices | null>(null);
