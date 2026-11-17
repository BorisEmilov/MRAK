import { createApp, REQUEST_TIMEOUT_MS } from './app.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const app = createApp({ logger });

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ port: env.PORT }, 'studio-api listening');
});
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = REQUEST_TIMEOUT_MS + 1_000;

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
