import { z } from 'zod';
import { defineRoute } from './defineRoute.js';

export const healthRoute = defineRoute({
  method: 'get',
  path: '/health',
  rateLimit: { windowMs: 60_000, limit: 120 },
  handler: (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'online-api' });
  },
  doc: {
    tag: 'ops',
    summary: 'Liveness check',
    responses: {
      200: {
        description: 'The service is up.',
        schema: z.object({ status: z.literal('ok'), service: z.string() }),
      },
    },
  },
});
