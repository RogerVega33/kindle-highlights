import assert from 'node:assert/strict';
import test from 'node:test';
import { authScreenFromPath, createAuthNavigation } from '../client/lib/auth-navigation.js';
import type { AuthScreen } from '../client/lib/auth-navigation.js';
import { createBookNavigation } from '../client/lib/book-navigation.js';
import { fakeBrowser } from './helpers/navigation.js';

test('cada formulario tiene una URL propia, sin confundir rutas de libros o API', () => {
  for (const screen of ['login', 'register', 'recover'] as const) {
    assert.equal(authScreenFromPath('/' + screen), screen);
    assert.equal(authScreenFromPath('/' + screen + '/'), screen);
  }
  for (const path of ['/', '/books/register', '/api/auth/login', '/register/extra', '/login%2F']) {
    assert.equal(authScreenFromPath(path), null);
  }
});

test('registro y recuperación añaden historial; Atrás y Adelante recorren las pantallas', () => {
  const { browser, entries } = fakeBrowser();
  const screens: (AuthScreen | null)[] = [];
  const navigation = createAuthNavigation(browser, screen => screens.push(screen));
  navigation.setMode('guest');
  assert.equal(browser.location.pathname, '/login');
  assert.equal(entries.length, 1);
  navigation.navigate('register');
  navigation.navigate('login');
  navigation.navigate('recover');
  browser.history.back();
  assert.equal(browser.location.pathname, '/login');
  browser.history.back();
  assert.equal(browser.location.pathname, '/register');
  browser.history.back();
  assert.equal(browser.location.pathname, '/login');
  browser.history.forward();
  assert.equal(browser.location.pathname, '/register');
  assert.deepEqual(screens, ['login', 'register', 'login', 'recover', 'login', 'register', 'login', 'register']);
});

test('actualizar conserva cualquiera de los formularios sin duplicar entradas ni listeners', () => {
  const { browser, entries, listeners } = fakeBrowser();
  let navigation = createAuthNavigation(browser, () => {});
  navigation.setMode('guest');
  for (const screen of ['register', 'recover', 'login'] as const) {
    navigation.navigate(screen);
    const count = entries.length;
    navigation.dispose();
    assert.equal(listeners.size, 0);
    const screens: (AuthScreen | null)[] = [];
    navigation = createAuthNavigation(browser, next => screens.push(next));
    navigation.setMode('pending');
    navigation.setMode('guest');
    assert.deepEqual(screens, [screen]);
    assert.equal(browser.location.pathname, '/' + screen);
    assert.equal(entries.length, count);
    assert.equal(listeners.size, 1);
  }
});

test('un enlace directo a registro o recuperación permite volver a iniciar sesión en móvil', () => {
  for (const screen of ['register', 'recover'] as const) {
    const { browser, entries } = fakeBrowser('/' + screen);
    let navigation = createAuthNavigation(browser, () => {});
    navigation.setMode('guest');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].url.pathname, '/login');
    assert.equal(browser.location.pathname, '/' + screen);
    navigation.dispose();
    navigation = createAuthNavigation(browser, () => {});
    navigation.setMode('guest');
    assert.equal(entries.length, 2, 'Una recarga o StrictMode no debe añadir otra pantalla de acceso.');
    browser.history.back();
    assert.equal(browser.location.pathname, '/login');
    browser.history.forward();
    assert.equal(browser.location.pathname, '/' + screen);
  }
});

test('repetir la pantalla no duplica historial y otra selección descarta la rama de Adelante', () => {
  const { browser, entries } = fakeBrowser('/login');
  const navigation = createAuthNavigation(browser, () => {});
  navigation.setMode('guest');
  navigation.navigate('register');
  navigation.navigate('register');
  assert.equal(entries.length, 2);
  browser.history.back();
  navigation.navigate('recover');
  browser.history.forward();
  assert.equal(browser.location.pathname, '/recover');
  assert.equal(entries.length, 2);
});

test('terminar el acceso reemplaza la ruta del formulario y Atrás con sesión no vuelve a mostrarlo', () => {
  const { browser } = fakeBrowser('/login');
  const screens: (AuthScreen | null)[] = [];
  const navigation = createAuthNavigation(browser, screen => screens.push(screen));
  navigation.setMode('guest');
  navigation.navigate('register');
  navigation.setMode('authenticated');
  assert.equal(browser.location.pathname, '/');
  assert.equal(screens.at(-1), null);
  browser.history.back();
  assert.equal(browser.location.pathname, '/');
  assert.equal(screens.at(-1), null);
});

test('comprobar sesión y mostrar las palabras de recuperación no modifica la URL ni habilita saltos entre formularios', () => {
  const { browser, entries } = fakeBrowser('/register');
  const navigation = createAuthNavigation(browser, () => {});
  navigation.setMode('pending');
  navigation.navigate('login');
  assert.equal(browser.location.pathname, '/register');
  assert.equal(entries.length, 1);
  navigation.setMode('authenticated');
  assert.equal(browser.location.pathname, '/');
});

test('se conserva el enlace al libro al navegar y actualizar el acceso; después Biblioteca sigue funcionando', () => {
  const { browser } = fakeBrowser('/books/libro%20ficticio', {
    kindleBookNavigation: { bookId: 'libro ficticio', fromLibrary: true },
  });
  let navigation = createAuthNavigation(browser, () => {});
  navigation.setMode('guest');
  assert.equal(browser.location.pathname, '/login');
  navigation.navigate('register');
  navigation.navigate('recover');
  navigation.dispose();
  navigation = createAuthNavigation(browser, () => {});
  navigation.setMode('guest');
  assert.equal(browser.location.pathname, '/recover');
  navigation.setMode('authenticated');
  assert.equal(browser.location.pathname, '/books/libro%20ficticio');
  const books = createBookNavigation(browser, () => {});
  books.backToLibrary();
  assert.equal(browser.location.pathname, '/');
  browser.history.forward();
  assert.equal(browser.location.pathname, '/books/libro%20ficticio');
});

test('el destino de autenticación admite solo libros de esta aplicación', () => {
  for (const returnTo of ['https://other.invalid', '//other.invalid', '/api/auth/logout', '/books/a?secret=fictional', '/books/a#fragment']) {
    const { browser } = fakeBrowser('/login', { kindleAuthNavigation: { screen: 'login', returnTo } });
    const navigation = createAuthNavigation(browser, () => {});
    navigation.setMode('authenticated');
    assert.equal(browser.location.pathname, '/');
    assert.equal(browser.location.origin, 'https://example.test');
  }
});

test('el historial guarda solo rutas y distingue cambios de pantalla de las transiciones de sesión', () => {
  const { browser } = fakeBrowser();
  const changes: boolean[] = [];
  const navigation = createAuthNavigation(browser, (_screen, userNavigation) => changes.push(userNavigation));
  navigation.setMode('guest');
  navigation.navigate('register');
  browser.history.back();
  navigation.setMode('authenticated');
  assert.deepEqual(changes, [false, true, true, false]);
  assert.deepEqual((browser.history.state as { kindleAuthNavigation: unknown }).kindleAuthNavigation,
    { screen: null, returnTo: '/', fromLogin: false });
});
