import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { AuthView } from '../client/features/auth/AuthView.js';
import { SiteHeader } from '../client/components/SiteHeader.js';
import { authApi } from '../client/api/auth.js';
import { RecoverAccountView } from '../client/features/auth/RecoverAccountView.js';
import { RecoveryPhraseView } from '../client/features/auth/RecoveryPhraseView.js';
import { ChangePasswordDialog } from '../client/features/auth/ChangePasswordDialog.js';

test('el formulario de acceso usa campos de contraseña y autocompletado apropiado', () => {
  const html = load(renderToStaticMarkup(createElement(AuthView, { busy: false, error: '', onSubmit: async () => {}, onRecover: async () => {}, onClearError() {} })));
  assert.equal(html('input[name="username"]').attr('autocomplete'), 'username');
  assert.equal(html('input[name="password"]').attr('type'), 'password');
  assert.equal(html('input[name="password"]').attr('autocomplete'), 'current-password');
  assert.equal(html('button[type="submit"]').text(), 'Iniciar sesión');
  assert.equal(html('.book-card').length, 0);
});

test('la cabecera ofrece el menú de la cuenta únicamente cuando hay un usuario real', () => {
  const html = load(renderToStaticMarkup(createElement(SiteHeader, {
    theme: 'dark', onHome() {}, onToggleTheme() {}, onLogout() {}, onChangePassword() {},
    user: { id: 'ficticio', username: 'Lectora', lastLoginAt: null },
  })));
  assert.equal(html('.account-user').text(), 'L');
  assert.equal(html('.account-user').attr('title'), 'Lectora');
  assert.equal(html('.account-user').attr('aria-label'), 'Menú de la cuenta de Lectora');
  assert.equal(html('.account-user').attr('aria-haspopup'), 'menu');
  assert.equal(html('.account-user').attr('aria-expanded'), 'false');
  const anonymous = load(renderToStaticMarkup(createElement(SiteHeader, { theme: 'light', onHome() {}, onToggleTheme() {} })));
  assert.equal(anonymous('.account-user').length, 0);
  assert.equal(anonymous('button[aria-label="Cerrar sesión"]').length, 0);
});

test('el cliente de autenticación envía cookies y cabecera de protección sin incluir credenciales en la URL', async t => {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, init: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json({ user: null });
  });
  const credentials = { username: 'Lectora', password: 'frase ficticia de acceso' };
  await authApi.login(credentials);
  await authApi.register(credentials);
  await authApi.session();
  await authApi.logout();
  const recovery = { ...credentials, recoveryPhrase: 'acorn actor acute adapt admit adobe adopt afar' };
  await authApi.recover(recovery);
  const change = { currentPassword: credentials.password, newPassword: 'otra contraseña ficticia' };
  await authApi.changePassword(change);
  assert.deepEqual(calls.map(call => call.url), ['/api/auth/login', '/api/auth/register', '/api/auth/session', '/api/auth/logout', '/api/auth/recover', '/api/auth/password']);
  assert.ok(calls.every(call => call.init.credentials === 'same-origin' && !call.url.includes(credentials.password)));
  for (const call of [calls[0], calls[1], calls[3], calls[4], calls[5]]) assert.equal(new Headers(call.init.headers).get('X-Requested-With'), 'KindleHighlights');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), credentials);
  assert.equal(calls[2].init.body, undefined);
  assert.deepEqual(JSON.parse(String(calls[4].init.body)), recovery);
  assert.ok(!calls[4].url.includes(recovery.recoveryPhrase));
  assert.deepEqual(JSON.parse(String(calls[5].init.body)), change);
});

test('recuperación no solicita correo y protege las palabras y la contraseña nueva', () => {
  const html = load(renderToStaticMarkup(createElement(RecoverAccountView, {
    busy: false, error: '', username: 'Lectora', onSubmit: async () => {}, onBack() {},
  })));
  assert.equal(html('input[type="email"]').length, 0);
  assert.equal(html('input[name="username"]').attr('value'), 'Lectora');
  assert.equal(html('input[name="recoveryPhrase"]').attr('type'), 'password');
  assert.equal(html('input[name="recoveryPhrase"]').attr('spellcheck'), 'false');
  assert.equal(html('input[name="recoveryPhrase"]').attr('autocomplete'), 'off');
  assert.equal(html('input[name="password"]').attr('autocomplete'), 'new-password');
  assert.equal(html('input[name="confirmation"]').attr('autocomplete'), 'new-password');
  assert.equal(html('.auth-help-toggle').length, 2);
  assert.equal(html('.auth-help-tooltip[hidden]').length, 2);
  const hints = html('.auth-help-tooltip');
  assert.match(hints.first().text(), /sin números/);
  assert.equal(hints.last().text(), 'Entre 12 y 128 caracteres.');
  assert.equal(html('input[name="recoveryPhrase"]').attr('aria-describedby'), hints.first().attr('id'));
  assert.equal(html('input[name="password"]').attr('aria-describedby'), hints.last().attr('id'));
  assert.equal(html('button[aria-label="Mostrar confirmación de contraseña"]').attr('aria-controls'), html('input[name="confirmation"]').attr('id'));
});

test('las palabras se muestran en orden y requieren confirmar que se guardaron antes de continuar', () => {
  const phrase = 'acorn actor acute adapt admit adobe adopt afar';
  const html = load(renderToStaticMarkup(createElement(RecoveryPhraseView, {
    username: 'Lectora', phrase, reason: 'recover', onContinue() {},
  })));
  assert.deepEqual(html('.recovery-words li').map((_, element) => html(element).clone().children().remove().end().text()).get(), phrase.split(' '));
  assert.equal(html('input[type="checkbox"][required]').length, 1);
  assert.equal(html('button[type="submit"]').is('[disabled]'), true);
  assert.match(html('.recovery-notice').text(), /reemplazan las anteriores/);
  assert.equal(html('.auth-description strong').text(), 'Lectora');
});

test('el diálogo de contraseña usa los tres ojos y la ayuda oculta del registro', () => {
  const html = load(renderToStaticMarkup(createElement(ChangePasswordDialog, { onSave: async () => {}, onClose() {}, onSaved() {} })));
  assert.equal(html('[role="dialog"][aria-modal="true"]').length, 1);
  assert.equal(html('.modal-heading h2').text(), 'Cambiar contraseña');
  assert.equal(html('input[type="password"]').length, 3);
  assert.equal(html('input[name="currentPassword"]').attr('autocomplete'), 'current-password');
  assert.equal(html('input[name="newPassword"]').attr('autocomplete'), 'new-password');
  assert.equal(html('input[name="confirmation"]').attr('autocomplete'), 'new-password');
  for (const field of ['currentPassword', 'newPassword', 'confirmation']) {
    const id = html(`input[name="${field}"]`).attr('id');
    assert.equal(html('.auth-password-toggle').filter((_, element) => html(element).attr('aria-controls') === id).length, 1);
  }
  assert.equal(html('.auth-help-tooltip[hidden]').text(), 'Entre 12 y 128 caracteres.');
  assert.equal(html('button[type="submit"]').text(), 'Guardar cambios');
});
