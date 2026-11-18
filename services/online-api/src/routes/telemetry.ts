/** Opt-in gameplay telemetry (docs/systems/telemetry.md, threat model C-26). Always 202 when valid. */
import { z } from 'zod';
import type { LimitDeps } from './defineRoute.js';
import { problem } from '../middleware/problem.js';
import {
  Envelope,
  rowsOf,
  sampled,
  TELEMETRY_BODY_LIMIT,
  TelemetryEvent,
  type TelemetryStore,
} from '../telemetry/telemetry.js';
import { defineRoute } from './defineRoute.js';

export interface TelemetryDeps {
  store: TelemetryStore;
  /** Server-side sampling, 0–1 per install. */
  sample: number;
}

type Log = { log?: { info: (o: object) => void; warn: (o: object) => void } };

export const telemetryRoute = defineRoute({
  method: 'post',
  path: '/v1/telemetry',
  rateLimit: ['telemetry-install', 'telemetry-ip'],
  bodyLimit: TELEMETRY_BODY_LIMIT,
  handler: async (req, res) => {
    const deps = req.app.locals['telemetry'] as TelemetryDeps | undefined;
    const body = Envelope.safeParse(req.body);
    if (!body.success) {
      problem(res, 400, 'bad_request');
      return;
    }
    // Kill switch, sampling and storage errors: accepted and dropped (C-26, C-39).
    const limits = req.app.locals['limits'] as LimitDeps;
    if (
      !deps ||
      !(await limits.switches.enabled('telemetry')) ||
      !sampled(body.data.install, deps.sample)
    ) {
      res.status(202).end();
      return;
    }
    const { rows, dropped } = rowsOf(body.data);
    const log = (req as unknown as Log).log;
    if (dropped > 0) log?.info({ evt: 'telemetry-dropped', dropped });
    await deps.store.add(rows).catch((err: unknown) => {
      log?.warn({ evt: 'telemetry-store-failed', err: String(err) });
    });
    res.status(202).end();
  },
  doc: {
    tag: 'telemetry',
    summary: 'Opt-in gameplay events (fixed schema, ≤ 50 per batch, no personal data)',
    body: Envelope.extend({ events: z.array(TelemetryEvent).max(50) }),
    responses: {
      202: {
        description: 'Accepted (invalid events, sampling and the kill switch drop silently).',
      },
      400: { description: 'Invalid envelope or more than 50 events.' },
      413: { description: 'Body over 8 kB.' },
      429: { description: 'Rate limited.' },
    },
  },
});
