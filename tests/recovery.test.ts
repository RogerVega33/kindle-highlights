import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { buildApp } from '../server/app.js';
import { AuthService } from '../server/auth/service.js';
import { verifyPassword } from '../server/auth/passwords.js';
import { generateRecoveryPhrase, normalizeRecoveryPhrase } from '../server/auth/recovery-phrase.js';
import { FakeAuthRepository } from './helpers/fake-auth-repository.js';
import { FakeLibraryRepository } from './helpers/fake-library-repository.js';
import { originalNotebook } from './helpers/notebooks.js';
import type { RecoverySessionResponse } from '../shared/types.js';

const password = 'contraseña ficticia de prueba';
const nextPassword = 'una contraseña nueva ficticia';
const headers = { 'x-requested-with': 'KindleHighlights' };
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
    return { response, cookie: cookieOf(response), ...response.json<RecoverySessionResponse>() };
  };
  const recover = (username: string, recoveryPhrase: unknown, newPassword = nextPassword) =>
    app.inject({ method: 'POST', url: '/api/auth/recover', headers, payload: { username, recoveryPhrase, password: newPassword } });
  return { app, repository, register, recover };
}

test('las frases tienen ocho palabras y normalizan separadores y mayúsculas sin aceptar cuerpos arbitrarios', () => {
  const phrase = generateRecoveryPhrase();
  assert.match(phrase, /^[a-z]{3,5}( [a-z]{3,5}){7}$/);
  assert.equal(normalizeRecoveryPhrase(` \t${phrase.toUpperCase().replaceAll(' ', ' - ')}\n`), phrase);
  for (const value of [null, {}, [], 12, '', 'word '.repeat(7), 'word '.repeat(9), 'a'.repeat(257), 'one two 3 four five six seven eight']) {
    assert.equal(normalizeRecoveryPhrase(value), null);
  }
});

test('el registro entrega las palabras una vez y conserva sólo su hash fuera de las respuestas públicas', async t => {
  const { app, repository, register } = await fixture(t);
  const account = await register();
  assert.ok(account.user);
  const stored = repository.users.get(account.user.id)!;
  assert.notEqual(stored.recoveryPhraseHash, account.recoveryPhrase);
  assert.equal(await verifyPassword(account.recoveryPhrase, stored.recoveryPhraseHash), true);
  assert.equal('recoveryPhraseHash' in account.user, false);
  assert.equal('passwordHash' in account.user, false);
  for (const response of [
    await app.inject({ url: '/api/auth/session', headers: { cookie: account.cookie } }),
    await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'LECTORA', password } }),
  ]) {
    assert.equal(response.statusCode, 200);
    assert.equal('recoveryPhrase' in response.json(), false);
    assert.ok(!response.payload.includes(stored.recoveryPhraseHash!));
    assert.ok(!response.payload.includes(account.recoveryPhrase));
  }
});

test('recuperar cambia contraseña y palabras, revoca todas las sesiones de esa cuenta y conserva su biblioteca', async t => {
  const { app, repository, register, recover } = await fixture(t);
  const account = await register();
  const other = await register('OtraLectora');
  const secondLogin = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'Lectora', password } });
  const secondCookie = cookieOf(secondLogin);
  await app.inject({ method: 'POST', url: '/api/imports', headers: { ...headers, cookie: account.cookie }, payload: { files: [originalNotebook] } });
  const before = (await app.inject({ url: '/api/books', headers: { cookie: account.cookie } })).json();
  const phrase = account.recoveryPhrase.toUpperCase().replaceAll(' ', ' - ');
  const recovered = await recover('LECTORA', `  ${phrase}\t`);
  assert.equal(recovered.statusCode, 200, recovered.payload);
  const body = recovered.json<RecoverySessionResponse>();
  assert.equal(body.user?.id, account.user?.id);
  assert.notEqual(body.recoveryPhrase, account.recoveryPhrase);
  assert.match(String(recovered.headers['set-cookie']), /HttpOnly; SameSite=Lax/);
  assert.equal(recovered.headers['cache-control'], 'no-store');
  assert.deepEqual((await app.inject({ url: '/api/books', headers: { cookie: cookieOf(recovered) } })).json(), before);
  for (const cookie of [account.cookie, secondCookie]) {
    assert.equal((await app.inject({ url: '/api/books', headers: { cookie } })).statusCode, 401);
  }
  assert.equal((await app.inject({ url: '/api/books', headers: { cookie: other.cookie } })).statusCode, 200);
  assert.equal(await verifyPassword(nextPassword, repository.users.get(account.user!.id)!.passwordHash), true);
  assert.equal(await verifyPassword(body.recoveryPhrase, repository.users.get(account.user!.id)!.recoveryPhraseHash), true);
  assert.equal((await recover('Lectora', account.recoveryPhrase)).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'Lectora', password } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'Lectora', password: nextPassword } })).statusCode, 200);
});

