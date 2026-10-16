import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { SessionUnavailableView } from '../client/features/auth/SessionUnavailableView.js';

function render(path: string, checking = false, message = 'No pudimos comprobar tu sesión. Inténtalo de nuevo en unos momentos.') {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { pathname: path } } });
  try {
    return load(renderToStaticMarkup(createElement(SessionUnavailableView, {
      theme: 'dark', onToggleTheme() {}, message, checking, onRetry() {},
    })));
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('sin poder comprobar la sesión se conserva la biblioteca con el aviso común, sin formulario de acceso ni datos privados', () => {
  const html = render('/');
  assert.equal(html('main.library-page h1').text(), 'Biblioteca');
  assert.equal(html('.error-notice[role="alert"] strong').text(), 'No pudimos cargar tu biblioteca.');
  assert.match(html('.error-notice-body p').text(), /No pudimos comprobar tu sesión/);
  assert.equal(html('.error-notice-action.button-primary').text(), 'Reintentar');
  assert.equal(html('.back-button, form, .book-card, .library-totals, .account-user').length, 0);
  assert.equal(html('.site-header').length, 1);
  assert.equal(html('.site-footer').length, 1);
});

test('una URL de libro conserva su vista y el enlace Biblioteca durante el fallo de sesión', () => {
  const html = render('/books/libro-ficticio');
  assert.equal(html('main.detail-page .back-button').text().trim(), 'Biblioteca');
  assert.equal(html('.error-notice strong').text(), 'No pudimos abrir el libro.');
  assert.equal(html('.error-notice-action.button-primary').text(), 'Reintentar');
  assert.equal(html('form, .book-card, .library-intro').length, 0);
});

test('al reintentar se mantiene el aviso en la misma vista y se deshabilita su acción hasta recibir respuesta', () => {
  for (const path of ['/', '/books/libro-ficticio']) {
    const html = render(path, true, '');
    assert.equal(html('.error-notice-action.button-primary[disabled]').text(), 'Comprobando sesión…');
    assert.match(html('.error-notice-body p').text(), /No pudimos comprobar tu sesión/);
    assert.equal(html('main').length, 1);
    assert.equal(html('form').length, 0);
  }
});
