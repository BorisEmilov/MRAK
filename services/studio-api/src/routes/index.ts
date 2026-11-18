import type { RouteDefinition } from './defineRoute.js';
import { healthRoute } from './health.js';
import { contentRoutes } from './content.js';
import { salesRoutes } from './sales.js';

/** Every route of this service. Register new routes here, never directly on the app. */
export const routes: readonly RouteDefinition[] = [healthRoute, ...salesRoutes, ...contentRoutes];
