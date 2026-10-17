import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { buildTestApp as buildApp } from './helpers/app.js';
import { FakeLibraryRepository } from './helpers/fake-library-repository.js';
import { BOOKS_PER_PAGE } from '../shared/limits.js';
import type { Annotation, Book, BookDetail, ImportFile, ImportResult } from '../shared/types.js';

import { originalNotebook, expandedNotebook } from './helpers/notebooks.js';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6u4AAAAASUVORK5CYII=';
const pngDataUrl = `data:image/png;base64,${pngBase64}`;
const emptyLibrary = { books: [], page: 1, pageSize: BOOKS_PER_PAGE, totalBooks: 0, totalAnnotations: 0, matchingBooks: 0, totalPages: 1 };

async function appFor(t: TestContext) {
  const app = await buildApp({ repository: new FakeLibraryRepository(), serveStatic: false });
  t.after(async () => { await app.close(); });
  return app;
}

function syntheticFile(entries: string, title = 'Libro de prueba'): ImportFile {
  return {
    filename: 'prueba.html',
    html: `<!doctype html><html><body><div class="bookTitle">${title}</div><div class="authors">Autora</div>${entries}</body></html>`,
  };
}

test('la API con un repositorio ficticio vacío devuelve errores legibles para libros inexistentes', async (t) => {
  const app = await appFor(t);
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().storage, 'postgres');
  const books = await app.inject({ method: 'GET', url: '/api/books' });
  assert.equal(books.statusCode, 200);
  assert.deepEqual(books.json(), emptyLibrary);

  for (const url of ['/api/books/inexistente', '/api/books/inexistente/cover']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 404);
    assert.equal(typeof response.json().message, 'string');
  }
});

test('reimportar una exportación ampliada añade solo el nuevo subrayado y nunca borra o reemplaza lo anterior', async (t) => {
  const app = await appFor(t);
  const original = originalNotebook;
  const expanded = expandedNotebook;

  const firstResponse = await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [original] } });
  assert.equal(firstResponse.statusCode, 200);
  const first = firstResponse.json<{ results: ImportResult[] }>().results[0];
  assert.equal(first.status, 'success');
  assert.equal(first.added, 3);
  assert.equal(first.repeated, 0);
  assert.equal(first.incomplete, 0);
  assert.ok(first.bookId);
  const bookId = first.bookId;
  const before = (await app.inject({ method: 'GET', url: `/api/books/${bookId}` })).json<BookDetail>();
  assert.equal(before.highlightCount, 2);
  assert.equal(before.noteCount, 1);
  assert.equal(before.coverUrl, null);

  const second = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [expanded] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(second.bookId, bookId);
  assert.equal(second.added, 1);
  assert.equal(second.repeated, 3);

  const repeat = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [expanded] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(repeat.added, 0);
  assert.equal(repeat.repeated, 4);

  const older = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [original] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(older.added, 0);
  assert.equal(older.repeated, 3);

  const after = (await app.inject({ method: 'GET', url: `/api/books/${bookId}` })).json<BookDetail>();
  assert.equal(after.annotations.length, 4);
  assert.equal(after.highlightCount, 3);
  assert.equal(after.noteCount, 1);
  for (const annotation of before.annotations) {
    assert.deepEqual(after.annotations.find(({ id }) => id === annotation.id), annotation);
  }
  assert.equal(after.annotations.find(({ kind }) => kind === 'note')?.text, 'Primera línea.\nSegunda línea.\n\nCierre.');
  assert.equal(after.annotations.filter(({ kind, page }) => kind === 'highlight' && page === 9).length, 2);
  assert.equal((await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books.length, 1);
});

test('los nuevos subrayados se muestran en orden de página sin alterar los anteriores', async (t) => {
  const app = await appFor(t);
  const entry = (page: number, text: string) =>
    `<div class="noteHeading">Subrayado (amarillo) - Página ${page}</div><div class="noteText">${text}</div>`;
  const original = syntheticFile(entry(10, 'Página diez.') + entry(30, 'Página treinta.'));
  const expanded = syntheticFile(
    entry(5, 'Página cinco.') + entry(10, 'Página diez.') + entry(20, 'Página veinte.') + entry(30, 'Página treinta.'),
  );
  const firstResponse = await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [original] } });
  assert.equal(firstResponse.statusCode, 200);
  const first = firstResponse.json<{ results: ImportResult[] }>().results[0];
  assert.equal(first.added, 2);
  assert.equal(first.repeated, 0);
  const before = (await app.inject({ method: 'GET', url: `/api/books/${first.bookId}` })).json<BookDetail>();

  const secondResponse = await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [expanded] } });
  assert.equal(secondResponse.statusCode, 200);
  const second = secondResponse.json<{ results: ImportResult[] }>().results[0];
  assert.equal(second.bookId, first.bookId);
  assert.equal(second.added, 2);
  assert.equal(second.repeated, 2);
  const after = (await app.inject({ method: 'GET', url: `/api/books/${first.bookId}` })).json<BookDetail>();
  assert.deepEqual(after.annotations.map(({ page }) => page), [5, 10, 20, 30]);
  assert.deepEqual(after.annotations.map(({ text }) => text), ['Página cinco.', 'Página diez.', 'Página veinte.', 'Página treinta.']);
  for (const annotation of before.annotations) {
    assert.deepEqual(after.annotations.find(({ id }) => id === annotation.id), annotation);
  }
});

test('la deduplicación distingue textos y tipos diferentes en una misma ubicación', async (t) => {
  const app = await appFor(t);
  const file = syntheticFile(`
    <div class="noteHeading">Subrayado (amarillo) - Página 7 · Posición 42</div><div class="noteText">Texto primero.</div>
    <div class="noteHeading">Subrayado (amarillo) - Página 7 · Posición 42</div><div class="noteText">Texto distinto.</div>
    <div class="noteHeading">Nota - Página 7 · Posición 42</div><div class="noteText">Texto primero.</div>
  `);

  const first = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(first.added, 3);
  const second = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(second.added, 0);
  assert.equal(second.repeated, 3);
  const book = (await app.inject({ method: 'GET', url: `/api/books/${first.bookId}` })).json<BookDetail>();
  assert.equal(book.highlightCount, 2);
  assert.equal(book.noteCount, 1);
});

