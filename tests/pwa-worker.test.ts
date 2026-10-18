import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const template = await readFile(new URL('../pwa/service-worker.js', import.meta.url), 'utf8');
const assets = ['/', '/assets/app.js', '/assets/app.css', '/pwa-192.png'];
const cacheName = 'kindle-highlights-static-ficticio';

function fixture() {
  const events = new Map<string, (event: unknown) => void>();
  const cached = new Map<string, Response>();
  const added: Request[] = [];
  const deleted: string[] = [];
  let claims = 0;
  let skips = 0;
  let network = async (_request: unknown) => new Response('red ficticia');
  const cache = {
    async addAll(requests: Request[]) { added.push(...requests); },
    async match(path: string) { return cached.get(path)?.clone(); },
  };
  vm.runInNewContext(template.replace('__PWA_CONFIG__', JSON.stringify({ cacheName, assets })), {
    self: {
      location: { origin: 'https://example.test' },
      addEventListener: (type: string, listener: (event: unknown) => void) => events.set(type, listener),
      clients: { claim: async () => { claims++; } },
      skipWaiting: async () => { skips++; },
    },
    caches: {
      open: async (name: string) => { assert.equal(name, cacheName); return cache; },
      keys: async () => [cacheName, 'kindle-highlights-static-viejo', 'otra-aplicacion'],
      delete: async (name: string) => { deleted.push(name); return true; },
    },
    fetch: (request: unknown) => network(request), URL, Response,
    Request: class extends Request {
      constructor(path: string, options: RequestInit) { super(new URL(path, 'https://example.test'), options); }
    },
  });
  async function lifecycle(type: string, data?: unknown, ports: unknown[] = []) {
    const pending: Promise<unknown>[] = [];
    events.get(type)!({ data, ports, waitUntil: (task: Promise<unknown>) => pending.push(task) });
    await Promise.all(pending);
  }
  function request(path: string, mode = 'cors', method = 'GET') {
    let response: Promise<Response> | undefined;
    events.get('fetch')!({ request: { url: new URL(path, 'https://example.test').href, mode, method }, respondWith: (task: Promise<Response>) => { response = task; } });
    return response;
  }
  return { events, cached, added, deleted, lifecycle, request, claims: () => claims, skips: () => skips,
    setNetwork: (callback: typeof network) => { network = callback; } };
}

test('el worker instala solo recursos públicos y no activa una actualización sin consentimiento', async () => {
  const worker = fixture();
  await worker.lifecycle('install');
  assert.deepEqual(worker.added.map(request => new URL(request.url).pathname), assets);
  assert.ok(worker.added.every(request => request.cache === 'reload'));
  assert.equal(worker.skips(), 0);
  assert.deepEqual([...worker.events.keys()], ['install', 'activate', 'message', 'fetch']);
  await worker.lifecycle('message', { type: 'otro-mensaje' });
  assert.equal(worker.skips(), 0);
  await worker.lifecycle('message', { type: 'SKIP_WAITING' });
  assert.equal(worker.skips(), 1);
});

test('activar limpia únicamente las versiones anteriores de esta app', async () => {
  const worker = fixture();
  await worker.lifecycle('activate');
  assert.deepEqual(worker.deleted, ['kindle-highlights-static-viejo']);
  assert.equal(worker.claims(), 1);
});

test('el worker informa su versión mediante el puerto privado sin activar una actualización', async () => {
  const worker = fixture();
  const replies: { version: string }[] = [];
  await worker.lifecycle('message', { type: 'GET_VERSION' }, [{ postMessage: (value: { version: string }) => replies.push(value) }]);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].version, cacheName);
  assert.equal(worker.skips(), 0);
  await worker.lifecycle('message', { type: 'GET_VERSION' });
});

test('autenticación, datos privados, escrituras, recursos ajenos y archivos desconocidos pasan directamente a la red', () => {
  const worker = fixture();
  for (const path of ['/api', '/api/auth/session', '/api/books', '/api/books/libro/cover?v=1', '/api/imports', 'https://other.test/assets/app.js', '/archivo-desconocido.js', '/sw.js']) {
    assert.equal(worker.request(path), undefined, path);
  }
  assert.equal(worker.request('/api/books', 'navigate'), undefined);
  assert.equal(worker.request('/', 'cors', 'POST'), undefined);
  assert.equal(worker.cached.size, 0);
});

test('una navegación sin red recupera la interfaz conservando las URL de libros y acceso, sin emitir mensajes', async () => {
  const worker = fixture();
  worker.cached.set('/', new Response('interfaz pública ficticia'));
  worker.setNetwork(async () => { throw new TypeError('Sin red ficticia'); });
  for (const path of ['/books/ficticio', '/login', '/register', '/recover']) {
    const response = await worker.request(path, 'navigate');
    assert.equal(await response!.text(), 'interfaz pública ficticia');
  }
  assert.equal(worker.cached.size, 1);
  const empty = fixture();
  empty.setNetwork(async () => { throw new TypeError('Sin red ficticia'); });
  assert.equal((await empty.request('/', 'navigate'))!.type, 'error');
});

test('la navegación intenta primero la red y los archivos de interfaz se recuperan de la caché', async () => {
  const worker = fixture();
  worker.cached.set('/', new Response('interfaz anterior'));
  assert.equal(await (await worker.request('/books/ficticio', 'navigate'))!.text(), 'red ficticia');
  worker.cached.set('/assets/app.js', new Response('script ficticio'));
  worker.setNetwork(async () => { assert.fail('Un archivo precargado debe abrirse sin red.'); });
  assert.equal(await (await worker.request('/assets/app.js'))!.text(), 'script ficticio');
});
