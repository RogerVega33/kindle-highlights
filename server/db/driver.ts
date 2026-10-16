import { createRequire } from 'node:module';
import type { DatabaseConfig } from './config.js';
import type { DatabasePool } from './types.js';

export interface ManagedDatabasePool extends DatabasePool {
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): void;
}

interface PostgresDriver {
  Pool: new (config: DatabaseConfig) => ManagedDatabasePool;
}

export function createPostgresPool(config: DatabaseConfig): ManagedDatabasePool {
  // Keep the untyped driver at this boundary; repositories depend on our small SQL contract.
  const driver = createRequire(import.meta.url)('pg') as PostgresDriver;
  return new driver.Pool(config);
}
