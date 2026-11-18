import { pino } from 'pino';

/** pino level → Cloud Logging severity (docs/runbooks/deploy.md → Observability). */
const SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/**
 * JSON logs on stdout (collected by the platform), Cloud Logging fields (`severity`, `message`).
 * Redaction: never log tokens, cookies, passwords or Authorization headers.
 */
export function createLogger(level: string): pino.Logger {
  return pino({
    level,
    messageKey: 'message',
    formatters: { level: (label) => ({ severity: SEVERITY[label] ?? 'DEFAULT' }) },
    redact: {
      paths: [
        'password',
        'token',
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.refreshToken',
        '*.accessToken',
      ],
      censor: '[redacted]',
    },
  });
}
