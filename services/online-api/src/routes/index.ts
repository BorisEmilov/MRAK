import { authRoutes } from './auth.js';
import type { RouteDefinition } from './defineRoute.js';
import { healthRoute } from './health.js';
import {
  listAchievementsRoute,
  listProgressRoute,
  recordProgressRoute,
  unlockAchievementsRoute,
} from './progress.js';
import { newsletterRoutes } from './newsletter.js';
import { savesRoutes } from './saves.js';
import { seasonalRoute } from './seasonal.js';
import { storeRoutes } from './store.js';

/** Every route of this service. Register new routes here, never directly on the app. */
export const routes: readonly RouteDefinition[] = [
  healthRoute,
  seasonalRoute,
  unlockAchievementsRoute,
  listAchievementsRoute,
  recordProgressRoute,
  listProgressRoute,
  ...authRoutes,
  ...savesRoutes,
  ...newsletterRoutes,
  ...storeRoutes,
];
