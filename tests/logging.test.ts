import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp, type AppOptions } from '../server/app.js';
import type { Authentication } from '../server/auth/service.js';
import { createLogger } from '../server/logging.js';
import { RepositoryError } from '../server/errors.js';
import { PostgresRepository } from '../server/repositories/postgres-repository.js';
import { createPostgresStorage } from '../server/storage.js';
import type { DatabasePool } from '../server/db/types.js';
import type { ManagedDatabasePool } from '../server/db/driver.js';
import { FakeLibraryRepository } from './helpers/fake-library-repository.js';
import { originalNotebook } from './helpers/notebooks.js';

const user = { id: '11111111-1111-4111-8111-111111111111', username: 'private-fictional-username', lastLoginAt: null };
const token = 't'.repeat(43);
const password = 'private-fictional-password';
const phrase = 'acorn actor acute adapt admit adobe adopt afar';
const privateText = 'private-fictional-annotation';
const privateFilename = 'private-fictional-filename.html';
const privatePath = 'private-fictional-path';
const privateId = 'private-fictional-request-id';
const authentication: Authentication = {
  authenticate: async () => user,
  register: async () => ({ user, token, recoveryPhrase: phrase }),
  login: async () => ({ user, token }),
  recover: async () => ({ user, token, recoveryPhrase: phrase }),
  changePassword: async () => user,
  logout: async () => {},
};

interface LogRecord {
  event: string; level: string; time: string; reqId?: string; method?: string;
  route?: string; statusCode?: number; durationMs?: number; fileIndex?: number;
  error?: { type: string; code?: string };
}

function capture() {
  const chunks: string[] = [];
  const logger = createLogger({ write: chunk => { chunks.push(chunk); } });
  return {
    logger,
    text: () => chunks.join(''),
    records: (): LogRecord[] => chunks.join('').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as LogRecord),
  };
}

async function fixture(options: Partial<AppOptions> = {}) {
  const logs = capture();
  const repository = new FakeLibraryRepository();
  const app = await buildApp({ logger: logs.logger, authentication, health: { storage: 'postgres' }, repositoryForUser: () => repository, ...options });
  return { app, logs };
}

function assertPrivate(text: string) {
  for (const secret of [user.username, token, password, phrase, privateText, privateFilename, privatePath, privateId]) {
    assert.equal(text.includes(secret), false, `Los logs contienen un dato ficticio privado: ${secret}`);
  }
}

test('las peticiones de la aplicación registran inicio, respuesta, estado y duración con un ID propio', async t => {
  const { app, logs } = await fixture();
  t.after(() => app.close());
  const responses = await Promise.all([
    app.inject({ url: `/api/auth/session?token=${token}`, headers: { 'x-request-id': privateId } }),
    app.inject({ url: `/api/books?query=${privateText}`, headers: { cookie: `kh_session=${token}` } }),
  ]);
  const entries = logs.records();
  const started = entries.filter(entry => entry.event === 'http.request_started');
  const completed = entries.filter(entry => entry.event === 'http.request_completed');
  assert.equal(started.length, 2);
  assert.equal(completed.length, 2);
  assert.equal(new Set(started.map(entry => entry.reqId)).size, 2);
  for (const response of responses) {
    assert.equal(response.statusCode, 200);
    const reqId = response.headers['x-request-id'];
    assert.match(String(reqId), /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/);
    const beginning = started.find(entry => entry.reqId === reqId)!;
    const ending = completed.find(entry => entry.reqId === reqId)!;
    assert.ok(beginning && ending);
    assert.equal(beginning.method, 'GET');
    assert.equal(beginning.route, ending.route);
    assert.equal(ending.statusCode, response.statusCode);
    assert.ok(typeof ending.durationMs === 'number' && ending.durationMs >= 0);
    assert.ok(Number.isFinite(Date.parse(ending.time)));
  }
  assertPrivate(logs.text());
});

test('los healthchecks GET y HEAD exitosos conservan su ID sin escribir logs', async t => {
  const { app, logs } = await fixture();
  t.after(() => app.close());
  for (const method of ['GET', 'HEAD'] as const) {
    const response = await app.inject({ method, url: `/api/health?token=${token}`, headers: { 'x-request-id': privateId } });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['x-request-id']), /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/);
  }
  assert.deepEqual(logs.records(), []);
});

test('un error de health conserva el diagnóstico, la respuesta y su correlación sin datos privados', async t => {
  const { app, logs } = await fixture();
  t.after(() => app.close());
  app.addHook('preHandler', async () => { throw new Error(password); });
  const response = await app.inject('/api/health');
  assert.equal(response.statusCode, 500);
  const records = logs.records();
  assert.deepEqual(records.map(record => record.event), ['http.request_failed', 'http.request_completed']);
  assert.equal(records[0].level, 'error');
  assert.deepEqual(records[0].error, { type: 'Error' });
  assert.ok(records.every(record => record.reqId === response.headers['x-request-id']
    && record.route === '/api/health' && record.statusCode === 500));
  assertPrivate(logs.text());
});

