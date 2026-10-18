import assert from 'node:assert/strict';
import test from 'node:test';
import { watchPwaUpdates } from '../client/pwa/updates.js';

class Worker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  messages: unknown[] = [];
  reply = true;
  constructor(public version: string | null = null) { super(); }
  postMessage(message: unknown, transfer?: Transferable[]) {
    this.messages.push(message);
    if ((message as { type?: string }).type === 'GET_VERSION' && this.reply) {
      (transfer?.[0] as MessagePort | undefined)?.postMessage({ version: this.version });
    }
  }
  installed() { this.state = 'installed'; this.dispatchEvent(new Event('statechange')); }
}
class Registration extends EventTarget {
  installing: Worker | null = null;
  waiting: Worker | null = null;
}
class Container extends EventTarget { controller: Worker | null = null; }

function completion() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('la primera instalación y los cambios de controlador sin aprobación son silenciosos', () => {
  const registration = new Registration();
  const workers = new Container();
  const installing = new Worker();
  registration.installing = installing;
  let announcements = 0;
  let reloads = 0;
  const watcher = watchPwaUpdates(registration, workers, () => announcements++, () => reloads++);
  installing.installed();
  workers.controller = installing;
  workers.dispatchEvent(new Event('controllerchange'));
  assert.equal(announcements, 0);
  assert.equal(reloads, 0);
  assert.deepEqual(installing.messages, []);
  watcher.dispose();
});

test('una actualización lista se anuncia una vez y solo recarga después de aceptarla y activarse', () => {
  const registration = new Registration();
  const workers = new Container();
  workers.controller = new Worker();
  const update = new Worker();
  update.state = 'installed';
  registration.waiting = update;
  let announcements = 0;
  let reloads = 0;
  const watcher = watchPwaUpdates(registration, workers, () => announcements++, () => reloads++);
  assert.equal(announcements, 1);
  assert.equal(reloads, 0);
  assert.deepEqual(update.messages, []);
  assert.equal(watcher.apply(), true);
  assert.equal(watcher.apply(), false);
  assert.equal(reloads, 0);
  assert.deepEqual(update.messages, [{ type: 'SKIP_WAITING' }]);
  workers.controller = update;
  workers.dispatchEvent(new Event('controllerchange'));
  workers.dispatchEvent(new Event('controllerchange'));
  assert.equal(reloads, 1);
  watcher.dispose();
});

test('las actualizaciones posteriores se detectan sin repetir el aviso y al desmontar se retiran los listeners', () => {
  const registration = new Registration();
  const workers = new Container();
  workers.controller = new Worker();
  let announcements = 0;
  const watcher = watchPwaUpdates(registration, workers, () => announcements++, () => assert.fail('No se aprobó la recarga.'));
  const update = new Worker();
  registration.installing = update;
  registration.dispatchEvent(new Event('updatefound'));
  registration.waiting = update;
  update.installed();
  registration.dispatchEvent(new Event('updatefound'));
  update.installed();
  assert.equal(announcements, 1);
  watcher.dispose();
  registration.installing = new Worker();
  registration.dispatchEvent(new Event('updatefound'));
  registration.installing.installed();
  assert.equal(announcements, 1);
  workers.dispatchEvent(new Event('controllerchange'));
});

test('una actualización retirada o que no acepta mensajes no provoca recargas', () => {
  const registration = new Registration();
  const workers = new Container();
  const watcher = watchPwaUpdates(registration, workers, () => {}, () => assert.fail('No debe recargar.'));
  assert.equal(watcher.apply(), false);
  registration.waiting = new Worker();
  registration.waiting.postMessage = () => { throw new Error('Worker ficticio retirado.'); };
  assert.equal(watcher.apply(), false);
  workers.dispatchEvent(new Event('controllerchange'));
  watcher.dispose();
});

test('actualizar en otra pestaña no interrumpe esta; su botón permite cargar la nueva versión', () => {
  const registration = new Registration();
  const workers = new Container();
  workers.controller = new Worker();
  const update = new Worker();
  update.state = 'installed';
  registration.waiting = update;
  let announcements = 0;
  let reloads = 0;
  const watcher = watchPwaUpdates(registration, workers, () => announcements++, () => reloads++);
  registration.waiting = null;
  workers.controller = update;
  workers.dispatchEvent(new Event('controllerchange'));
  assert.equal(announcements, 1, 'El mismo aviso no debe repetirse.');
  assert.equal(reloads, 0);
  assert.equal(watcher.apply(), true);
  assert.equal(reloads, 1);
  watcher.dispose();
});

