import { authRoutes } from './auth.js';
import type { RouteDefinition } from './defineRoute.js';
import { healthRoute } from './health.js';
import {
  listAchievementsRoute,
  listProgressRoute,
  recordProgressRoute,
  unlockAchievementsRoute,
} from './progress.js';
import { seasonalRoute } from './seasonal.js';

/** Every route of this service. Register new routes here, never directly on the app. */
export const routes: readonly RouteDefinition[] = [
  healthRoute,
  seasonalRoute,
  unlockAchievementsRoute,
  listAchievementsRoute,
  recordProgressRoute,
  listProgressRoute,
  ...authRoutes,
];
