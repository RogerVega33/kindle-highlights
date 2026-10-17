import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { libraryApi } from '../client/api/library.js';
import { ApiError } from '../client/api/request.js';
import type { Annotation, Book, BookDetail, BooksResponse, ImportFile, ImportResult } from '../shared/types.js';

const bookId = 'libro/a ?#ñ';
const annotationId = 'nota/1 ?&';
const bookUrl = '/api/books/libro%2Fa%20%3F%23%C3%B1';
const annotationUrl = `${bookUrl}/annotations/nota%2F1%20%3F%26`;
const book: Book = {
  id: bookId, title: 'Un libro ficticio', author: 'Una autora', coverUrl: null,
  highlightCount: 1, noteCount: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const annotation: Annotation = {
  id: annotationId, bookId, kind: 'note', text: 'Una nota.', originalText: 'Una nota.', edited: false,
  page: 2, location: null, color: null, sectionTitle: 'Capítulo primero', chapterTitle: null, sourceOrder: 2,
};
const highlight: Annotation = {
  ...annotation, id: 'subrayado/1', kind: 'highlight', text: 'Una idea.', originalText: 'Una idea.',
  page: 1, color: 'yellow', sourceOrder: 1,
};
const detail: BookDetail = { ...book, annotations: [highlight, annotation] };
const listing: BooksResponse = {
  books: [book], page: 1, pageSize: 36, totalBooks: 1, totalAnnotations: 2,
  matchingBooks: 1, totalPages: 1,
};

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

function mockResponses(t: TestContext, responses: unknown[]): CapturedRequest[] {
  const calls: CapturedRequest[] = [];
  const remaining = [...responses];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), init });
    assert.ok(remaining.length > 0, 'No se esperaba otra solicitud HTTP.');
    return Response.json(remaining.shift());
  });
  return calls;
}

test('lectura e importación desenvuelven los resultados y conservan señales de cancelación y destino', async (t) => {
  const result: ImportResult = {
    filename: 'ejemplo.html', bookId, bookTitle: book.title, status: 'success',
    added: 2, repeated: 1, incomplete: 0, highlights: 1, notes: 1, issues: [],
  };
  const files: ImportFile[] = [{ filename: 'ejemplo.html', html: '<html>Contenido ficticio.</html>' }];
  const calls = mockResponses(t, [listing, detail, { results: [result] }, { results: [result] }]);
  const controller = new AbortController();

  assert.deepEqual(await libraryApi.listBooks({}, controller.signal), listing);
  assert.deepEqual(await libraryApi.getBook(bookId, controller.signal), detail);
  assert.deepEqual(await libraryApi.importFiles(files, bookId), [result]);
  assert.deepEqual(await libraryApi.importFiles(files), [result]);

  assert.equal(calls.length, 4);
  assert.deepEqual(calls.slice(0, 2).map(({ url, init }) => ({ url, method: init?.method ?? 'GET' })), [
    { url: '/api/books', method: 'GET' }, { url: bookUrl, method: 'GET' },
  ]);
  assert.equal(calls[0].init?.signal, controller.signal);
  assert.equal(calls[1].init?.signal, controller.signal);
  for (const call of calls.slice(0, 2)) {
    assert.equal(call.init?.body, undefined);
    assert.equal(new Headers(call.init?.headers).has('Content-Type'), false);
  }
  for (const call of calls.slice(2)) {
    assert.equal(call.url, '/api/imports');
    assert.equal(call.init?.method, 'POST');
    assert.equal(new Headers(call.init?.headers).get('Content-Type'), 'application/json');
  }
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { files, bookId });
  assert.deepEqual(JSON.parse(String(calls[3].init?.body)), { files });
});

test('la consulta paginada codifica búsqueda y orden, conserva los totales y permite cancelación', async (t) => {
  const page: BooksResponse = {
    ...listing, page: 3, totalBooks: 1000, totalAnnotations: 23456, matchingBooks: 100, totalPages: 3,
  };
  const calls = mockResponses(t, [page]);
  const controller = new AbortController();
  assert.deepEqual(await libraryApi.listBooks({ page: 3, query: 'Séneca & ?# / +', sort: 'author' }, controller.signal), page);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url, 'http://example.test');
  assert.equal(url.pathname, '/api/books');
  assert.equal(url.searchParams.get('page'), '3');
  assert.equal(url.searchParams.get('query'), 'Séneca & ?# / +');
  assert.equal(url.searchParams.get('sort'), 'author');
  assert.equal([...url.searchParams].length, 3);
  assert.equal(calls[0].init?.signal, controller.signal);
  assert.equal(calls[0].init?.body, undefined);
});