test('recargar una página que ya contiene la versión nueva activa su caché sin aviso ni otra recarga', async () => {
  const registration = new Registration();
  const workers = new Container();
  workers.controller = new Worker('anterior');
  const update = new Worker('actual');
  update.state = 'installed';
  registration.waiting = update;
  let announcements = 0;
  let reloads = 0;
  const ready = completion();
  const watcher = watchPwaUpdates(registration, workers, () => announcements++, () => reloads++, {
    version: 'actual', onCurrent: () => ready.resolve(),
  });
  await ready.promise;
  assert.equal(announcements, 0);
  assert.equal(reloads, 0);
  assert.deepEqual(update.messages, [{ type: 'GET_VERSION' }, { type: 'SKIP_WAITING' }]);
  registration.waiting = null;
  workers.controller = update;
  workers.dispatchEvent(new Event('controllerchange'));
  assert.equal(reloads, 0);
  assert.equal(announcements, 0);
  assert.equal(watcher.apply(), false);
  watcher.dispose();
});

test('una página anterior conserva el aviso y solo actualiza tras aceptar', async () => {
  const registration = new Registration();
  const workers = new Container();
  workers.controller = new Worker('anterior');
  const update = new Worker('nueva');
  update.state = 'installed';
  registration.waiting = update;
  const notice = completion();
  let reloads = 0;
  const watcher = watchPwaUpdates(registration, workers, () => notice.resolve(), () => reloads++, { version: 'anterior' });
  await notice.promise;
  assert.deepEqual(update.messages, [{ type: 'GET_VERSION' }]);
  assert.equal(reloads, 0);
  assert.equal(watcher.apply(), true);
  assert.deepEqual(update.messages, [{ type: 'GET_VERSION' }, { type: 'SKIP_WAITING' }]);
  registration.waiting = null;
  workers.controller = update;
  workers.dispatchEvent(new Event('controllerchange'));
  assert.equal(reloads, 1);
  watcher.dispose();
});

test('activar desde otra pestaña solo avisa a páginas de una versión anterior', async () => {
  for (const version of ['actual', 'anterior']) {
    const registration = new Registration();
    const workers = new Container();
    workers.controller = new Worker('anterior');
    let announcements = 0;
    let reloads = 0;
    const settled = completion();
    const watcher = watchPwaUpdates(registration, workers, () => { announcements++; settled.resolve(); }, () => reloads++, {
      version, onCurrent: () => settled.resolve(),
    });
    workers.controller = new Worker('actual');
    workers.dispatchEvent(new Event('controllerchange'));
    await settled.promise;
    assert.equal(announcements, version === 'actual' ? 0 : 1);
    assert.equal(reloads, 0);
    assert.equal(watcher.apply(), version !== 'actual');
    assert.equal(reloads, version === 'actual' ? 0 : 1);
    watcher.dispose();
  }
});

test('si no se puede identificar la versión se conserva el aviso sin activar automáticamente', async () => {
  const registration = new Registration();
  const workers = new Container();
  workers.controller = new Worker();
  const update = new Worker();
  update.state = 'installed';
  registration.waiting = update;
  const notice = completion();
  const watcher = watchPwaUpdates(registration, workers, () => notice.resolve(), () => assert.fail('No se aprobó la recarga.'), { version: 'actual' });
  await notice.promise;
  assert.deepEqual(update.messages, [{ type: 'GET_VERSION' }]);
  watcher.dispose();
});

test('un worker antiguo que no responde conserva el aviso después de una espera limitada', async () => {
  const registration = new Registration();
  const workers = new Container();
  workers.controller = new Worker('anterior');
  const update = new Worker();
  update.reply = false;
  update.state = 'installed';
  registration.waiting = update;
  const notice = completion();
  const watcher = watchPwaUpdates(registration, workers, () => notice.resolve(), () => assert.fail('Sin recarga automática.'), {
    version: 'actual', onCurrent: () => assert.fail('No se identificó la versión.'),
  });
  await notice.promise;
  assert.deepEqual(update.messages, [{ type: 'GET_VERSION' }]);
  watcher.dispose();
});

test('desmontar cancela las consultas pendientes sin avisos tardíos', async () => {
  const registration = new Registration();
  const workers = new Container();
  workers.controller = new Worker('anterior');
  const update = new Worker('actual');
  update.reply = false;
  update.state = 'installed';
  registration.waiting = update;
  const watcher = watchPwaUpdates(registration, workers, () => assert.fail('Consulta cancelada.'), () => assert.fail('Sin recarga.'), {
    version: 'actual', onCurrent: () => assert.fail('Consulta cancelada.'),
  });
  watcher.dispose();
  await Promise.resolve();
  assert.deepEqual(update.messages, [{ type: 'GET_VERSION' }]);
});