test('una respuesta de health no exitosa también se registra sin lanzar una excepción', async t => {
  const { app, logs } = await fixture();
  t.after(() => app.close());
  app.addHook('preHandler', async (_request, reply) => reply.code(503).send({ message: 'No disponible.' }));
  const response = await app.inject('/api/health');
  assert.equal(response.statusCode, 503);
  const records = logs.records();
  assert.equal(records.length, 1);
  assert.equal(records[0].event, 'http.request_completed');
  assert.equal(records[0].statusCode, 503);
  assert.equal(records[0].reqId, response.headers['x-request-id']);
});

test('las rutas parecidas a health y los métodos distintos no se silencian', async t => {
  const { app, logs } = await fixture();
  t.after(() => app.close());
  for (const request of [
    { method: 'GET' as const, url: '/api/health-details' },
    { method: 'POST' as const, url: '/api/health', headers: { 'x-requested-with': 'KindleHighlights' } },
  ]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 404);
    const records = logs.records().filter(record => record.reqId === response.headers['x-request-id']);
    assert.deepEqual(records.map(record => record.event), ['http.request_started', 'http.request_completed']);
    assert.equal(records[1].statusCode, 404);
  }
});

test('ni los cuerpos de autenticación, cookies, cabeceras ni respuestas de recuperación entran a los logs', async t => {
  const { app, logs } = await fixture();
  t.after(() => app.close());
  const headers = {
    'x-requested-with': 'KindleHighlights', cookie: `kh_session=${token}`,
    authorization: `Bearer ${token}`, 'user-agent': privateText,
    referer: `https://example.test/${privatePath}?password=${password}`, 'x-request-id': privateId,
  };
  for (const action of ['register', 'login', 'recover']) {
    const response = await app.inject({ method: 'POST', url: `/api/auth/${action}?token=${token}`,
      headers, payload: { username: user.username, password, recoveryPhrase: phrase } });
    assert.equal(response.statusCode, action === 'register' ? 201 : 200);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/password', headers,
    payload: { currentPassword: password, newPassword: `${password}-new` } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers })).statusCode, 200);
  const imported = await app.inject({ method: 'POST', url: '/api/imports', headers,
    payload: { files: [{ filename: privateFilename, html: originalNotebook.html.replace('Primer texto de prueba.', privateText) }] } });
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.json().results[0].status, 'success');
  assert.equal(logs.records().filter(entry => entry.event === 'http.request_completed').length, 6);
  assertPrivate(logs.text());
});

test('las rutas usan plantillas y los 404 no registran la URL ni parámetros privados', async t => {
  const { app, logs } = await fixture();
  t.after(() => app.close());
  await app.inject(`/api/books/${privatePath}?password=${password}`);
  await app.inject(`/missing/${privatePath}?token=${token}`);
  const completed = logs.records().filter(entry => entry.event === 'http.request_completed');
  assert.deepEqual(completed.map(entry => entry.route), ['/api/books/:id', 'unmatched']);
  assert.deepEqual(completed.map(entry => entry.statusCode), [404, 404]);
  assertPrivate(logs.text());
});

test('los errores internos se correlacionan sin volcar mensaje, stack, SQL, causas ni propiedades adicionales', async t => {
  const failure = Object.assign(new TypeError(`SQL ficticio con ${password} y ${phrase}`), {
    code: '23505', detail: privateText, query: privateText, parameters: [password, token],
    cause: new Error(phrase), toJSON: () => ({ password, token }),
  });
  failure.stack = `${privateText}\n${password}\n${phrase}`;
  const repository = new FakeLibraryRepository();
  repository.listBooks = () => { throw failure; };
  const { app, logs } = await fixture({ repositoryForUser: () => repository });
  t.after(() => app.close());
  const response = await app.inject('/api/books');
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { message: 'No se pudo completar la solicitud.' });
  const failed = logs.records().filter(entry => entry.event === 'http.request_failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reqId, response.headers['x-request-id']);
  assert.equal(failed[0].route, '/api/books');
  assert.equal(failed[0].level, 'error');
  assert.equal(failed[0].statusCode, 500);
  assert.deepEqual(failed[0].error, { type: 'TypeError', code: '23505' });
  assertPrivate(logs.text());
});