test('notas con distinta estructura de párrafos se conservan por separado', async (t) => {
  const app = await appFor(t);
  const multiline = syntheticFile('<div class="noteHeading">Nota - Página 7</div><div class="noteText">Primera idea.\n\nSegunda idea.</div>');
  const flattened = syntheticFile('<div class="noteHeading">Nota - Página 7</div><div class="noteText">Primera idea. Segunda idea.</div>');
  const { results } = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [multiline, flattened] } }))
    .json<{ results: ImportResult[] }>();

  assert.deepEqual(results.map(({ added, repeated }) => ({ added, repeated })), [
    { added: 1, repeated: 0 }, { added: 1, repeated: 0 },
  ]);
  const detail = (await app.inject({ method: 'GET', url: `/api/books/${results[0].bookId}` })).json<BookDetail>();
  assert.equal(detail.noteCount, 2);
  assert.deepEqual(detail.annotations.map(({ text }) => text), ['Primera idea.\n\nSegunda idea.', 'Primera idea. Segunda idea.']);
});

test('borrar notas y subrayados actualiza los contadores conservando libro, portada y otras anotaciones', async (t) => {
  const app = await appFor(t);
  const file = syntheticFile(`
    <div class="noteHeading">Subrayado - Página 2</div><div class="noteText">Primer subrayado.</div>
    <div class="noteHeading">Nota - Página 5</div><div class="noteText">Una nota personal.</div>
    <div class="noteHeading">Subrayado - Página 8</div><div class="noteText">Segundo subrayado.</div>
  `);
  const otherFile = syntheticFile('<div class="noteHeading">Nota - Página 1</div><div class="noteText">Nota de otro libro.</div>', 'Otro libro');
  const imported = await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file, otherFile] } });
  assert.equal(imported.statusCode, 200);
  const [first, other] = imported.json<{ results: ImportResult[] }>().results;
  assert.ok(first.bookId);
  assert.ok(other.bookId);
  const bookPath = `/api/books/${first.bookId}`;
  const coverPath = `${bookPath}/cover`;
  assert.equal((await app.inject({ method: 'PUT', url: coverPath, payload: { dataUrl: pngDataUrl } })).statusCode, 200);
  const before = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
  const otherBefore = (await app.inject({ method: 'GET', url: `/api/books/${other.bookId}` })).json<BookDetail>();
  const note = before.annotations.find(({ kind }) => kind === 'note');
  const highlight = before.annotations.find(({ text }) => text === 'Primer subrayado.');
  const remaining = before.annotations.find(({ text }) => text === 'Segundo subrayado.');
  assert.ok(note);
  assert.ok(highlight);
  assert.ok(remaining);

  const deleteNote = await app.inject({ method: 'DELETE', url: `${bookPath}/annotations/${note.id}` });
  assert.equal(deleteNote.statusCode, 200);
  const afterNote = deleteNote.json<BookDetail>();
  assert.equal(afterNote.noteCount, 0);
  assert.equal(afterNote.highlightCount, 2);
  assert.deepEqual(afterNote.annotations, before.annotations.filter(({ id }) => id !== note.id));

  const deleteHighlight = await app.inject({ method: 'DELETE', url: `${bookPath}/annotations/${highlight.id}` });
  assert.equal(deleteHighlight.statusCode, 200);
  const afterHighlight = deleteHighlight.json<BookDetail>();
  assert.equal(afterHighlight.noteCount, 0);
  assert.equal(afterHighlight.highlightCount, 1);
  assert.deepEqual(afterHighlight.annotations, [remaining]);
  assert.equal(afterHighlight.id, before.id);
  assert.equal(afterHighlight.title, before.title);
  assert.equal(afterHighlight.author, before.author);
  assert.equal(afterHighlight.createdAt, before.createdAt);
  assert.equal(afterHighlight.coverUrl, before.coverUrl);
  const listed = (await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books;
  assert.equal(listed.length, 2);
  assert.equal(listed.find(({ id }) => id === first.bookId)?.highlightCount, 1);
  assert.equal(listed.find(({ id }) => id === first.bookId)?.noteCount, 0);
  assert.deepEqual((await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>(), afterHighlight);
  assert.deepEqual((await app.inject({ method: 'GET', url: `/api/books/${other.bookId}` })).json<BookDetail>(), otherBefore);
  assert.deepEqual((await app.inject({ method: 'GET', url: coverPath })).rawPayload, Buffer.from(pngBase64, 'base64'));

  const deleteLast = await app.inject({ method: 'DELETE', url: `${bookPath}/annotations/${remaining.id}` });
  assert.equal(deleteLast.statusCode, 200);
  const emptyBook = deleteLast.json<BookDetail>();
  assert.equal(emptyBook.id, before.id);
  assert.equal(emptyBook.highlightCount, 0);
  assert.equal(emptyBook.noteCount, 0);
  assert.deepEqual(emptyBook.annotations, []);
  assert.equal(emptyBook.coverUrl, before.coverUrl);
  assert.equal((await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books.length, 2);
  assert.deepEqual((await app.inject({ method: 'GET', url: coverPath })).rawPayload, Buffer.from(pngBase64, 'base64'));
});

test('borrar con libro o anotación inexistentes o ajenos devuelve 404 sin cambiar otros datos', async (t) => {
  const app = await appFor(t);
  const files = [
    syntheticFile('<div class="noteHeading">Subrayado - Página 1</div><div class="noteText">Libro primero.</div>', 'Primero'),
    syntheticFile('<div class="noteHeading">Nota - Página 2</div><div class="noteText">Libro segundo.</div>', 'Segundo'),
  ];
  const { results } = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files } }))
    .json<{ results: ImportResult[] }>();
  const first = (await app.inject({ method: 'GET', url: `/api/books/${results[0].bookId}` })).json<BookDetail>();
  const second = (await app.inject({ method: 'GET', url: `/api/books/${results[1].bookId}` })).json<BookDetail>();
  const firstAnnotation = first.annotations[0];
  const secondAnnotation = second.annotations[0];

  for (const url of [
    `/api/books/inexistente/annotations/${firstAnnotation.id}`,
    `/api/books/${first.id}/annotations/inexistente`,
    `/api/books/${first.id}/annotations/${secondAnnotation.id}`,
    `/api/books/${second.id}/annotations/${firstAnnotation.id}`,
  ]) {
    const response = await app.inject({ method: 'DELETE', url });
    assert.equal(response.statusCode, 404);
    assert.equal(typeof response.json().message, 'string');
    assert.deepEqual((await app.inject({ method: 'GET', url: `/api/books/${first.id}` })).json<BookDetail>(), first);
    assert.deepEqual((await app.inject({ method: 'GET', url: `/api/books/${second.id}` })).json<BookDetail>(), second);
  }

  const deleted = await app.inject({ method: 'DELETE', url: `/api/books/${first.id}/annotations/${firstAnnotation.id}` });
  assert.equal(deleted.statusCode, 200);
  const repeated = await app.inject({ method: 'DELETE', url: `/api/books/${first.id}/annotations/${firstAnnotation.id}` });
  assert.equal(repeated.statusCode, 404);
  assert.equal(typeof repeated.json().message, 'string');
  assert.deepEqual((await app.inject({ method: 'GET', url: `/api/books/${first.id}` })).json<BookDetail>(), deleted.json<BookDetail>());
  assert.deepEqual((await app.inject({ method: 'GET', url: `/api/books/${second.id}` })).json<BookDetail>(), second);
});

