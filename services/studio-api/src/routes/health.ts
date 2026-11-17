import { defineRoute } from './defineRoute.js';

export const healthRoute = defineRoute({
  method: 'get',
  path: '/health',
  rateLimit: { windowMs: 60_000, limit: 120 },
  handler: (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'studio-api' });
  },
});
