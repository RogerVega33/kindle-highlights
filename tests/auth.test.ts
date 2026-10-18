import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { buildApp } from '../server/app.js';
import { AuthService, sessionHash, SESSION_SECONDS } from '../server/auth/service.js';
import { hashPassword, verifyPassword } from '../server/auth/passwords.js';
import { FakeAuthRepository } from './helpers/fake-auth-repository.js';
import { FakeLibraryRepository } from './helpers/fake-library-repository.js';
import { originalNotebook } from './helpers/notebooks.js';
import type { BookDetail, ImportResponse, SessionResponse } from '../shared/types.js';

const password = 'una contraseña ficticia y larga';
const headers = { 'x-requested-with': 'KindleHighlights' };

async function fixture(t: TestContext) {
  const auth = new FakeAuthRepository();
  const libraries = new Map<string, FakeLibraryRepository>();
  const selected: string[] = [];
  const app = await buildApp({ health: { storage: 'postgres' }, authentication: new AuthService(auth), repositoryForUser: id => {
    selected.push(id);
    let repository = libraries.get(id);
    if (!repository) { repository = new FakeLibraryRepository(); libraries.set(id, repository); }
    return repository;
  } });
  t.after(async () => { await app.close(); });
  const register = async (username: string) => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { username, password } });
    assert.equal(response.statusCode, 201, response.payload);
    return { user: response.json<SessionResponse>().user!, cookie: String(response.headers['set-cookie']).split(';')[0], response };
  };
  return { app, auth, libraries, selected, register };
}

test('scrypt usa sal distinta, verifica contraseñas y no acepta hashes ausentes o incompatibles', async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$65536\$8\$2\$/);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('otra contraseña', first), false);
  assert.equal(await verifyPassword(password, null), false);
  assert.equal(await verifyPassword(password, 'formato-no-admitido'), false);
});

test('la biblioteca, importación, anotaciones y portadas exigen sesión antes de acceder al repositorio', async t => {
  const { app, selected } = await fixture(t);
  for (const entry of [
    { method: 'GET', url: '/api/books' }, { method: 'GET', url: '/api/books/otro' },
    { method: 'GET', url: '/api/books/random-annotation' },
    { method: 'POST', url: '/api/imports', payload: { files: [originalNotebook] } },
    { method: 'PATCH', url: '/api/books/otro', payload: { title: 'Nuevo', author: '' } },
    { method: 'DELETE', url: '/api/books/otro' }, { method: 'GET', url: '/api/books/otro/cover' },
    { method: 'PUT', url: '/api/books/otro/cover', payload: { dataUrl: 'ficticio' } },
    { method: 'DELETE', url: '/api/books/otro/cover' },
    { method: 'PATCH', url: '/api/books/otro/annotations/ajena', payload: { text: 'Edición' } },
    { method: 'DELETE', url: '/api/books/otro/annotations/ajena' },
    { method: 'DELETE', url: '/api/books/otro/annotations/ajena/edit' },
  ] as const) assert.equal((await app.inject({ ...entry, headers })).statusCode, 401);
  assert.equal(selected.length, 0);
  assert.deepEqual((await app.inject('/api/auth/session')).json(), { user: null });
  assert.deepEqual((await app.inject('/api/health')).json(), { storage: 'postgres' });
});

test('registrar crea sesión privada, guarda sólo su hash y cada cuenta comienza sin libros', async t => {
  const { app, auth, register } = await fixture(t);
  const account = await register('Lectora');
  assert.ok(account.user.lastLoginAt);
  assert.match(String(account.response.headers['set-cookie']), /HttpOnly; SameSite=Lax; Max-Age=604800/);
  assert.equal(account.response.headers['cache-control'], 'no-store');
  assert.equal('passwordHash' in account.user, false);
  const token = account.cookie.split('=')[1];
  assert.equal(token.length, 43);
  assert.ok(auth.sessions.has(sessionHash(token)));
  assert.ok(!auth.sessions.has(token));
  const session = await app.inject({ url: '/api/auth/session', headers: { cookie: account.cookie } });
  assert.deepEqual(session.json(), { user: account.user });
  assert.equal((await app.inject({ url: '/api/books', headers: { cookie: account.cookie } })).json().totalBooks, 0);
  assert.deepEqual((await app.inject({ url: '/api/auth/session', headers: { cookie: 'kh_session=manipulada' } })).json(), { user: null });
});