test('editar metadatos, texto y portada codifica los IDs y envía el contenido JSON sin transformarlo', async (t) => {
  const metadata = { title: '  Título personalizado  ', author: '  Autora corregida  ' };
  const text = '  Mi nota corregida.\n\nOtro párrafo.  ';
  const dataUrl = 'data:image/png;base64,AAAA';
  const editedBook = { ...book, title: 'Título personalizado', author: 'Autora corregida' };
  const editedAnnotation = { ...annotation, text, edited: true };
  const coveredBook = { ...editedBook, coverUrl: `${bookUrl}/cover?v=1` };
  const calls = mockResponses(t, [editedBook, editedAnnotation, coveredBook]);

  assert.deepEqual(await libraryApi.updateBook(bookId, metadata), editedBook);
  assert.deepEqual(await libraryApi.updateAnnotation(bookId, annotationId, text), editedAnnotation);
  assert.deepEqual(await libraryApi.setCover(bookId, dataUrl), coveredBook);

  assert.deepEqual(calls.map(({ url, init }) => ({ url, method: init?.method })), [
    { url: bookUrl, method: 'PATCH' },
    { url: annotationUrl, method: 'PATCH' },
    { url: `${bookUrl}/cover`, method: 'PUT' },
  ]);
  assert.deepEqual(calls.map(({ init }) => JSON.parse(String(init?.body))), [metadata, { text }, { dataUrl }]);
  assert.ok(calls.every(({ init }) => new Headers(init?.headers).get('Content-Type') === 'application/json'));
});

test('borrar anotaciones, portadas y libros usa sus rutas codificadas y devuelve el resultado de cada operación', async (t) => {
  const afterDelete: BookDetail = { ...book, noteCount: 0, annotations: [highlight] };
  const withoutCover = { ...book, coverUrl: null };
  const calls = mockResponses(t, [afterDelete, withoutCover, { deletedBookId: bookId }]);

  assert.deepEqual(await libraryApi.deleteAnnotation(bookId, annotationId), afterDelete);
  assert.deepEqual(await libraryApi.deleteCover(bookId), withoutCover);
  assert.equal(await libraryApi.deleteBook(bookId), undefined);

  assert.deepEqual(calls.map(({ url, init }) => ({ url, method: init?.method })), [
    { url: annotationUrl, method: 'DELETE' },
    { url: `${bookUrl}/cover`, method: 'DELETE' },
    { url: bookUrl, method: 'DELETE' },
  ]);
  assert.ok(calls.every(({ init }) => init?.body === undefined));
});

test('restaurar elimina la edición con IDs codificados y sin reenviar el texto del cliente', async t => {
  const calls = mockResponses(t, [annotation]);
  assert.deepEqual(await libraryApi.restoreAnnotation(bookId, annotationId), annotation);
  assert.equal(calls[0].url, annotationUrl + '/edit');
  assert.equal(calls[0].init?.method, 'DELETE');
  assert.equal(calls[0].init?.body, undefined);
});

test('los errores HTTP conservan sus mensajes y los fallos de red usan un texto comprensible', async (t) => {
  let respond = async (): Promise<Response> => Response.json({ message: 'El libro ya no existe.' }, { status: 404 });
  t.mock.method(globalThis, 'fetch', async () => respond());

  await assert.rejects(libraryApi.getBook(bookId), { name: 'Error', message: 'El libro ya no existe.' });
  respond = async () => Response.json({ error: 'Fallo interno' }, { status: 500 });
  await assert.rejects(libraryApi.deleteBook(bookId), {
    name: 'Error', message: 'No se pudo completar la operación. Inténtalo de nuevo.',
  });
  respond = async () => Response.json({ message: 42 }, { status: 400 });
  await assert.rejects(libraryApi.importFiles([]), {
    name: 'Error', message: 'No se pudo completar la operación. Inténtalo de nuevo.',
  });
  respond = async () => new Response('<html>Respuesta ajena a la API</html>', { status: 502 });
  await assert.rejects(libraryApi.listBooks(), {
    name: 'Error', message: 'No pudimos leer la respuesta. Inténtalo de nuevo.',
  });
  const networkError = new TypeError('Failed to fetch');
  respond = async () => { throw networkError; };
  await assert.rejects(libraryApi.listBooks(), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.message, 'No pudimos conectar con el servidor. Inténtalo de nuevo en unos momentos.');
    assert.equal(error.cause, networkError);
    return true;
  });
});

test('cancelar una solicitud no se convierte en un aviso de fallo de conexión', async t => {
  const cancellation = new DOMException('Solicitud ficticia cancelada.', 'AbortError');
  t.mock.method(globalThis, 'fetch', async () => { throw cancellation; });
  await assert.rejects(libraryApi.getBook(bookId), error => error === cancellation);
  const controller = new AbortController();
  controller.abort(cancellation);
  await assert.rejects(libraryApi.getBook(bookId, controller.signal), error => error === cancellation);
});
