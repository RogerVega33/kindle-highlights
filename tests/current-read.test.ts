import assert from 'node:assert/strict';
import test from 'node:test';
import { readCurrent } from '../client/lib/current-read.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('una mutación durante la carga descarta la lista anterior y confirma una lectura actualizada', async () => {
  const first = deferred<string[]>();
  let revision = 0;
  let calls = 0;
  const committed: string[][] = [];
  const task = readCurrent({
    read: () => ++calls === 1 ? first.promise : Promise.resolve(['importado', 'portada actualizada']),
    isActive: () => true,
    version: () => revision,
    commit: value => committed.push(value),
  });
  revision++;
  first.resolve(['lista anterior']);
  await task;
  assert.equal(calls, 2);
  assert.deepEqual(committed, [['importado', 'portada actualizada']]);
});

test('una navegación cancelada o sustituida no confirma la respuesta pendiente ni la vuelve a solicitar', async () => {
  const pending = deferred<string>();
  let active = true;
  let calls = 0;
  const committed: string[] = [];
  const task = readCurrent({
    read: () => { calls++; return pending.promise; },
    isActive: () => active,
    version: () => 0,
    commit: value => committed.push(value),
  });
  active = false;
  pending.resolve('libro anterior');
  await task;
  assert.equal(calls, 1);
  assert.deepEqual(committed, []);
});

test('un error de una lectura obsoleta se reemplaza por una lectura vigente', async () => {
  const pending = deferred<string>();
  let revision = 0;
  let calls = 0;
  const committed: string[] = [];
  const task = readCurrent({
    read: () => ++calls === 1 ? pending.promise : Promise.resolve('vigente'),
    isActive: () => true,
    version: () => revision,
    commit: value => committed.push(value),
  });
  revision++;
  pending.reject(new Error('error de una lectura anterior'));
  await task;
  assert.equal(calls, 2);
  assert.deepEqual(committed, ['vigente']);
});

test('los errores actuales se propagan y los errores de peticiones canceladas se ignoran', async () => {
  const error = new Error('conexión perdida');
  await assert.rejects(readCurrent({
    read: async () => { throw error; },
    isActive: () => true,
    version: () => 0,
    commit: () => assert.fail('no debe confirmar una lectura fallida'),
  }), cause => cause === error);

  const pending = deferred<never>();
  let active = true;
  const task = readCurrent({
    read: () => pending.promise,
    isActive: () => active,
    version: () => 0,
    commit: () => assert.fail('no debe confirmar una lectura cancelada'),
  });
  active = false;
  pending.reject(error);
  await task;
});
