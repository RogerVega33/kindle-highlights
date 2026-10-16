import assert from 'node:assert/strict';
import test from 'node:test';
import { bookIdFromPath, createBookNavigation } from '../client/lib/book-navigation.js';
import { readCurrent } from '../client/lib/current-read.js';

function fakeBrowser(path = '/') {
  const entries: { url: URL; state: unknown }[] = [{ url: new URL(path, 'https://example.test'), state: null }];
  let index = 0;
  const listeners = new Set<() => void>();
  const visit = (next: number) => {
    if (next < 0 || next >= entries.length) return;
    index = next;
    listeners.forEach(listener => listener());
  };
  const browser = {
    get location() { return entries[index].url; },
    history: {
      get state() { return entries[index].state; },
      replaceState(state: unknown, _title: string, url?: string | URL | null) {
        entries[index] = { state, url: new URL(url?.toString() ?? entries[index].url, entries[index].url) };
      },
      pushState(state: unknown, _title: string, url?: string | URL | null) {
        const next = { state, url: new URL(url?.toString() ?? entries[index].url, entries[index].url) };
        entries.splice(++index, entries.length, next);
      },
      back() { visit(index - 1); },
      forward() { visit(index + 1); },
    },
    addEventListener(_type: 'popstate', listener: () => void) { listeners.add(listener); },
    removeEventListener(_type: 'popstate', listener: () => void) { listeners.delete(listener); },
  };
  return { browser, entries, listeners };
}

test('abrir un libro crea su URL; Atrás y Adelante recorren biblioteca y libro', () => {
  const { browser, entries } = fakeBrowser();
  const routes: (string | null)[] = [];
  const navigation = createBookNavigation(browser, id => routes.push(id));
  navigation.openBook('libro-1');
  assert.equal(browser.location.pathname, '/books/libro-1');
  assert.equal(entries.length, 2);
  browser.history.back();
  assert.equal(browser.location.pathname, '/');
  browser.history.forward();
  assert.equal(browser.location.pathname, '/books/libro-1');
  assert.deepEqual(routes, [null, 'libro-1', null, 'libro-1']);
});

test('recargar restaura el libro de la URL sin duplicar entradas del historial', () => {
  const { browser, entries, listeners } = fakeBrowser();
  const original = createBookNavigation(browser, () => {});
  original.openBook('libro-2');
  original.dispose();
  assert.equal(listeners.size, 0);
  const restored: (string | null)[] = [];
  const navigation = createBookNavigation(browser, id => restored.push(id));
  assert.deepEqual(restored, ['libro-2']);
  assert.equal(entries.length, 2);
  navigation.backToLibrary();
  assert.equal(browser.location.pathname, '/');
  assert.deepEqual(restored, ['libro-2', null]);
});

test('un enlace directo también permite volver a la biblioteca y no se duplica al remontar', () => {
  const { browser, entries } = fakeBrowser('/books/libro-directo?origen=prueba#main-content');
  const navigation = createBookNavigation(browser, () => {});
  assert.equal(entries[0].url.pathname, '/');
  assert.equal(entries.length, 2);
  assert.equal(browser.location.search, '?origen=prueba');
  assert.equal(browser.location.hash, '#main-content');
  navigation.dispose();
  const mounted = createBookNavigation(browser, () => {});
  assert.equal(entries.length, 2, 'Recargar o StrictMode no debe agregar otra biblioteca.');
  browser.history.back();
  assert.equal(browser.location.pathname, '/');
  mounted.backToLibrary();
  assert.equal(entries.length, 2, 'Estar en la biblioteca no debe crear un bucle de navegación.');
});

test('el botón Biblioteca usa la entrada anterior y permite volver al libro con Adelante', () => {
  const { browser, entries } = fakeBrowser();
  const navigation = createBookNavigation(browser, () => {});
  navigation.openBook('libro-3');
  navigation.openBook('libro-3');
  assert.equal(entries.length, 2, 'Abrir el mismo libro no debe duplicar su entrada.');
  navigation.backToLibrary();
  assert.equal(browser.location.pathname, '/');
  browser.history.forward();
  assert.equal(browser.location.pathname, '/books/libro-3');
});

test('abrir otro libro después de Atrás descarta la rama anterior del historial', () => {
  const { browser, entries } = fakeBrowser();
  const navigation = createBookNavigation(browser, () => {});
  navigation.openBook('anterior');
  browser.history.back();
  navigation.openBook('nuevo');
  browser.history.forward();
  assert.equal(entries.length, 2);
  assert.equal(browser.location.pathname, '/books/nuevo');
});

test('volver dentro del mismo libro no recarga sus datos y otra selección conserva la salida a la biblioteca', () => {
  const { browser, entries } = fakeBrowser();
  const routes: (string | null)[] = [];
  const navigation = createBookNavigation(browser, id => routes.push(id));
  navigation.openBook('primero');
  browser.history.pushState(browser.history.state, '', '#main-content');
  browser.history.back();
  assert.deepEqual(routes, [null, 'primero']);
  navigation.openBook('segundo');
  assert.equal(browser.location.pathname, '/books/segundo');
  navigation.backToLibrary();
  assert.equal(browser.location.pathname, '/');
  assert.equal(entries[0].url.pathname, '/');
});

test('un libro eliminado puede reemplazarse por la biblioteca sin restaurarlo al recargar', () => {
  const { browser } = fakeBrowser('/books/eliminado');
  const navigation = createBookNavigation(browser, () => {});
  navigation.replaceWithLibrary();
  assert.equal(browser.location.pathname, '/');
  navigation.dispose();
  const restored: (string | null)[] = [];
  createBookNavigation(browser, id => restored.push(id));
  assert.deepEqual(restored, [null]);
});

test('las rutas codificadas se restauran y las rutas ajenas o malformadas se ignoran', () => {
  assert.equal(bookIdFromPath('/books/t%C3%ADtulo%20ficticio'), 'título ficticio');
  assert.equal(bookIdFromPath('/books/libro/'), 'libro');
  for (const path of ['/', '/books/', '/otra-ruta', '/books/a/b', '/books/%E0%A4%A']) {
    assert.equal(bookIdFromPath(path), null);
  }
});

test('Atrás durante la carga invalida el resultado pendiente; Adelante inicia la lectura actual', async () => {
  const { browser } = fakeBrowser();
  let resolve!: (value: string) => void;
  const pending = new Promise<string>(accept => { resolve = accept; });
  let sequence = 0;
  let calls = 0;
  const tasks: Promise<void>[] = [];
  const committed: string[] = [];
  const navigation = createBookNavigation(browser, id => {
    const current = ++sequence;
    if (id) tasks.push(readCurrent({
      read: () => ++calls === 1 ? pending : Promise.resolve('libro actualizado'),
      isActive: () => sequence === current,
      version: () => 0,
      commit: detail => committed.push(detail),
    }));
  });
  navigation.openBook('libro-lento');
  browser.history.back();
  resolve('respuesta obsoleta');
  await Promise.all(tasks);
  assert.deepEqual(committed, []);
  browser.history.forward();
  await Promise.all(tasks);
  assert.deepEqual(committed, ['libro actualizado']);
});
