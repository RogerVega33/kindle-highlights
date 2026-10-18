import assert from 'node:assert/strict';
import test from 'node:test';
import { createBookNavigation } from '../client/lib/book-navigation.js';
import { createRandomAnnotationNavigation } from '../client/lib/random-annotation-navigation.js';
import { fakeBrowser } from './helpers/navigation.js';

test('Atrás cierra la anotación sin salir de la biblioteca; Adelante la vuelve a abrir', () => {
  const { browser, entries } = fakeBrowser('/?orden=title#main-content', { other: 'preserved' });
  const states: boolean[] = [];
  const dialog = createRandomAnnotationNavigation(browser, open => states.push(open));
  dialog.open();
  dialog.open();
  assert.equal(entries.length, 2);
  assert.equal(browser.location.href, 'https://example.test/?orden=title#main-content');
  assert.deepEqual(browser.history.state, { other: 'preserved', kindleRandomAnnotation: '/?orden=title#main-content' });
  browser.history.back();
  assert.deepEqual(states, [false, true, false]);
  browser.history.forward();
  assert.deepEqual(states, [false, true, false, true]);
});

test('cerrar con la X y volver a abrir no acumula entradas', () => {
  const { browser, entries } = fakeBrowser();
  let open = false;
  const dialog = createRandomAnnotationNavigation(browser, next => { open = next; });
  for (let i = 0; i < 5; i++) {
    dialog.open();
    assert.equal(open, true);
    dialog.close();
    assert.equal(open, false);
    assert.equal(entries.length, 2);
    assert.equal(browser.history.state, null);
  }
});

test('desde un libro, el primer Atrás cierra el popup y el siguiente vuelve a la biblioteca', () => {
  const { browser } = fakeBrowser();
  const routes: (string | null)[] = [];
  const books = createBookNavigation(browser, id => routes.push(id));
  books.openBook('actual');
  let open = false;
  const dialog = createRandomAnnotationNavigation(browser, next => { open = next; });
  dialog.open();
  browser.history.back();
  assert.equal(open, false);
  assert.equal(browser.location.pathname, '/books/actual');
  assert.deepEqual(routes, [null, 'actual'], 'Cerrar no debe recargar el libro.');
  browser.history.back();
  assert.equal(browser.location.pathname, '/');
});

for (const initialBook of [null, 'actual']) {
  for (const targetBook of ['actual', 'otro']) {
    test(`Abrir libro ${targetBook} desde ${initialBook ?? 'biblioteca'} espera a Atrás sin dejar el popup en el historial`, () => {
      const { browser, entries } = fakeBrowser();
      const books = createBookNavigation(browser, () => {});
      if (initialBook) books.openBook(initialBook);
      let open = false;
      const dialog = createRandomAnnotationNavigation(browser, next => { open = next; });
      dialog.open();
      const back = browser.history.back;
      let backCalls = 0;
      browser.history.back = () => { backCalls++; };
      let completed = 0;
      const openBook = () => { completed++; books.openBook(targetBook); };
      dialog.close(openBook);
      dialog.close(openBook);
      dialog.open();
      assert.equal(backCalls, 1, 'Los clics repetidos no deben retroceder dos veces.');
      assert.equal(completed, 0);
      assert.equal(open, true);
      back(); // Simulate the asynchronous history traversal completing.
      assert.equal(completed, 1);
      assert.equal(open, false);
      assert.equal(browser.location.pathname, '/books/' + targetBook);
      browser.history.back = back;
      books.backToLibrary();
      assert.equal(browser.location.pathname, '/');
      assert.equal(open, false);
      browser.history.forward();
      assert.equal(browser.location.pathname, '/books/' + targetBook);
      assert.equal(open, false);
      assert.ok(entries.length <= 3);
    });
  }
}

test('remontar restaura el popup sin duplicar entradas ni conservar listeners anteriores', () => {
  const { browser, entries, listeners } = fakeBrowser();
  const original = createRandomAnnotationNavigation(browser, () => {});
  original.open();
  original.dispose();
  assert.equal(listeners.size, 0);
  const states: boolean[] = [];
  const restored = createRandomAnnotationNavigation(browser, open => states.push(open));
  assert.deepEqual(states, [true]);
  assert.equal(entries.length, 2);
  restored.close();
  assert.deepEqual(states, [true, false]);
  restored.dispose();
  assert.equal(listeners.size, 0);
});

test('desmontar mientras se cierra cancela la navegación pendiente al libro', () => {
  const { browser } = fakeBrowser();
  const dialog = createRandomAnnotationNavigation(browser, () => {});
  dialog.open();
  const back = browser.history.back;
  browser.history.back = () => {};
  let completed = false;
  dialog.close(() => { completed = true; });
  dialog.dispose();
  back();
  assert.equal(completed, false);
});
