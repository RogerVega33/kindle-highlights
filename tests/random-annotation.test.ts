import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import type { RandomAnnotation, RandomAnnotationResponse } from '../shared/types.js';
import { buildTestApp } from './helpers/app.js';
import { FakeLibraryRepository } from './helpers/fake-library-repository.js';
import { notebook } from './helpers/notebooks.js';
import { libraryApi } from '../client/api/library.js';
import { RandomAnnotationDialogView } from '../client/features/annotations/RandomAnnotationDialog.js';

test('la API sortea toda la biblioteca, respeta la última edición y Nueva evita la anterior', async t => {
  const repository = new FakeLibraryRepository();
  const app = await buildTestApp({ repository });
  t.after(() => app.close());
  const empty = await app.inject('/api/books/random-annotation');
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json(), { selection: null });
  assert.equal(empty.headers['cache-control'], 'no-store');

  const [imported] = repository.importFiles([{ filename: 'uno.html', html: notebook(
    '<div class="noteHeading">Nota - Posición 20</div><div class="noteText">Texto inicial.</div>', 'Primer libro',
  ) }]);
  const original = repository.getBook(imported.bookId!).annotations[0];
  repository.updateAnnotation(original.bookId, original.id, 'Texto editado.');
  const only = (await app.inject('/api/books/random-annotation?exclude=' + original.id)).json<RandomAnnotationResponse>().selection!;
  assert.equal(only.annotation.id, original.id, 'Una sola anotación sigue estando disponible.');
  assert.equal(only.annotation.text, 'Texto editado.');
  assert.equal(only.annotation.edited, true);

  // Más libros de los que caben en una página: la selección no depende del listado visible.
  for (let index = 0; index < 37; index++) repository.importFiles([{ filename: 'otro.html', html: notebook(
    '<div class="noteHeading">Subrayado - Página 4</div><div class="noteText">Otro texto.</div>', 'Libro ' + index,
  ) }]);
  const eligible = repository.listBooks({ page: 1 }).books;
  assert.equal(eligible.length, 36);
  const ids = new Set<string>();
  for (let index = 0; index < 38; index++) {
    const page = repository.listBooks({ page: Math.floor(index / 36) + 1 });
    const book = page.books[index % 36];
    ids.add(repository.getBook(book.id).annotations[0].id);
  }
  let previous = original.id;
  for (let index = 0; index < 12; index++) {
    const response = await app.inject('/api/books/random-annotation?exclude=' + previous);
    assert.equal(response.statusCode, 200);
    const next = response.json<RandomAnnotationResponse>().selection!;
    assert.ok(ids.has(next.annotation.id));
    assert.notEqual(next.annotation.id, previous);
    assert.equal(next.book.id, next.annotation.bookId);
    previous = next.annotation.id;
  }
  for (const query of ['exclude=inválido', 'exclude=', 'exclude=a&exclude=b']) {
    assert.equal((await app.inject('/api/books/random-annotation?' + query)).statusCode, 400);
  }
});

test('el cliente envía la exclusión y la cancelación usando una lectura con cookies', async t => {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json({ selection: null });
  });
  const controller = new AbortController();
  assert.equal(await libraryApi.getRandomAnnotation(), null);
  await libraryApi.getRandomAnnotation('id con espacios', controller.signal);
  assert.equal(calls[0].url, '/api/books/random-annotation');
  assert.equal(calls[1].url, '/api/books/random-annotation?exclude=id+con+espacios');
  assert.equal(calls[1].init.signal, controller.signal);
  assert.ok(calls.every(call => call.init.credentials === 'same-origin' && !call.init.body && !call.init.method));
});

const selection: RandomAnnotation = {
  book: { id: 'libro', title: 'Libro ficticio', author: 'Autora ficticia' },
  annotation: { id: 'anotación', bookId: 'libro', kind: 'highlight', text: 'Una idea.\nOtro párrafo.',
    originalText: 'Una idea.', edited: true, page: null, location: 20, color: 'blue',
    sectionTitle: null, chapterTitle: 'Un capítulo', sourceOrder: 1 },
};
function renderDialog(overrides: Partial<Parameters<typeof RandomAnnotationDialogView>[0]> = {}) {
  return load(renderToStaticMarkup(createElement(RandomAnnotationDialogView, {
    selection, loading: false, error: '', onClose() {}, onNew() {}, onOpenBook() {}, ...overrides,
  })));
}

test('el popup muestra la cita destacada y su procedencia con las dos acciones del nuevo diseño', () => {
  const html = renderDialog();
  assert.equal(html('[role="dialog"][aria-modal="true"]').length, 1);
  assert.equal(html('.modal-heading h2').text(), 'Anotación aleatoria');
  assert.equal(html('.random-annotation-book').text(), 'Libro ficticio');
  assert.equal(html('.random-annotation-source-details').text(), 'Autora ficticia · Posición 20');
  assert.equal(html('.random-annotation-kind').text(), 'Subrayado');
  assert.equal(html('.random-annotation-chapter').text(), 'Un capítulo');
  assert.equal(html('blockquote.random-annotation-quote').text(), selection.annotation.text);
  assert.equal(html('.annotation-card, textarea').length, 0);
  assert.equal(html('button[aria-label="Cerrar"]').length, 1);
  assert.deepEqual(html('.modal-footer button').map((_, button) => html(button).text()).get(), ['Abrir libro', 'Otra anotación']);
  assert.equal(html('.modal-footer .button-outline svg.lucide-book-open').length, 1);
  assert.equal(html('.modal-footer .button-primary svg.lucide-refresh-cw').length, 1);

  const note = renderDialog({ selection: { ...selection, annotation: { ...selection.annotation, kind: 'note', chapterTitle: null } } });
  assert.equal(note('.random-annotation-kind--note').text(), 'Nota');
  assert.equal(note('.random-annotation-chapter').length, 0);
});

test('carga, errores y biblioteca vacía mantienen una salida y una forma de reintentar', () => {
  const empty = renderDialog({ selection: null });
  assert.match(empty('.random-annotation-content').text(), /Todavía no tienes anotaciones/);
  assert.equal(empty('.button-outline').is('[disabled]'), true);
  const loading = renderDialog({ loading: true });
  assert.equal(loading('.random-annotation-content').attr('aria-busy'), 'true');
  assert.equal(loading('.modal-footer button[disabled]').length, 2);
  assert.equal(loading('button[aria-label="Cerrar"]').is('[disabled]'), false);
  const failed = renderDialog({ error: 'Error ficticio' });
  assert.equal(failed('[role="alert"]').text().includes('Error ficticio'), true);
  assert.equal(failed('.random-annotation-quote').text(), selection.annotation.text);
  assert.equal(failed('.button-primary').is('[disabled]'), false);
});
