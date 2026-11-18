/** In-game "Report a bug" (docs/systems/testing.md → Bug reports). */
import { z } from 'zod';
import { problem } from '../middleware/problem.js';
import { BUG_BODY_LIMIT, BugReportBody, type BugStore } from '../bugs/bugs.js';
import { defineRoute } from './defineRoute.js';

export const bugReportRoute = defineRoute({
  method: 'post',
  path: '/v1/bug-reports',
  rateLimit: ['bug-report-ip'],
  bodyLimit: BUG_BODY_LIMIT,
  handler: async (req, res) => {
    const store = req.app.locals['bugs'] as BugStore | undefined;
    const body = BugReportBody.safeParse(req.body);
    if (!store) {
      problem(res, 503, 'unavailable');
      return;
    }
    if (!body.success || (body.data.seed !== undefined) !== (body.data.save !== undefined)) {
      problem(res, 400, 'bad_request');
      return;
    }
    const id = await store.add(body.data);
    res.status(201).json({ id });
  },
  doc: {
    tag: 'bugs',
    summary: 'Report a bug from the game (save and seed only with the player’s consent)',
    body: BugReportBody,
    responses: {
      201: { description: 'Stored.', schema: z.object({ id: z.uuid() }) },
      400: { description: 'Invalid body.' },
      413: { description: 'Body over 1 MB.' },
      429: { description: 'Rate limited.' },
    },
  },
});