test('los rechazos de cliente y el JSON malformado se registran sin reflejar el contenido enviado', async t => {
  const { app, logs } = await fixture({ authentication: { ...authentication, authenticate: async () => null } });
  t.after(() => app.close());
  assert.equal((await app.inject('/api/books')).statusCode, 401);
  const malformed = await app.inject({ method: 'POST', url: '/api/auth/login',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'KindleHighlights' },
    payload: `{"password":"${password}` });
  assert.equal(malformed.statusCode, 400);
  const failed = logs.records().filter(entry => entry.event === 'http.request_failed');
  assert.deepEqual(failed.map(entry => entry.statusCode), [401, 400]);
  assert.ok(failed.every(entry => entry.level === 'warn'));
  assert.equal(failed[0].error?.type, 'RepositoryError');
  assertPrivate(logs.text());
});

test('el filtro también protege mensajes libres, bindings y avisos internos del framework', () => {
  const logs = capture();
  logs.logger.error(Object.assign(new Error(password), { code: token }), phrase);
  logs.logger.warn(`${privateText} ${token} ${phrase}`);
  logs.logger.child({ reqId: privateId, password, cookie: token, recoveryPhrase: phrase })
    .info({ req: { headers: { authorization: token }, body: { password } }, res: { headers: { 'set-cookie': token } } }, privateText);
  logs.logger.error({ event: 'http.request_failed', route: `/${privatePath}`, method: password,
    password, token, recoveryPhrase: phrase, req: { body: { password } },
    err: Object.assign(new RepositoryError(password), { code: token }) }, privateText);
  assert.equal(logs.records().length, 4);
  assert.equal(logs.records().at(-1)?.route, 'unmatched');
  assert.equal(logs.records().at(-1)?.method, 'OTHER');
  assert.deepEqual(logs.records().at(-1)?.error, { type: 'RepositoryError' });
  assert.doesNotThrow(() => logs.logger.error({ get event() { throw new Error(password); } }));
  assert.doesNotThrow(() => logs.logger.child({ get reqId() { throw new Error(token); } }).warn(phrase));
  assertPrivate(logs.text());
});

test('una importación parcialmente fallida registra el error aunque la respuesta HTTP sea 200', async t => {
  const sqlFailure = Object.assign(new Error(`${password} ${phrase} ${privateText}`), { code: '42P01' });
  let releases = 0;
  const pool: DatabasePool = {
    async query() { throw new Error('No debe consultar fuera de la transacción ficticia.'); },
    async connect() {
      return { async query(sql) {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        throw sqlFailure;
      }, release() { releases++; } };
    },
  };
  const { app, logs } = await fixture({ repositoryForUser: (userId, logger) => new PostgresRepository(pool, userId, logger) });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/imports', headers: { 'x-requested-with': 'KindleHighlights' },
    payload: { files: [{ filename: privateFilename, html: `<p>${privateText}</p>` }, { ...originalNotebook, filename: privateFilename }] } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().results.map((result: { status: string }) => result.status), ['error', 'error']);
  assert.equal(releases, 1);
  const failures = logs.records().filter(entry => entry.event.startsWith('import.'));
  assert.deepEqual(failures.map(entry => entry.event), ['import.parse_failed', 'import.storage_failed']);
  assert.deepEqual(failures.map(entry => entry.fileIndex), [1, 2]);
  assert.ok(failures.every(entry => entry.reqId === response.headers['x-request-id']));
  assert.equal(failures[1].error?.code, '42P01');
  assertPrivate(logs.text());
});

test('los errores de preparación, cierre y conexiones inactivas usan diagnósticos filtrados con un pool ficticio', async () => {
  const logs = capture();
  let onIdleError: ((error: Error) => void) | undefined;
  const failure = Object.assign(new Error(`${password} ${token} ${phrase}`), { code: 'ECONNREFUSED' });
  const pool: ManagedDatabasePool = {
    async query() { throw failure; },
    async connect() { return { query: pool.query, release() {} }; },
    async end() { throw Object.assign(new Error(password), { code: 'EPIPE' }); },
    on(_event, listener) { onIdleError = listener; },
  };
  await assert.rejects(createPostgresStorage({ PGHOST: 'fictional.invalid', PGPORT: '5432', PGDATABASE: 'fictional', PGUSER: 'fictional', PGPASSWORD: password },
    { logger: logs.logger, createPool: () => pool }), /No se pudo preparar PostgreSQL/);
  assert.ok(onIdleError);
  onIdleError(Object.assign(new Error(phrase), { code: 'ECONNRESET' }));
  assert.deepEqual(logs.records().map(entry => entry.event), ['database.prepare_failed', 'database.close_failed', 'database.idle_error']);
  assert.deepEqual(logs.records().map(entry => entry.error?.code), ['ECONNREFUSED', 'EPIPE', 'ECONNRESET']);
  assertPrivate(logs.text());
});
