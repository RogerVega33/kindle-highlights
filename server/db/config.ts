export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: false;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  application_name: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`Configura ${key} en .env antes de iniciar el servidor.`);
  return value;
}

// Configuration is supplied by the entry point. No dotenv or implicit driver defaults.
export function databaseConfig(environment: Environment): DatabaseConfig {
  const host = required(environment, 'PGHOST');
  const portValue = required(environment, 'PGPORT');
  const database = required(environment, 'PGDATABASE');
  const user = required(environment, 'PGUSER');
  if (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
    throw new Error('PGPORT debe estar entre 1 y 65535.');
  }
  const password = environment.PGPASSWORD;
  if (!password) throw new Error('Configura PGPASSWORD en .env antes de iniciar el servidor.');
  return {
    host, port: Number(portValue), database, user, password,
    ssl: false, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    application_name: 'kindle-highlights',
  };
}