test('reimportar restaura solo la nota o el subrayado borrado y conserva los demás sin duplicados', async (t) => {
  const app = await appFor(t);
  const file = syntheticFile(`
    <div class="noteHeading">Subrayado - Página 2</div><div class="noteText">Idea primera.</div>
    <div class="noteHeading">Nota - Página 3</div><div class="noteText">Mi comentario.</div>
    <div class="noteHeading">Subrayado - Página 4</div><div class="noteText">Idea segunda.</div>
  `);
  const initial = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(initial.added, 3);
  const bookPath = `/api/books/${initial.bookId}`;

  for (const kind of ['note', 'highlight'] as const) {
    const before = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
    const target = before.annotations.find((annotation) => annotation.kind === kind);
    assert.ok(target);
    const removed = await app.inject({ method: 'DELETE', url: `${bookPath}/annotations/${target.id}` });
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.json<BookDetail>().annotations.length, 2);

    const reimport = await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } });
    assert.equal(reimport.statusCode, 200);
    const restored = reimport.json<{ results: ImportResult[] }>().results[0];
    assert.equal(restored.bookId, initial.bookId);
    assert.equal(restored.added, 1);
    assert.equal(restored.repeated, 2);
    const after = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
    assert.equal(after.annotations.length, 3);
    assert.equal(after.highlightCount, 2);
    assert.equal(after.noteCount, 1);
    assert.equal(after.annotations.filter(({ kind: entryKind, text, page }) =>
      entryKind === target.kind && text === target.text && page === target.page).length, 1);
    for (const annotation of before.annotations.filter(({ id }) => id !== target.id)) {
      assert.deepEqual(after.annotations.find(({ id }) => id === annotation.id), annotation);
    }

    const repeat = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } }))
      .json<{ results: ImportResult[] }>().results[0];
    assert.equal(repeat.added, 0);
    assert.equal(repeat.repeated, 3);
  }
});

test('borrar un libro elimina sus anotaciones y portada; reimportarlo crea otro sin afectar los demás', async (t) => {
  const app = await appFor(t);
  const file = syntheticFile(`
    <div class="noteHeading">Subrayado - Página 2</div><div class="noteText">Una idea del libro.</div>
    <div class="noteHeading">Nota - Página 3</div><div class="noteText">Un comentario personal.</div>
  `, 'Libro que se elimina');
  const otherFile = syntheticFile('<div class="noteHeading">Subrayado - Página 7</div><div class="noteText">Otra idea.</div>', 'Libro que se conserva');
  const imported = await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file, otherFile] } });
  assert.equal(imported.statusCode, 200);
  const [first, other] = imported.json<{ results: ImportResult[] }>().results;
  assert.ok(first.bookId);
  assert.ok(other.bookId);
  const bookPath = `/api/books/${first.bookId}`;
  const otherPath = `/api/books/${other.bookId}`;
  for (const url of [`${bookPath}/cover`, `${otherPath}/cover`]) {
    assert.equal((await app.inject({ method: 'PUT', url, payload: { dataUrl: pngDataUrl } })).statusCode, 200);
  }
  const before = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
  const otherBefore = (await app.inject({ method: 'GET', url: otherPath })).json<BookDetail>();
  const otherCover = (await app.inject({ method: 'GET', url: `${otherPath}/cover` })).rawPayload;

  const deleted = await app.inject({ method: 'DELETE', url: bookPath });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.json(), { deletedBookId: first.bookId });
  const listed = (await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, other.bookId);
  for (const request of [
    { method: 'GET' as const, url: bookPath },
    { method: 'GET' as const, url: `${bookPath}/cover` },
    ...before.annotations.map(({ id }) => ({ method: 'DELETE' as const, url: `${bookPath}/annotations/${id}` })),
    { method: 'DELETE' as const, url: bookPath },
  ]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 404);
    assert.equal(typeof response.json().message, 'string');
  }
  assert.deepEqual((await app.inject({ method: 'GET', url: otherPath })).json<BookDetail>(), otherBefore);
  assert.deepEqual((await app.inject({ method: 'GET', url: `${otherPath}/cover` })).rawPayload, otherCover);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books, listed);

  const reimport = await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } });
  assert.equal(reimport.statusCode, 200);
  const restored = reimport.json<{ results: ImportResult[] }>().results[0];
  assert.equal(restored.status, 'success');
  assert.ok(restored.bookId);
  assert.notEqual(restored.bookId, first.bookId);
  assert.equal(restored.added, 2);
  assert.equal(restored.repeated, 0);
  const restoredPath = `/api/books/${restored.bookId}`;
  const restoredBook = (await app.inject({ method: 'GET', url: restoredPath })).json<BookDetail>();
  assert.equal(restoredBook.title, before.title);
  assert.equal(restoredBook.author, before.author);
  assert.equal(restoredBook.highlightCount, 1);
  assert.equal(restoredBook.noteCount, 1);
  assert.equal(restoredBook.coverUrl, null);
  assert.deepEqual(restoredBook.annotations.map(({ kind, text, page }) => ({ kind, text, page })),
    before.annotations.map(({ kind, text, page }) => ({ kind, text, page })));
  assert.equal((await app.inject({ method: 'GET', url: `${restoredPath}/cover` })).statusCode, 404);

  const repeated = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(repeated.bookId, restored.bookId);
  assert.equal(repeated.added, 0);
  assert.equal(repeated.repeated, 2);
  assert.deepEqual((await app.inject({ method: 'GET', url: restoredPath })).json<BookDetail>(), restoredBook);
  assert.deepEqual((await app.inject({ method: 'GET', url: otherPath })).json<BookDetail>(), otherBefore);
  assert.deepEqual((await app.inject({ method: 'GET', url: `${otherPath}/cover` })).rawPayload, otherCover);
  assert.equal((await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books.length, 2);
});

