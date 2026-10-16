import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { buildApp } from '../server/app.js';
import { AuthService, sessionHash } from '../server/auth/service.js';
import { verifyPassword } from '../server/auth/passwords.js';
import { FakeAuthRepository } from './helpers/fake-auth-repository.js';
import { FakeLibraryRepository } from './helpers/fake-library-repository.js';
import { originalNotebook } from './helpers/notebooks.js';
import type { RecoverySessionResponse } from '../shared/types.js';

const password = 'contraseña actual ficticia';
const newPassword = '  contraseña nueva ficticia  ';
const headers = { 'x-requested-with': 'KindleHighlights' };
const payload = { currentPassword: password, newPassword };
const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0];

async function fixture(t: TestContext) {
  const repository = new FakeAuthRepository();
  const libraries = new Map<string, FakeLibraryRepository>();
  const app = await buildApp({ health: { storage: 'postgres' }, authentication: new AuthService(repository), repositoryForUser: id => {
    let library = libraries.get(id);
    if (!library) { library = new FakeLibraryRepository(); libraries.set(id, library); }
    return library;
  } });
  t.after(() => app.close());
  const register = async (username = 'Lectora') => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { username, password } });
    assert.equal(response.statusCode, 201, response.payload);
    const body = response.json<RecoverySessionResponse>();
    return { ...body, cookie: cookieOf(response), user: body.user! };
  };
  const login = (username: string, inputPassword = password) =>
    app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username, password: inputPassword } });
  const change = (cookie: string, body: unknown = payload) => app.inject({ method: 'POST', url: '/api/auth/password',
    headers: { ...headers, cookie, 'content-type': 'application/json' }, payload: JSON.stringify(body) });
  return { app, repository, register, login, change };
}

test('cambiar contraseña conserva sesión actual, vencimiento, palabras y biblioteca; revoca sólo las demás sesiones de la cuenta', async t => {
  const { app, repository, register, login, change } = await fixture(t);
  const account = await register();
  const other = await register('OtraLectora');
  const secondary = cookieOf(await login('Lectora'));
  const oldUser = { ...repository.users.get(account.user.id)! };
  const otherHash = repository.users.get(other.user.id)!.passwordHash;
  const tokenHash = sessionHash(account.cookie.split('=')[1]);
  const expiry = repository.sessions.get(tokenHash)!.expiresAt.getTime();
  await app.inject({ method: 'POST', url: '/api/imports', headers: { ...headers, cookie: account.cookie }, payload: { files: [originalNotebook] } });
  const before = (await app.inject({ url: '/api/books', headers: { cookie: account.cookie } })).json();
  const response = await change(account.cookie, { ...payload, username: other.user.username, userId: other.user.id });
  assert.equal(response.statusCode, 200, response.payload);
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), { user: { id: oldUser.id, username: oldUser.username, lastLoginAt: oldUser.lastLoginAt } });
  assert.equal(repository.sessions.get(tokenHash)!.expiresAt.getTime(), expiry);
  assert.equal(repository.users.get(account.user.id)!.recoveryPhraseHash, oldUser.recoveryPhraseHash);
  assert.equal(repository.users.get(other.user.id)!.passwordHash, otherHash);
  assert.deepEqual((await app.inject({ url: '/api/books', headers: { cookie: account.cookie } })).json(), before);
  assert.equal((await app.inject({ url: '/api/books', headers: { cookie: secondary } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/books', headers: { cookie: other.cookie } })).statusCode, 200);
  const stored = repository.users.get(account.user.id)!;
  assert.equal(await verifyPassword(newPassword, stored.passwordHash), true);
  assert.equal(await verifyPassword(newPassword.trim(), stored.passwordHash), false);
  assert.equal(await verifyPassword(account.recoveryPhrase, stored.recoveryPhraseHash), true);
  assert.equal((await login('Lectora')).statusCode, 401);
  assert.equal((await login('Lectora', newPassword)).statusCode, 200);
});

test('contraseña actual incorrecta, reutilizada o entradas inválidas no cambian hashes ni sesiones', async t => {
  const { app, repository, register, change } = await fixture(t);
  const account = await register();
  const beforeUser = { ...repository.users.get(account.user.id)! };
  const beforeSessions = [...repository.sessions];
  for (const input of [null, {}, { ...payload, currentPassword: 42 }, { ...payload, currentPassword: [] },
    { ...payload, currentPassword: '' }, { ...payload, currentPassword: 'x'.repeat(129) },
    { ...payload, newPassword: null }, { ...payload, newPassword: 'corta' }, { ...payload, newPassword: 'x'.repeat(129) },
    { ...payload, newPassword: '🙂'.repeat(11) }, { currentPassword: 'incorrecta', newPassword }, { currentPassword: password, newPassword: password }]) {
    const response = await change(account.cookie, input);
    assert.equal(response.statusCode, 400, response.payload);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.deepEqual(repository.users.get(account.user.id), beforeUser);
    assert.deepEqual([...repository.sessions], beforeSessions);
  }
  assert.equal((await app.inject({ url: '/api/books', headers: { cookie: account.cookie } })).statusCode, 200);
});

test('se necesita una sesión válida, y revocarla mientras se guarda impide el cambio', async t => {
  const { app, repository, register, change } = await fixture(t);
  const account = await register();
  const originalHash = repository.users.get(account.user.id)!.passwordHash;
  assert.equal((await change('')).statusCode, 401);
  assert.equal((await change('kh_session=inventada')).statusCode, 401);
  const original = repository.changePassword.bind(repository);
  t.mock.method(repository, 'changePassword', async (...args: Parameters<typeof original>) => {
    repository.sessions.delete(args[3]);
    return original(...args);
  });
  assert.equal((await change(account.cookie)).statusCode, 401);
  assert.equal(repository.users.get(account.user.id)!.passwordHash, originalHash);
  assert.deepEqual((await app.inject({ url: '/api/auth/session', headers: { cookie: account.cookie } })).json(), { user: null });
});

test('dos cambios simultáneos con la contraseña anterior sólo permiten un cambio', async t => {
  const { repository, register, change } = await fixture(t);
  const account = await register();
  const inputs = [{ currentPassword: password, newPassword: 'primera contraseña ficticia' }, { currentPassword: password, newPassword: 'segunda contraseña ficticia' }];
  const responses = await Promise.all(inputs.map(input => change(account.cookie, input)));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409]);
  const winner = responses.findIndex(response => response.statusCode === 200);
  assert.equal(await verifyPassword(inputs[winner].newPassword, repository.users.get(account.user.id)!.passwordHash), true);
  assert.equal(repository.sessions.size, 1);
});

test('el cambio de contraseña rechaza origen ajeno, falta de protección, cuerpos grandes y exceso de intentos', async t => {
  const { app, register } = await fixture(t);
  const account = await register();
  const url = '/api/auth/password';
  assert.equal((await app.inject({ method: 'POST', url, headers: { cookie: account.cookie }, payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers, cookie: account.cookie, origin: 'https://externo.invalid' }, payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers, cookie: account.cookie }, payload: { ...payload, newPassword: 'x'.repeat(5000) } })).statusCode, 413);
  for (let index = 0; index < 20; index++) {
    assert.equal((await app.inject({ method: 'POST', url, remoteAddress: '192.0.2.15', headers: { ...headers, cookie: account.cookie }, payload: {} })).statusCode, 400);
  }
  assert.equal((await app.inject({ method: 'POST', url, remoteAddress: '192.0.2.15', headers: { ...headers, cookie: account.cookie }, payload })).statusCode, 429);
});