test('dos usuarios no pueden leer ni modificar libros, anotaciones o portadas del otro', async t => {
  const { app, register, selected } = await fixture(t);
  const a = await register('Lectora_A');
  const b = await register('Lector_B');
  const imported = await app.inject({ method: 'POST', url: '/api/imports', headers: { ...headers, cookie: a.cookie }, payload: { files: [originalNotebook] } });
  const id = imported.json<ImportResponse>().results[0].bookId!;
  const detail = (await app.inject({ url: '/api/books/' + id, headers: { cookie: a.cookie } })).json<BookDetail>();
  const annotation = detail.annotations[0];
  const randomA = await app.inject({ url: '/api/books/random-annotation', headers: { cookie: a.cookie } });
  const randomB = await app.inject({ url: '/api/books/random-annotation', headers: { cookie: b.cookie } });
  assert.equal(randomA.json().selection.book.id, id);
  assert.deepEqual(randomB.json(), { selection: null });
  const path = '/api/books/' + id;
  const start = selected.length;
  for (const entry of [
    { method: 'GET', url: path }, { method: 'PATCH', url: path, payload: { title: 'Ajeno', author: '' } },
    { method: 'DELETE', url: path }, { method: 'GET', url: path + '/cover' },
    { method: 'PUT', url: path + '/cover', payload: { dataUrl: 'ficticio' } }, { method: 'DELETE', url: path + '/cover' },
    { method: 'PATCH', url: path + '/annotations/' + annotation.id, payload: { text: 'Ajeno' } },
    { method: 'DELETE', url: path + '/annotations/' + annotation.id },
    { method: 'DELETE', url: path + '/annotations/' + annotation.id + '/edit' },
    { method: 'POST', url: '/api/imports', payload: { files: [originalNotebook], bookId: id, userId: a.user.id } },
  ] as const) assert.equal((await app.inject({ ...entry, headers: { ...headers, cookie: b.cookie } })).statusCode, 404);
  assert.ok(selected.slice(start).every(id => id === b.user.id));
  assert.deepEqual((await app.inject({ url: path, headers: { cookie: a.cookie } })).json(), detail);
  assert.equal((await app.inject({ url: '/api/books?userId=' + a.user.id, headers: { cookie: b.cookie } })).json().totalBooks, 0);
});

test('login fallido no cambia el último acceso; login exitoso rota sesión y logout la revoca', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T00:00:00Z') });
  const { app, auth, register } = await fixture(t);
  const account = await register('Lectora');
  t.mock.timers.tick(1000);
  const failed = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'lectora', password: 'contraseña equivocada' } });
  assert.equal(failed.statusCode, 401);
  assert.equal(failed.headers['set-cookie'], undefined);
  assert.equal(auth.users.get(account.user.id)?.lastLoginAt, account.user.lastLoginAt);
  const unknown = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'desconocido', password } });
  assert.equal(unknown.payload, failed.payload);
  const success = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...headers, cookie: account.cookie }, payload: { username: 'LECTORA', password } });
  assert.equal(success.statusCode, 200);
  assert.notEqual(success.json<SessionResponse>().user?.lastLoginAt, account.user.lastLoginAt);
  const cookie = String(success.headers['set-cookie']).split(';')[0];
  assert.notEqual(cookie, account.cookie);
  assert.equal((await app.inject({ url: '/api/books', headers: { cookie: account.cookie } })).statusCode, 401);
  const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...headers, cookie } });
  assert.equal(logout.statusCode, 200);
  assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
  assert.equal((await app.inject({ url: '/api/books', headers: { cookie } })).statusCode, 401);
  const renewed = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'Lectora', password } });
  const renewedCookie = String(renewed.headers['set-cookie']).split(';')[0];
  t.mock.timers.tick((SESSION_SECONDS + 1) * 1000);
  assert.equal((await app.inject({ url: '/api/books', headers: { cookie: renewedCookie } })).statusCode, 401);
});

test('registro valida límites y unicidad sin distinguir mayúsculas', async t => {
  const { app, register, auth } = await fixture(t);
  for (const payload of [null, {}, { username: 'ab', password }, { username: 'nombre con espacios', password },
    ...['josé', ' nombre', 'nombre ', 'nom\tbre', 'nom\nbre', 'lector🙂'].map(username => ({ username, password })),
    { username: 'Valido', password: 'corta' }, { username: 'Valido', password: 'x'.repeat(129) }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(payload) })).statusCode, 400);
  }
  await register('Lectora');
  const duplicate = await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { username: 'lectora', password } });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(auth.users.size, 1);
});

test('registro e inicio de sesión admiten únicamente @ . - _ como símbolos en el usuario', async t => {
  const { app, register } = await fixture(t);
  const username = 'Lector@33.nombre-apellido_';
  for (const [index, symbol] of [...'!"#$%&\'()*+,/:;<=>?[\\]^`{|}~'].entries()) {
    const invalid = await app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: `192.0.2.${index + 1}`, headers, payload: { username: `lector${symbol}`, password } });
    assert.equal(invalid.statusCode, 400, `No debe permitir ${symbol}`);
  }
  await register(username);
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username, password } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.username, username);
});

test('autenticación rechaza solicitudes cruzadas, falta de cabecera, cuerpos enormes y exceso de intentos', async t => {
  const { app } = await fixture(t);
  const payload = { username: 'Lectora', password };
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', headers: { ...headers, origin: 'https://otra-web.invalid' }, payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { username: 'Lectora', password: 'x'.repeat(5000) } })).statusCode, 413);
  for (let i = 0; i < 20; i++) assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'x', password: 'x' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload })).statusCode, 429);
});
