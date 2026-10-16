import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { ErrorNotice } from '../client/components/ErrorNotice.js';
import { AuthView } from '../client/features/auth/AuthView.js';
import { RecoverAccountView } from '../client/features/auth/RecoverAccountView.js';

test('los avisos con acción comparten icono, estructura y botón principal, también para reintentar', () => {
  for (const label of ['Reintentar', 'Volver a la biblioteca', 'Reintentar sesión']) {
    let calls = 0;
    const tree = ErrorNotice({ title: 'Error ficticio', message: 'Mensaje de prueba.', action: { label, onClick: () => calls++ } });
    const html = load(renderToStaticMarkup(tree));
    assert.equal(html('.error-notice.page-error[role="alert"]').length, 1);
    assert.equal(html('.error-notice-icon[aria-hidden="true"]').length, 1);
    assert.equal(html('.error-notice-body strong').text(), 'Error ficticio');
    assert.equal(html('.error-notice-body p').text(), 'Mensaje de prueba.');
    assert.equal(html('.error-notice-action.button-primary[type="button"]').text(), label);
    assert.equal(html('.button-outline').length, 0);
    const children = tree.props.children;
    children[2].props.onClick();
    assert.equal(calls, 1);
  }
});

test('los avisos compactos conservan la identidad visual y el identificador accesible sin añadir acciones', () => {
  const html = load(renderToStaticMarkup(createElement(ErrorNotice, {
    compact: true, id: 'error-ficticio', message: 'El texto no puede estar vacío.\nCorrígelo para continuar.', className: 'preserve-lines',
  })));
  assert.equal(html('#error-ficticio.error-notice--compact[role="alert"]').length, 1);
  assert.equal(html('.error-notice-icon').length, 1);
  assert.equal(html('.error-notice-body p').text(), 'El texto no puede estar vacío.\nCorrígelo para continuar.');
  assert.equal(html('button').length, 0);
  assert.equal(html('strong').length, 0);
});

test('los errores de acceso y recuperación usan el mismo aviso dentro de sus formularios', () => {
  const message = 'No pudimos conectar con el servidor. Inténtalo de nuevo en unos momentos.';
  const views = [
    createElement(AuthView, { busy: false, error: message, onSubmit: async () => {}, onRecover: async () => {}, onClearError() {} }),
    createElement(RecoverAccountView, { busy: false, error: message, username: 'Lectora', onSubmit: async () => {}, onBack() {} }),
  ];
  for (const view of views) {
    const html = load(renderToStaticMarkup(view));
    assert.equal(html('form .error-notice--compact[role="alert"]').length, 1);
    assert.equal(html('.error-notice-body').text(), message);
    assert.equal(html('form > .button-primary[type="submit"]').length, 1);
  }
});

test('una acción deshabilitada permanece deshabilitada sin cambiar su estilo', () => {
  const html = load(renderToStaticMarkup(createElement(ErrorNotice, {
    message: 'Sesión ficticia.', action: { label: 'Reintentar sesión', onClick() {}, disabled: true },
  })));
  assert.equal(html('.error-notice-action.button-primary[disabled]').length, 1);
});
