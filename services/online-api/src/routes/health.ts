import { z } from 'zod';
import { defineRoute } from './defineRoute.js';

export const healthRoute = defineRoute({
  method: 'get',
  path: '/health',
  rateLimit: ['public-ip'],
  handler: (req, res) => {
    const release = String(req.app.locals['release'] ?? 'dev');
    res.status(200).json({ status: 'ok', service: 'online-api', release });
  },
  doc: {
    tag: 'ops',
    summary: 'Liveness check',
    responses: {
      200: {
        description: 'The service is up.',
        schema: z.object({ status: z.literal('ok'), service: z.string(), release: z.string() }),
      },
    },
  },
});
