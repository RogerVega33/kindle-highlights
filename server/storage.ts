import type { HealthResponse } from '../shared/types.js';
import { databaseConfig } from './db/config.js';
import type { DatabaseConfig } from './db/config.js';
import { createPostgresPool } from './db/driver.js';
import type { ManagedDatabasePool } from './db/driver.js';
import type { LibraryRepository } from './repositories/library-repository.js';
import { PostgresRepository } from './repositories/postgres-repository.js';
import { PostgresAuthRepository } from './auth/postgres-repository.js';
import { AuthService } from './auth/service.js';
import { prepareSchema } from './db/schema.js';
import type { DiagnosticLogger } from './logging.js';

export interface Storage {
  repositoryForUser: (userId: string, logger?: DiagnosticLogger) => LibraryRepository;
  authentication: AuthService;
  health: HealthResponse;
  close(): Promise<void>;
}

interface StorageDependencies {
  createPool?: (config: DatabaseConfig) => ManagedDatabasePool;
  logger?: DiagnosticLogger;
}

export async function createPostgresStorage(environment: Readonly<Record<string, string | undefined>>, dependencies: StorageDependencies = {}): Promise<Storage> {
  const config = databaseConfig(environment);
  const pool = (dependencies.createPool ?? createPostgresPool)(config);
  // A disconnected idle client must not become an unhandled EventEmitter error.
  pool.on('error', error => { dependencies.logger?.error({ event: 'database.idle_error', err: error }); });
  try {
    await prepareSchema(pool);
    return {
      repositoryForUser: (userId, logger) => new PostgresRepository(pool, userId, logger ?? dependencies.logger),
      authentication: new AuthService(new PostgresAuthRepository(pool, dependencies.logger)),
      health: { storage: 'postgres' },
      close: () => pool.end(),
    };
  } catch (error) {
    dependencies.logger?.error({ event: 'database.prepare_failed', err: error });
    try { await pool.end(); }
    catch (closeError) { dependencies.logger?.error({ event: 'database.close_failed', err: closeError }); }
    throw new Error('No se pudo preparar PostgreSQL. Revisa la conexión y el esquema de la base.');
  }
}
