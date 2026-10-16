import { buildApp } from './app.js';
import { parseRuntimeOptions } from './runtime-options.js';
import { createPostgresStorage } from './storage.js';
import { createLogger } from './logging.js';

const logger = createLogger();

async function main(): Promise<void> {
  logger.info({ event: 'server.starting' });
  const { host, port, serveStatic, trustedProxies } = parseRuntimeOptions(process.argv.slice(2));
  const storage = await createPostgresStorage(process.env, { logger });
  let app: Awaited<ReturnType<typeof buildApp>>;
  try {
    app = await buildApp({ repositoryForUser: storage.repositoryForUser, authentication: storage.authentication, health: storage.health, serveStatic, trustedProxies, logger });
  } catch (error) {
    try { await storage.close(); }
    catch (closeError) { logger.error({ event: 'database.close_failed', err: closeError }); }
    throw error;
  }
  app.addHook('onClose', () => storage.close());
  try { await app.listen({ host, port }); }
  catch (error) {
    try { await app.close(); }
    catch (closeError) { logger.error({ event: 'server.shutdown_failed', err: closeError }); }
    throw error;
  }
  logger.info({ event: 'server.ready', port });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    logger.info({ event: 'server.stopping' });
    try { await app.close(); logger.info({ event: 'server.stopped' }); }
    catch (error) { logger.error({ event: 'server.shutdown_failed', err: error }); process.exitCode = 1; }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(error => {
  logger.fatal({ event: 'server.start_failed', err: error });
  process.exitCode = 1;
});