test('palabras incorrectas, usuarios ausentes y cuentas sin palabras reciben el mismo error sin cambiar sus sesiones', async t => {
  const { app, repository, register, recover } = await fixture(t);
  const account = await register();
  const originalHash = repository.users.get(account.user!.id)!.passwordHash;
  const wrong = generateRecoveryPhrase();
  const first = await recover('Lectora', wrong);
  const missing = await recover('Desconocida', wrong);
  assert.equal(first.statusCode, 401);
  assert.equal(first.payload, missing.payload);
  for (const phrase of [null, [], {}, 3, '', 'solo una palabra', 'a'.repeat(257)]) {
    assert.equal((await recover('Lectora', phrase)).statusCode, 401);
  }
  repository.users.get(account.user!.id)!.recoveryPhraseHash = null;
  const legacy = await recover('Lectora', account.recoveryPhrase);
  assert.equal(legacy.payload, first.payload);
  assert.equal(legacy.headers['set-cookie'], undefined);
  assert.equal(repository.users.get(account.user!.id)!.passwordHash, originalHash);
  assert.equal((await app.inject({ url: '/api/books', headers: { cookie: account.cookie } })).statusCode, 200);
});

test('el login no genera ni entrega palabras a cuentas anteriores', async t => {
  const { app, repository, register } = await fixture(t);
  const account = await register();
  const stored = repository.users.get(account.user!.id)!;
  stored.recoveryPhraseHash = null;
  const failed = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'Lectora', password: 'incorrecta' } });
  assert.equal(failed.statusCode, 401);
  assert.equal(stored.recoveryPhraseHash, null);
  const first = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'Lectora', password } });
  assert.equal(first.statusCode, 200);
  assert.equal('recoveryPhrase' in first.json(), false);
  assert.equal(stored.recoveryPhraseHash, null);
});

test('recuperación aplica protección de origen, tamaño, contraseña y límite de intentos', async t => {
  const { app, register, recover } = await fixture(t);
  const account = await register();
  const payload = { username: 'Lectora', password: nextPassword, recoveryPhrase: account.recoveryPhrase };
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/recover', payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/recover', headers: { ...headers, origin: 'https://externo.invalid' }, payload })).statusCode, 403);
  assert.equal((await recover('Lectora', account.recoveryPhrase, 'corta')).statusCode, 400);
  assert.equal((await recover('Lectora', account.recoveryPhrase, 'x'.repeat(129))).statusCode, 400);
  assert.equal((await recover('Lectora', 'x'.repeat(5000))).statusCode, 413);
  for (let index = 0; index < 20; index++) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/recover', remoteAddress: '192.0.2.9', headers, payload: { username: 'x' } });
    assert.equal(response.statusCode, 400);
  }
  const limited = await app.inject({ method: 'POST', url: '/api/auth/recover', remoteAddress: '192.0.2.9', headers, payload });
  assert.equal(limited.statusCode, 429);
});

test('dos recuperaciones simultáneas con las mismas palabras sólo crean una sesión válida', async t => {
  const { app, repository, register, recover } = await fixture(t);
  const account = await register();
  const responses = await Promise.all([
    recover('Lectora', account.recoveryPhrase, 'primera contraseña ficticia'),
    recover('Lectora', account.recoveryPhrase, 'segunda contraseña ficticia'),
  ]);
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 401]);
  assert.equal(repository.sessions.size, 1);
  const success = responses.find(response => response.statusCode === 200)!;
  const rejected = responses.find(response => response.statusCode === 401)!;
  assert.equal(rejected.headers['set-cookie'], undefined);
  assert.equal((await app.inject({ url: '/api/books', headers: { cookie: cookieOf(success) } })).statusCode, 200);
});