test('borrar el único libro deja la biblioteca vacía y los destinos inexistentes devuelven 404', async (t) => {
  const app = await appFor(t);
  const missing = await app.inject({ method: 'DELETE', url: '/api/books/inexistente' });
  assert.equal(missing.statusCode, 404);
  assert.equal(typeof missing.json().message, 'string');
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/books' })).json(), emptyLibrary);
  const file = syntheticFile('<div class="noteHeading">Nota - Página 1</div><div class="noteText">Una nota.</div>');
  const { bookId } = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.ok(bookId);

  const removed = await app.inject({ method: 'DELETE', url: `/api/books/${bookId}` });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.json(), { deletedBookId: bookId });
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/books' })).json(), emptyLibrary);
  assert.equal((await app.inject({ method: 'GET', url: `/api/books/${bookId}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/books/${bookId}` })).statusCode, 404);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/books' })).json(), emptyLibrary);
});

test('editar título y autor conserva las anotaciones y la portada al reimportar el origen', async (t) => {
  const app = await appFor(t);
  const entries = `
    <div class="noteHeading">Subrayado - Página 2</div><div class="noteText">Una idea original.</div>
    <div class="noteHeading">Nota - Página 3</div><div class="noteText">Mi nota\n\ncon dos párrafos.</div>
  `;
  const original = syntheticFile(entries, 'Título original');
  const expanded = syntheticFile(`${entries}<div class="noteHeading">Subrayado - Página 4</div><div class="noteText">Una idea nueva.</div>`, 'Título original');
  const initial = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [original] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(initial.added, 2);
  const bookPath = `/api/books/${initial.bookId}`;
  const coverPath = `${bookPath}/cover`;
  assert.equal((await app.inject({ method: 'PUT', url: coverPath, payload: { dataUrl: pngDataUrl } })).statusCode, 200);
  const before = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();

  const changed = await app.inject({ method: 'PATCH', url: bookPath, payload: { title: '  Mi título personalizado  ', author: '  Mi autora  ' } });
  assert.equal(changed.statusCode, 200);
  const edited = changed.json<Book>();
  assert.equal(edited.id, before.id);
  assert.equal(edited.title, 'Mi título personalizado');
  assert.equal(edited.author, 'Mi autora');
  assert.equal(edited.createdAt, before.createdAt);
  assert.equal(edited.coverUrl, before.coverUrl);
  assert.equal(edited.highlightCount, 1);
  assert.equal(edited.noteCount, 1);
  const detail = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
  assert.deepEqual(detail.annotations, before.annotations);
  assert.equal(detail.title, edited.title);
  assert.equal(detail.author, edited.author);
  const listed = (await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books;
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], edited);
  assert.deepEqual((await app.inject({ method: 'GET', url: coverPath })).rawPayload, Buffer.from(pngBase64, 'base64'));

  const repeated = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [original] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(repeated.bookId, before.id);
  assert.equal(repeated.added, 0);
  assert.equal(repeated.repeated, 2);
  assert.deepEqual((await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>(), detail);

  const expandedResult = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [expanded] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(expandedResult.bookId, before.id);
  assert.equal(expandedResult.added, 1);
  assert.equal(expandedResult.repeated, 2);
  const after = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
  assert.equal(after.title, edited.title);
  assert.equal(after.author, edited.author);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.coverUrl, before.coverUrl);
  assert.equal(after.highlightCount, 2);
  assert.equal(after.noteCount, 1);
  assert.equal(after.annotations.length, 3);
  for (const annotation of before.annotations) {
    assert.deepEqual(after.annotations.find(({ id }) => id === annotation.id), annotation);
  }
  assert.equal(after.annotations.filter(({ text }) => text === 'Una idea nueva.').length, 1);
  assert.deepEqual((await app.inject({ method: 'GET', url: coverPath })).rawPayload, Buffer.from(pngBase64, 'base64'));
});

test('dar a un libro los metadatos de otro no los fusiona ni cambia sus identidades de importación', async (t) => {
  const app = await appFor(t);
  const entriesA = '<div class="noteHeading">Subrayado - Página 1</div><div class="noteText">Idea de A.</div>';
  const entriesB = '<div class="noteHeading">Nota - Página 2</div><div class="noteText">Nota de B.</div>';
  const fileA = syntheticFile(entriesA, 'Origen A');
  const fileB = syntheticFile(entriesB, 'Origen B');
  const { results } = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [fileA, fileB] } }))
    .json<{ results: ImportResult[] }>();
  const beforeA = (await app.inject({ method: 'GET', url: `/api/books/${results[0].bookId}` })).json<BookDetail>();
  const beforeB = (await app.inject({ method: 'GET', url: `/api/books/${results[1].bookId}` })).json<BookDetail>();
  assert.notEqual(beforeA.id, beforeB.id);

  const rename = await app.inject({ method: 'PATCH', url: `/api/books/${beforeA.id}`, payload: { title: beforeB.title, author: beforeB.author } });
  assert.equal(rename.statusCode, 200);
  assert.equal(rename.json<Book>().id, beforeA.id);
  assert.deepEqual((await app.inject({ method: 'GET', url: `/api/books/${beforeB.id}` })).json<BookDetail>(), beforeB);
  assert.equal((await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books.length, 2);

  const expandedA = syntheticFile(`${entriesA}<div class="noteHeading">Nota - Página 3</div><div class="noteText">Nueva nota de A.</div>`, 'Origen A');
  const expandedB = syntheticFile(`${entriesB}<div class="noteHeading">Subrayado - Página 4</div><div class="noteText">Nueva idea de B.</div>`, 'Origen B');
  const reimport = await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [expandedA, expandedB] } });
  assert.equal(reimport.statusCode, 200);
  const imported = reimport.json<{ results: ImportResult[] }>().results;
  assert.deepEqual(imported.map(({ bookId, added, repeated }) => ({ bookId, added, repeated })), [
    { bookId: beforeA.id, added: 1, repeated: 1 },
    { bookId: beforeB.id, added: 1, repeated: 1 },
  ]);
  const afterA = (await app.inject({ method: 'GET', url: `/api/books/${beforeA.id}` })).json<BookDetail>();
  const afterB = (await app.inject({ method: 'GET', url: `/api/books/${beforeB.id}` })).json<BookDetail>();
  assert.equal(afterA.title, beforeB.title);
  assert.equal(afterA.author, beforeB.author);
  assert.equal(afterB.title, beforeB.title);
  assert.equal(afterB.author, beforeB.author);
  assert.deepEqual(afterA.annotations.find(({ id }) => id === beforeA.annotations[0].id), beforeA.annotations[0]);
  assert.deepEqual(afterB.annotations.find(({ id }) => id === beforeB.annotations[0].id), beforeB.annotations[0]);
  assert.deepEqual(afterA.annotations.map(({ text }) => text), ['Idea de A.', 'Nueva nota de A.']);
  assert.deepEqual(afterB.annotations.map(({ text }) => text), ['Nota de B.', 'Nueva idea de B.']);
  assert.equal((await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books.length, 2);
});

