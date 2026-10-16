import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from '../shared/types.js';
import { refreshSession } from '../client/lib/session-refresh.js';

const user: User = { id: 'fixture-reader', username: 'Lectora', lastLoginAt: null };

function capture(isCurrent = () => true) {
  const sessions: (User | null)[] = [];
  const errors: string[] = [];
  const unavailable: boolean[] = [];
  return {
    sessions, errors, unavailable,
    run: (signal?: AbortSignal) => refreshSession({
      signal, isCurrent,
      onSession: nextUser => { sessions.push(nextUser); },
      onError: message => { errors.push(message); },
      onUnavailable: () => { unavailable.push(true); },
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
  assert.deepEqual(check.unavailable, [true], 'Una sesión sin comprobar debe conservar la vista, incluso sin identidad en memoria tras recargar.');
  online = true;
  await check.run();
  assert.deepEqual(check.sessions, [user]);
  assert.equal(check.unavailable.length, 1);
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
    assert.deepEqual(check.unavailable, [true]);
  }
  for (const status of [200, 502]) {
    response = new Response('<html>Respuesta ajena a la API</html>', { status });
    const check = capture();
    await check.run();
    assert.deepEqual(check.sessions, []);
    assert.equal(check.errors.length, 1);
    assert.deepEqual(check.unavailable, [true]);
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
  assert.deepEqual(check.unavailable, []);
});

test('un JSON sin una respuesta de sesión válida conserva la cuenta actual', async t => {
  let body: unknown;
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  for (body of [null, {}, { user: false }, { user: {} }, { user: { ...user, id: '' } }]) {
    const check = capture();
    await check.run();
    assert.deepEqual(check.sessions, []);
    assert.equal(check.errors.length, 1);
    assert.deepEqual(check.unavailable, [true]);
  }
});

test('una respuesta explícita sin usuario cierra la sesión', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ user: null }));
  const check = capture();
  await check.run();
  assert.deepEqual(check.sessions, [null]);
  assert.deepEqual(check.errors, []);
  assert.deepEqual(check.unavailable, []);
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
    assert.deepEqual(check.unavailable, [], 'Un 401 debe mostrar el acceso, no la vista de sesión sin comprobar.');
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
  assert.deepEqual(check.unavailable, []);
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
  assert.deepEqual(check.unavailable, []);
});

test('reintentar tras recargar sin red solo muestra el acceso cuando se confirma que no hay sesión', async t => {
  let online = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (!online) throw new TypeError('Sin conexión ficticia.');
    return Response.json({ user: null });
  });
  let unavailable = false;
  let identity: User | null = null;
  const run = () => refreshSession({
    isCurrent: () => true,
    onSession: nextUser => { identity = nextUser; unavailable = false; },
    onUnavailable: () => { unavailable = true; },
    onError() {},
  });
  await run();
  assert.equal(identity, null);
  assert.equal(unavailable, true, 'Sin red no se puede deducir que el usuario debe iniciar sesión.');
  online = true;
  await run();
  assert.equal(identity, null);
  assert.equal(unavailable, false, 'El servidor confirmó que corresponde mostrar el acceso.');
});
