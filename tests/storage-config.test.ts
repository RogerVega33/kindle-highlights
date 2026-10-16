import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTestApp as buildApp } from './helpers/app.js';
import { databaseConfig, type DatabaseConfig } from '../server/db/config.js';
import type { ManagedDatabasePool } from '../server/db/driver.js';
import type { DatabaseResult } from '../server/db/types.js';
import { FakeLibraryRepository } from './helpers/fake-library-repository.js';
import { PostgresRepository } from '../server/repositories/postgres-repository.js';
import { parseRuntimeOptions } from '../server/runtime-options.js';
import { createPostgresStorage } from '../server/storage.js';
import type { HealthResponse } from '../shared/types.js';
import { BOOKS_PER_PAGE } from '../shared/limits.js';

const emptyLibrary = { books: [], page: 1, pageSize: BOOKS_PER_PAGE, totalBooks: 0, totalAnnotations: 0, matchingBooks: 0, totalPages: 1 };

// All configuration and SQL results below are fictitious. No process environment,
// password file, PostgreSQL driver constructor or network connection is used.
const environment = Object.freeze({
  PGHOST: 'postgres-fictional.invalid',
  PGPORT: '5432',
  PGDATABASE: 'fictional_library',
  PGUSER: 'fictional_user',
  PGPASSWORD: '  fictional password with spaces  ',
});

type Query = { text: string; values: unknown[] | undefined };

function fakePool(failure?: Error) {
  const queries: Query[] = [];
  const events: string[] = [];
  let closes = 0;
  const pool: ManagedDatabasePool = {
    async query<Row extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<DatabaseResult<Row>> {
      queries.push({ text, values });
      if (failure) throw failure;
      const rows = /FROM pg_catalog.pg_class/.test(text)
        ? ['users', 'sessions', 'books', 'annotations', 'book_covers'].map(object_name => ({ schema_name: 'public', object_name })) : [];
      return { rows: rows as unknown as Row[], rowCount: rows.length };
    },
    async connect() { return { query: pool.query.bind(pool), release() {} }; },
    async end() { closes += 1; },
    on(event, _listener) { events.push(event); },
  };
  return { pool, queries, events, closes: () => closes };
}

test('runtime configura el servidor sin seleccionar almacenamiento', () => {
  assert.deepEqual(parseRuntimeOptions([]), { host: '127.0.0.1', port: 3001, serveStatic: false });
  assert.deepEqual(parseRuntimeOptions(['--host', '0.0.0.0', '--port', '4100', '--production']), {
    host: '0.0.0.0', port: 4100, serveStatic: true,
  });
});

test('runtime rechaza la antigua selección de almacenamiento y los argumentos inválidos', () => {
  for (const args of [
    ['--unknown'], ['--storage'], ['--storage', 'memory'], ['--storage', 'postgres'],
    ['--host'], ['--host', '--production'], ['--port'], ['--port', '0'],
    ['--port', '65536'], ['--port', '4.5'], ['--port', '1e3'], ['--port', '-1'],
  ]) assert.throws(() => parseRuntimeOptions(args), Error, args.join(' '));
  assert.equal(parseRuntimeOptions(['--port', '1']).port, 1);
  assert.equal(parseRuntimeOptions(['--port', '65535']).port, 65535);
});

test('configuración PostgreSQL requiere explícitamente host, puerto, base, usuario y contraseña', () => {
  for (const key of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    const incomplete: Record<string, string | undefined> = { ...environment, [key]: undefined };
    assert.throws(() => databaseConfig(incomplete), new RegExp(key));
  }
  assert.throws(() => databaseConfig({}), /PGHOST/);
  const config = databaseConfig(environment);
  assert.deepEqual(config, {
    host: environment.PGHOST, port: 5432, database: environment.PGDATABASE, user: environment.PGUSER,
    password: environment.PGPASSWORD, ssl: false, max: 5, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, application_name: 'kindle-highlights',
  });
});

test('configuración rechaza puertos inválidos, usuario vacío y contraseña ausente o vacía', () => {
  for (const PGPORT of ['0', '65536', '5.5', '-1', '1e3', 'invalid']) {
    assert.throws(() => databaseConfig({ ...environment, PGPORT }), /PGPORT/);
  }
  for (const value of ['', '   ']) assert.throws(() => databaseConfig({ ...environment, PGUSER: value }), /PGUSER/);
  for (const value of [undefined, '']) assert.throws(() => databaseConfig({ ...environment, PGPASSWORD: value }), /PGPASSWORD en .env/);
});

test('la contraseña de PGPASSWORD se conserva literalmente, incluidos espacios y caracteres especiales', () => {
  assert.equal(databaseConfig(environment).password, environment.PGPASSWORD);
  const password = '  fictional-$-"-password  ';
  assert.equal(databaseConfig({ ...environment, PGPASSWORD: password }).password, password);
});

test('arranque PostgreSQL comprueba el esquema sin depender de una cuenta y permite cerrar el pool', async () => {
  const fake = fakePool();
  const configs: DatabaseConfig[] = [];
  const storage = await createPostgresStorage(environment, { createPool(config) {
    configs.push(config);
    return fake.pool;
  } });
  assert.ok(storage.repositoryForUser('11111111-1111-4111-8111-111111111111') instanceof PostgresRepository);
  assert.equal(configs.length, 1);
  assert.equal(configs[0].host, environment.PGHOST);
  assert.deepEqual(storage.health, { storage: 'postgres' });
  assert.equal(fake.queries[0].text, 'BEGIN');
  assert.equal(fake.queries.at(-1)?.text, 'COMMIT');
  assert.ok(fake.queries.some(({ text }) => /recovery_phrase_hash[\s\S]*FROM public.users LIMIT 0/.test(text)));
  assert.ok(fake.queries.some(({ text }) => /FROM public.book_covers LIMIT 0/.test(text)));
  assert.ok(fake.queries.every(({ text }) => !/^\s*(INSERT|UPDATE|CREATE|ALTER)\b/i.test(text)));
  assert.deepEqual(fake.events, ['error']);
  assert.equal(fake.closes(), 0);
  await storage.close();
  assert.equal(fake.closes(), 1);
});

test('arranque PostgreSQL se detiene y libera el pool si falta el esquema de autenticación', async () => {
  const fake = fakePool(new Error('relation sessions does not exist: fictional connection details'));
  await assert.rejects(createPostgresStorage(environment, { createPool: () => fake.pool }), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /^No se pudo preparar PostgreSQL\./);
    assert.ok(!error.message.includes('fictional connection details'));
    return true;
  });
  assert.equal(fake.closes(), 1);
  assert.equal(fake.queries.at(-1)?.text, 'ROLLBACK');
});

test('configuración incompleta detiene arranque antes de construir pool', async () => {
  let constructions = 0;
  await assert.rejects(createPostgresStorage({}, { createPool() {
    constructions += 1;
    throw new Error('No debería alcanzarse.');
  } }), /PGHOST/);
  assert.equal(constructions, 0);
});

test('health informa PostgreSQL sin publicar datos de una cuenta', async () => {
  const health: HealthResponse = { storage: 'postgres' };
  const app = await buildApp({ repository: new FakeLibraryRepository(), health });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), health);
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/books' })).json(), emptyLibrary);
  } finally {
    await app.close();
  }
});
