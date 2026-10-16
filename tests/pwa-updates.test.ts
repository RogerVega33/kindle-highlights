import assert from 'node:assert/strict';
import test from 'node:test';
import { watchPwaUpdates } from '../client/pwa/updates.js';

class Worker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  messages: unknown[] = [];
  postMessage(message: unknown) { this.messages.push(message); }
  installed() { this.state = 'installed'; this.dispatchEvent(new Event('statechange')); }
}
class Registration extends EventTarget {
  installing: Worker | null = null;
  waiting: Worker | null = null;
}
class Container extends EventTarget { controller: unknown = null; }

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
