import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from '../shared/types.js';
import { refreshSession } from '../client/lib/session-refresh.js';

const user: User = { id: 'fixture-reader', username: 'Lectora', lastLoginAt: null };

function capture(isCurrent = () => true) {
  const sessions: (User | null)[] = [];
  const errors: string[] = [];
  return {
    sessions, errors,
    run: (signal?: AbortSignal) => refreshSession({
      signal, isCurrent,
      onSession: nextUser => { sessions.push(nextUser); },
      onError: message => { errors.push(message); },
    }),
  };
}

test('una comprobación fallida por red conserva la identidad y permite reintentar', async t => {
  let online = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (!online) throw new TypeError('Fallo de red ficticio.');
    return Response.json({ user });
  });
  const check = capture();
  await check.run();
  assert.deepEqual(check.sessions, [], 'Un fallo temporal no debe desmontar los datos de la cuenta.');
  assert.match(check.errors[0], /No pudimos comprobar tu sesión/);
  online = true;
  await check.run();
  assert.deepEqual(check.sessions, [user]);
});

test('errores HTTP y respuestas ilegibles no se convierten en una sesión terminada', async t => {
  let response: Response;
  t.mock.method(globalThis, 'fetch', async () => response);
  for (const status of [403, 429, 500, 503]) {
    response = Response.json({ message: 'Error ficticio.' }, { status });
    const check = capture();
    await check.run();
    assert.deepEqual(check.sessions, [], `Un ${status} no confirma el cierre de sesión.`);
    assert.equal(check.errors.length, 1);
  }
  for (const status of [200, 502]) {
    response = new Response('<html>Respuesta ajena a la API</html>', { status });
    const check = capture();
    await check.run();
    assert.deepEqual(check.sessions, []);
    assert.equal(check.errors.length, 1);
  }
});

test('una sesión válida confirma la identidad y conserva la señal de cancelación', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (input: unknown, init: RequestInit) => {
    assert.equal(input, '/api/auth/session');
    assert.equal(init.signal, controller.signal);
    assert.equal(init.credentials, 'same-origin');
    return Response.json({ user });
  });
  const check = capture();
  await check.run(controller.signal);
  assert.deepEqual(check.sessions, [user]);
  assert.deepEqual(check.errors, []);
});

test('un JSON sin una respuesta de sesión válida conserva la cuenta actual', async t => {
  let body: unknown;
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  for (body of [null, {}, { user: false }, { user: {} }, { user: { ...user, id: '' } }]) {
    const check = capture();
    await check.run();
    assert.deepEqual(check.sessions, []);
    assert.equal(check.errors.length, 1);
  }
});

test('una respuesta explícita sin usuario cierra la sesión', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ user: null }));
  const check = capture();
  await check.run();
  assert.deepEqual(check.sessions, [null]);
  assert.deepEqual(check.errors, []);
});

test('un 401 confirma el cierre incluso si su cuerpo no es JSON', async t => {
  let response: Response;
  t.mock.method(globalThis, 'fetch', async () => response);
  for (const body of ['json', 'html']) {
    response = body === 'json'
      ? Response.json({ message: 'Sesión terminada.' }, { status: 401 })
      : new Response('<html>Unauthorized</html>', { status: 401 });
    const check = capture();
    await check.run();
    assert.deepEqual(check.sessions, [null]);
    assert.deepEqual(check.errors, ['Tu sesión terminó. Inicia sesión de nuevo.']);
  }
});

test('una respuesta anterior al cierre o cambio de cuenta no restaura la identidad anterior', async t => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  t.mock.method(globalThis, 'fetch', () => pending);
  let current = true;
  const check = capture(() => current);
  const task = check.run();
  current = false;
  finish(Response.json({ user }));
  await task;
  assert.deepEqual(check.sessions, []);
  assert.deepEqual(check.errors, []);
});

test('un fallo obsoleto o cancelado no afecta la sesión ni muestra avisos', async t => {
  let fail!: (reason: unknown) => void;
  const pending = new Promise<Response>((_resolve, reject) => { fail = reject; });
  t.mock.method(globalThis, 'fetch', () => pending);
  let current = true;
  const check = capture(() => current);
  const task = check.run();
  current = false;
  fail(new DOMException('Comprobación cancelada.', 'AbortError'));
  await task;
  assert.deepEqual(check.sessions, []);
  assert.deepEqual(check.errors, []);
});