test('editar metadatos valida tipos y límites, acepta autor vacío y no modifica datos en errores o sin cambios', async (t) => {
  const app = await appFor(t);
  const file = syntheticFile('<div class="noteHeading">Subrayado - Página 1</div><div class="noteText">Una idea.</div>', 'Sin cambios');
  const initial = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } }))
    .json<{ results: ImportResult[] }>().results[0];
  const bookPath = `/api/books/${initial.bookId}`;
  const coverPath = `${bookPath}/cover`;
  assert.equal((await app.inject({ method: 'PUT', url: coverPath, payload: { dataUrl: pngDataUrl } })).statusCode, 200);
  const before = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
  const listBefore = (await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books;

  for (const payload of [
    {},
    { author: 'Autora' },
    { title: 'Un título' },
    { title: '', author: 'Autora' },
    { title: ' \t\n ', author: 'Autora' },
    { title: 42, author: 'Autora' },
    { title: null, author: 'Autora' },
    { title: 'Un título', author: 42 },
    { title: 'Un título', author: null },
    { title: 'T'.repeat(501), author: 'Autora' },
    { title: 'Un título', author: 'A'.repeat(301) },
  ]) {
    const response = await app.inject({ method: 'PATCH', url: bookPath, payload });
    assert.equal(response.statusCode, 400);
    assert.equal(typeof response.json().message, 'string');
    assert.deepEqual((await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>(), before);
  }
  const missing = await app.inject({ method: 'PATCH', url: '/api/books/inexistente', payload: { title: 'Válido', author: '' } });
  assert.equal(missing.statusCode, 404);
  assert.equal(typeof missing.json().message, 'string');
  const unchanged = await app.inject({ method: 'PATCH', url: bookPath, payload: { title: '  Sin cambios  ', author: '  Autora  ' } });
  assert.equal(unchanged.statusCode, 200);
  assert.deepEqual((await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>(), before);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books, listBefore);
  assert.deepEqual((await app.inject({ method: 'GET', url: coverPath })).rawPayload, Buffer.from(pngBase64, 'base64'));

  const boundary = await app.inject({ method: 'PATCH', url: bookPath, payload: { title: ` ${'T'.repeat(500)} `, author: ` ${'A'.repeat(300)} ` } });
  assert.equal(boundary.statusCode, 200);
  assert.equal(boundary.json<Book>().title, 'T'.repeat(500));
  assert.equal(boundary.json<Book>().author, 'A'.repeat(300));
  const withoutAuthor = await app.inject({ method: 'PATCH', url: bookPath, payload: { title: '  Sin autor  ', author: ' \t ' } });
  assert.equal(withoutAuthor.statusCode, 200);
  assert.equal(withoutAuthor.json<Book>().title, 'Sin autor');
  assert.equal(withoutAuthor.json<Book>().author, '');
  const after = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
  assert.deepEqual(after.annotations, before.annotations);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.coverUrl, before.coverUrl);
  assert.equal(after.highlightCount, before.highlightCount);
  assert.equal(after.noteCount, before.noteCount);
  const emptyAuthorNoop = await app.inject({ method: 'PATCH', url: bookPath, payload: { title: 'Sin autor', author: '' } });
  assert.equal(emptyAuthorNoop.statusCode, 200);
  assert.deepEqual((await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>(), after);
});

