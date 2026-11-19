/**
 * Server errors to Sentry (EU region, ADR 0012). Only 5xx exceptions: no tracing, no automatic
 * integrations (no HTTP breadcrumbs), and the event is stripped of request, user and breadcrumbs
 * before it leaves (CLAUDE.md: never send tokens, emails or Authorization headers).
 */
import type { ErrorEvent } from '@sentry/node';

export function scrub(event: ErrorEvent): ErrorEvent {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  delete event.server_name;
  return event;
}

export async function sentryReporter(opts: {
  dsn: string;
  environment: string;
  release: string;
}): Promise<(err: unknown) => void> {
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    defaultIntegrations: false,
    integrations: [],
    tracesSampleRate: 0,
    beforeSend: scrub,
  });
  return (err) => {
    Sentry.captureException(err);
  };
}
