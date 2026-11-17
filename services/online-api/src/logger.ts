import { pino } from 'pino';

/** Logger with redaction: never log tokens, cookies, passwords or Authorization headers. */
export function createLogger(level: string): pino.Logger {
  return pino({
    level,
    redact: {
      paths: [
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