test('editar subrayados y notas conserva el original y solo la última versión sin alterar otros datos', async (t) => {
  const app = await appFor(t);
  const file = syntheticFile(`
    <div class="noteHeading">Subrayado - Página 2</div><div class="noteText">Subrayado original.</div>
    <div class="noteHeading">Nota - Página 3</div><div class="noteText">Nota original.\n\nOtro párrafo.</div>
    <div class="noteHeading">Subrayado - Página 4</div><div class="noteText">Subrayado que no cambia.</div>
  `);
  const initial = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(initial.added, 3);
  const bookPath = `/api/books/${initial.bookId}`;
  const coverPath = `${bookPath}/cover`;
  assert.equal((await app.inject({ method: 'PUT', url: coverPath, payload: { dataUrl: pngDataUrl } })).statusCode, 200);
  const before = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
  assert.ok(before.annotations.every(({ text, originalText, edited }) => originalText === text && edited === false));
  const highlight = before.annotations.find(({ text }) => text === 'Subrayado original.');
  const note = before.annotations.find(({ kind }) => kind === 'note');
  const untouched = before.annotations.find(({ text }) => text === 'Subrayado que no cambia.');
  assert.ok(highlight);
  assert.ok(note);
  assert.ok(note.text !== null);
  assert.ok(untouched);

  const firstText = '  Primera corrección.\nSegunda línea.  ';
  const firstEdit = await app.inject({ method: 'PATCH', url: `${bookPath}/annotations/${highlight.id}`, payload: { text: firstText } });
  assert.equal(firstEdit.statusCode, 200);
  const firstVersion = firstEdit.json<Annotation>();
  assert.equal(firstVersion.id, highlight.id);
  assert.equal(firstVersion.text, firstText);
  assert.equal(firstVersion.originalText, highlight.text);
  assert.equal(firstVersion.edited, true);

  const latestText = 'La última corrección del subrayado.';
  const latestEdit = await app.inject({ method: 'PATCH', url: `${bookPath}/annotations/${highlight.id}`, payload: { text: latestText } });
  assert.equal(latestEdit.statusCode, 200);
  const latestVersion = latestEdit.json<Annotation>();
  assert.equal(latestVersion.text, latestText);
  assert.equal(latestVersion.originalText, highlight.text);
  assert.equal(latestVersion.edited, true);
  assert.deepEqual({ ...latestVersion, text: highlight.text, edited: false }, highlight);
  assert.deepEqual(Object.keys(latestVersion).sort(), [
    'id', 'bookId', 'kind', 'text', 'originalText', 'edited', 'page', 'location',
    'color', 'sectionTitle', 'chapterTitle', 'sourceOrder',
  ].sort());

  const noteText = '  Nota corregida.\nOtra línea.\n\nOtro párrafo.  ';
  const changedNote = await app.inject({ method: 'PATCH', url: `${bookPath}/annotations/${note.id}`, payload: { text: noteText } });
  assert.equal(changedNote.statusCode, 200);
  const editedNote = changedNote.json<Annotation>();
  assert.equal(editedNote.id, note.id);
  assert.equal(editedNote.text, noteText);
  assert.equal(editedNote.originalText, 'Nota original.\n\nOtro párrafo.');
  assert.equal(editedNote.edited, true);
  assert.deepEqual(Object.keys(editedNote).sort(), Object.keys(latestVersion).sort());
  const after = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
  assert.equal(after.id, before.id);
  assert.equal(after.title, before.title);
  assert.equal(after.author, before.author);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.coverUrl, before.coverUrl);
  assert.equal(after.highlightCount, before.highlightCount);
  assert.equal(after.noteCount, before.noteCount);
  assert.equal(after.annotations.length, 3);
  assert.deepEqual(after.annotations.find(({ id }) => id === highlight.id), latestVersion);
  assert.deepEqual(after.annotations.find(({ id }) => id === note.id), editedNote);
  assert.deepEqual(after.annotations.find(({ id }) => id === untouched.id), untouched);
  assert.deepEqual((await app.inject({ method: 'GET', url: coverPath })).rawPayload, Buffer.from(pngBase64, 'base64'));
  const listed = (await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>().books;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].highlightCount, before.highlightCount);
  assert.equal(listed[0].noteCount, before.noteCount);

  const reverted = await app.inject({ method: 'PATCH', url: `${bookPath}/annotations/${note.id}`, payload: { text: note.text } });
  assert.equal(reverted.statusCode, 200);
  assert.deepEqual(reverted.json<Annotation>(), note);
  const final = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
  assert.deepEqual(final.annotations.find(({ id }) => id === note.id), note);
  assert.deepEqual(final.annotations.find(({ id }) => id === highlight.id), latestVersion);
  assert.equal(final.annotations.length, 3);
});

test('reimportar conserva las correcciones y borrar una anotación editada permite recuperar su original', async (t) => {
  const app = await appFor(t);
  const entries = `
    <div class="noteHeading">Subrayado - Página 2</div><div class="noteText">Idea original.</div>
    <div class="noteHeading">Nota - Página 3</div><div class="noteText">Comentario original.</div>
  `;
  const original = syntheticFile(entries);
  const expanded = syntheticFile(`${entries}<div class="noteHeading">Subrayado - Página 4</div><div class="noteText">Idea nueva.</div>`);
  const initial = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [original] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(initial.added, 2);
  const bookPath = `/api/books/${initial.bookId}`;
  assert.equal((await app.inject({ method: 'PUT', url: `${bookPath}/cover`, payload: { dataUrl: pngDataUrl } })).statusCode, 200);
  const before = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
  const edited: Annotation[] = [];
  for (const annotation of before.annotations) {
    const text = annotation.kind === 'note' ? 'Comentario corregido.\n\nSegundo párrafo.' : 'Idea corregida.';
    const response = await app.inject({ method: 'PATCH', url: `${bookPath}/annotations/${annotation.id}`, payload: { text } });
    assert.equal(response.statusCode, 200);
    edited.push(response.json<Annotation>());
  }

  for (const [file, added, repeated] of [[original, 0, 2], [expanded, 1, 2]] as const) {
    const response = await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } });
    assert.equal(response.statusCode, 200);
    const result = response.json<{ results: ImportResult[] }>().results[0];
    assert.equal(result.bookId, initial.bookId);
    assert.equal(result.added, added);
    assert.equal(result.repeated, repeated);
    const detail = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
    for (const annotation of edited) assert.deepEqual(detail.annotations.find(({ id }) => id === annotation.id), annotation);
    assert.equal(detail.coverUrl, before.coverUrl);
  }

  for (const target of edited) {
    const beforeDelete = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
    const deleted = await app.inject({ method: 'DELETE', url: `${bookPath}/annotations/${target.id}` });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json<BookDetail>().annotations.length, 2);
    const response = await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [original] } });
    assert.equal(response.statusCode, 200);
    const result = response.json<{ results: ImportResult[] }>().results[0];
    assert.equal(result.added, 1);
    assert.equal(result.repeated, 1);
    const after = (await app.inject({ method: 'GET', url: bookPath })).json<BookDetail>();
    const restored = after.annotations.find(({ kind, originalText }) => kind === target.kind && originalText === target.originalText);
    assert.ok(restored);
    assert.equal(restored.text, target.originalText);
    assert.equal(restored.edited, false);
    assert.equal(after.annotations.length, 3);
    assert.equal(after.highlightCount, 2);
    assert.equal(after.noteCount, 1);
    assert.equal(after.coverUrl, before.coverUrl);
    for (const annotation of beforeDelete.annotations.filter(({ id }) => id !== target.id)) {
      assert.deepEqual(after.annotations.find(({ id }) => id === annotation.id), annotation);
    }
  }
  const repeated = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [expanded] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(repeated.added, 0);
  assert.equal(repeated.repeated, 3);
  assert.deepEqual((await app.inject({ method: 'GET', url: `${bookPath}/cover` })).rawPayload, Buffer.from(pngBase64, 'base64'));
});

