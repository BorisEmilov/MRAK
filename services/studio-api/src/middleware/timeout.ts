import type { RequestHandler } from 'express';

/** Responds 503 if a handler has not answered within `ms`. */
export function requestTimeout(ms: number): RequestHandler {
  return (_req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) res.status(503).json({ error: 'timeout' });
    }, ms);
    res.on('finish', () => {
      clearTimeout(timer);
    });
    res.on('close', () => {
      clearTimeout(timer);
    });
    next();
  };
}
