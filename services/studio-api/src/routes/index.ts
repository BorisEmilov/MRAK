import type { RouteDefinition } from './defineRoute.js';
import { healthRoute } from './health.js';

/** Every route of this service. Register new routes here, never directly on the app. */
export const routes: readonly RouteDefinition[] = [healthRoute];