test('editar anotaciones valida el texto, rechaza IDs ajenos y conserva los datos ante errores o cambios nulos', async (t) => {
  const app = await appFor(t);
  const files = [
    syntheticFile('<div class="noteHeading">Subrayado - Página 1</div><div class="noteText">Una idea.</div>', 'Primero'),
    syntheticFile('<div class="noteHeading">Nota - Página 2</div><div class="noteText">Una nota.</div>', 'Segundo'),
  ];
  const { results } = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files } }))
    .json<{ results: ImportResult[] }>();
  const firstPath = `/api/books/${results[0].bookId}`;
  const secondPath = `/api/books/${results[1].bookId}`;
  const first = (await app.inject({ method: 'GET', url: firstPath })).json<BookDetail>();
  const second = (await app.inject({ method: 'GET', url: secondPath })).json<BookDetail>();
  const annotation = first.annotations[0];
  assert.ok(annotation.text !== null);
  const annotationPath = `${firstPath}/annotations/${annotation.id}`;

  for (const payload of [{}, { text: null }, { text: 42 }, { text: '' }, { text: '\u00a0 \n\t' }, { text: 'T'.repeat(65537) }]) {
    const response = await app.inject({ method: 'PATCH', url: annotationPath, payload });
    assert.equal(response.statusCode, 400);
    assert.equal(typeof response.json().message, 'string');
    assert.deepEqual((await app.inject({ method: 'GET', url: firstPath })).json<BookDetail>(), first);
  }
  for (const url of [
    `/api/books/inexistente/annotations/${annotation.id}`,
    `${firstPath}/annotations/inexistente`,
    `${firstPath}/annotations/${second.annotations[0].id}`,
    `${secondPath}/annotations/${annotation.id}`,
  ]) {
    const response = await app.inject({ method: 'PATCH', url, payload: { text: 'Texto válido.' } });
    assert.equal(response.statusCode, 404);
    assert.equal(typeof response.json().message, 'string');
    assert.deepEqual((await app.inject({ method: 'GET', url: firstPath })).json<BookDetail>(), first);
    assert.deepEqual((await app.inject({ method: 'GET', url: secondPath })).json<BookDetail>(), second);
  }
  const unchanged = await app.inject({ method: 'PATCH', url: annotationPath, payload: { text: annotation.text } });
  assert.equal(unchanged.statusCode, 200);
  assert.deepEqual(unchanged.json<Annotation>(), annotation);
  assert.deepEqual((await app.inject({ method: 'GET', url: firstPath })).json<BookDetail>(), first);

  const maximumText = ` ${'T'.repeat(65534)} `;
  const changed = await app.inject({ method: 'PATCH', url: annotationPath, payload: { text: maximumText } });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json<Annotation>().text, maximumText);
  assert.equal(changed.json<Annotation>().originalText, annotation.text);
  assert.equal(changed.json<Annotation>().edited, true);
  const beforeNoop = (await app.inject({ method: 'GET', url: firstPath })).json<BookDetail>();
  const editedNoop = await app.inject({ method: 'PATCH', url: annotationPath, payload: { text: maximumText } });
  assert.equal(editedNoop.statusCode, 200);
  assert.deepEqual(editedNoop.json<Annotation>(), changed.json<Annotation>());
  assert.deepEqual((await app.inject({ method: 'GET', url: firstPath })).json<BookDetail>(), beforeNoop);
  assert.deepEqual((await app.inject({ method: 'GET', url: secondPath })).json<BookDetail>(), second);
});

test('restaurar descarta la edición de notas y subrayados y conserva la identidad al reimportar', async t => {
  const app = await appFor(t);
  const file = syntheticFile('<div class="noteHeading">Subrayado - Página 1</div><div class="noteText">Idea original.</div>'
    + '<div class="noteHeading">Nota - Página 2</div><div class="noteText">Nota original.</div>');
  const imported = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } }))
    .json<{ results: ImportResult[] }>().results[0];
  const path = `/api/books/${imported.bookId}`;
  const original = (await app.inject(path)).json<BookDetail>();
  assert.equal(original.annotations.length, 2);
  for (const annotation of original.annotations) {
    const url = `${path}/annotations/${annotation.id}`;
    for (const text of ['Primera edición.', 'Última edición.']) {
      assert.equal((await app.inject({ method: 'PATCH', url, payload: { text } })).statusCode, 200);
    }
    const restored = await app.inject({ method: 'DELETE', url: url + '/edit' });
    assert.equal(restored.statusCode, 200);
    assert.deepEqual(restored.json<Annotation>(), annotation);
    const after = (await app.inject(path)).json<BookDetail>();
    assert.deepEqual(after.annotations, original.annotations);
    assert.equal(after.highlightCount, original.highlightCount);
    assert.equal(after.noteCount, original.noteCount);
    assert.ok(after.updatedAt > original.updatedAt);
    assert.equal((await app.inject({ method: 'DELETE', url: url + '/edit' })).statusCode, 200);
    assert.deepEqual((await app.inject(path)).json(), after);
  }
  const repeated = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [file] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(repeated.added, 0);
  assert.deepEqual((await app.inject(path)).json<BookDetail>().annotations, original.annotations);
  for (const url of [`${path}/annotations/inexistente/edit`, `/api/books/inexistente/annotations/${original.annotations[0].id}/edit`]) {
    assert.equal((await app.inject({ method: 'DELETE', url })).statusCode, 404);
  }
});

test('un archivo incorrecto no impide procesar los demás del mismo lote', async (t) => {
  const app = await appFor(t);
  const good = originalNotebook;
  const response = await app.inject({
    method: 'POST', url: '/api/imports',
    payload: { files: [{ filename: 'incorrecto.html', html: '<p>No es una exportación de Kindle</p>' }, good] },
  });

  assert.equal(response.statusCode, 200);
  const { results } = response.json<{ results: ImportResult[] }>();
  assert.equal(results.length, 2);
  assert.equal(results[0].status, 'error');
  assert.equal(results[0].bookId, null);
  assert.equal(typeof results[0].error, 'string');
  assert.equal(results[1].status, 'success');
  assert.equal(results[1].added, 3);
  const { books } = (await app.inject({ method: 'GET', url: '/api/books' })).json<{ books: Book[] }>();
  assert.equal(books.length, 1);
  assert.equal(books[0].title, 'Cuaderno de prueba');
});

test('un destino inexistente se rechaza sin crear ningún libro', async (t) => {
  const app = await appFor(t);
  const response = await app.inject({
    method: 'POST', url: '/api/imports',
    payload: { files: [originalNotebook], bookId: 'inexistente' },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(typeof response.json().message, 'string');
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/books' })).json(), emptyLibrary);
});

test('una portada PNG se sirve, persiste al reimportar y puede quitarse', async (t) => {
  const app = await appFor(t);
  const original = originalNotebook;
  const { bookId } = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [original] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.ok(bookId);
  const coverPath = `/api/books/${bookId}/cover`;
  const upload = await app.inject({ method: 'PUT', url: coverPath, payload: { dataUrl: pngDataUrl } });

  assert.equal(upload.statusCode, 200);
  assert.ok(upload.json<Book>().coverUrl);
  const image = await app.inject({ method: 'GET', url: coverPath });
  assert.equal(image.statusCode, 200);
  assert.match(String(image.headers['content-type']), /^image\/png/);
  assert.deepEqual(image.rawPayload, Buffer.from(pngBase64, 'base64'));

  await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [expandedNotebook] } });
  const detail = (await app.inject({ method: 'GET', url: `/api/books/${bookId}` })).json<BookDetail>();
  assert.equal(detail.coverUrl, upload.json<Book>().coverUrl);
  assert.deepEqual((await app.inject({ method: 'GET', url: coverPath })).rawPayload, image.rawPayload);

  const expanded = expandedNotebook;
  const recolored = { ...expanded, html: expanded.html.replaceAll('annotation_yellow', 'annotation_blue') };
  const changedColor = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [recolored] } }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(changedColor.added, 0);
  assert.equal(changedColor.repeated, 4);
  const preserved = (await app.inject({ method: 'GET', url: `/api/books/${bookId}` })).json<BookDetail>();
  assert.deepEqual(preserved.annotations, detail.annotations);
  assert.equal(preserved.coverUrl, detail.coverUrl);
  assert.deepEqual((await app.inject({ method: 'GET', url: coverPath })).rawPayload, image.rawPayload);

  const remove = await app.inject({ method: 'DELETE', url: coverPath });
  assert.equal(remove.statusCode, 200);
  assert.equal(remove.json<Book>().coverUrl, null);
  assert.equal((await app.inject({ method: 'GET', url: coverPath })).statusCode, 404);
});

test('portadas SVG, URL remotas y datos que no son imágenes se rechazan sin alterar la portada', async (t) => {
  const app = await appFor(t);
  const { bookId } = (await app.inject({ method: 'POST', url: '/api/imports', payload: { files: [originalNotebook] } }))
    .json<{ results: ImportResult[] }>().results[0];
  const coverPath = `/api/books/${bookId}/cover`;
  assert.equal((await app.inject({ method: 'PUT', url: coverPath, payload: { dataUrl: pngDataUrl } })).statusCode, 200);

  for (const dataUrl of [
    `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`,
    'https://example.invalid/portada.png',
    `data:image/png;base64,${Buffer.from('Esto no es un PNG').toString('base64')}`,
    'data:image/png;base64,%%%%',
  ]) {
    const response = await app.inject({ method: 'PUT', url: coverPath, payload: { dataUrl } });
    assert.ok(response.statusCode >= 400 && response.statusCode < 500);
    assert.equal(typeof response.json().message, 'string');
    assert.deepEqual((await app.inject({ method: 'GET', url: coverPath })).rawPayload, Buffer.from(pngBase64, 'base64'));
  }
});

test('la validación rechaza cuerpos incorrectos y selecciones vacías', async (t) => {
  const app = await appFor(t);
  for (const payload of [
    {},
    { files: [] },
    { files: [{ filename: 'fallo.html', html: 42 }] },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/imports', payload });
    assert.ok(response.statusCode >= 400 && response.statusCode < 500);
    assert.equal(typeof response.json().message, 'string');
  }
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/books' })).json(), emptyLibrary);
});

test('las antiguas rutas de ejemplos no están disponibles ni importan archivos', async t => {
  const repository = new FakeLibraryRepository();
  const app = await buildApp({ repository, serveStatic: true });
  t.after(async () => { await app.close(); });
  for (const request of [
    { method: 'GET' as const, url: '/api/examples' },
    { method: 'POST' as const, url: '/api/examples/import', payload: { filenames: ['cuaderno.html'] } },
  ]) assert.equal((await app.inject(request)).statusCode, 404);
  assert.equal(repository.listBooks().totalBooks, 0);
});

test('importar y reimportar más de 25 archivos conserva los libros y sus anotaciones sin duplicados', async t => {
  const app = await appFor(t);
  const files = Array.from({ length: 30 }, (_, index) => syntheticFile(
    '<div class="noteHeading">Subrayado - Página 1</div><div class="noteText">Texto ficticio.</div>'
    + '<div class="noteHeading">Nota - Página 1</div><div class="noteText">Nota ficticia.</div>',
    `Libro ficticio ${index}`,
  ));
  const payload = { files: [...files, files[0]] };
  const first = (await app.inject({ method: 'POST', url: '/api/imports', payload })).json<{ results: ImportResult[] }>().results;
  assert.equal(first.length, 31);
  assert.ok(first.every(result => result.status === 'success'));
  assert.equal(first.reduce((sum, result) => sum + result.added, 0), 60);
  assert.equal(first.reduce((sum, result) => sum + result.repeated, 0), 2);
  const before = (await app.inject('/api/books')).json<{ books: Book[] }>().books;
  assert.equal(before.length, 30);
  const second = (await app.inject({ method: 'POST', url: '/api/imports', payload })).json<{ results: ImportResult[] }>().results;
  assert.ok(second.every(result => result.status === 'success' && result.added === 0 && result.repeated === 2));
  assert.deepEqual((await app.inject('/api/books')).json<{ books: Book[] }>().books, before);
});
