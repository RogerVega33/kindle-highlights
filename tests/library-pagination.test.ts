import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTestApp as buildApp } from './helpers/app.js';
import { RepositoryError } from '../server/errors.js';
import { FakeLibraryRepository } from './helpers/fake-library-repository.js';
import { BOOKS_PER_PAGE } from '../shared/limits.js';
import type { BookListQuery, BooksResponse, ImportFile } from '../shared/types.js';

function bookFile(index: number): ImportFile {
  const number = String(index).padStart(4, '0');
  const title = `Libro ${number}${index === 999 ? ' — Árboles' : ''}`;
  const author = index === 999 ? 'Úrsula Muñoz' : `Autor ${String(index % 10).padStart(2, '0')}`;
  return {
    filename: `libro-${number}.html`,
    html: `<div class="bookTitle">${title}</div><div class="authors">${author}</div>
      <div class="noteHeading">Subrayado - Página 1</div><div class="noteText">Subrayado sintético ${number}.</div>
      ${index % 5 === 0 ? '<div class="noteHeading">Nota - Página 2</div><div class="noteText">Nota sintética.</div>' : ''}`,
  };
}

function populate(repository: FakeLibraryRepository, count: number) {
  // Import the whole synthetic corpus into the test fixture: the HTTP upload limit
  // remains independent of how many books a library may contain.
  const results = repository.importFiles(Array.from({ length: count }, (_, index) => bookFile(count - index - 1)));
  assert.ok(results.every(result => result.status === 'success'), 'Todos los libros ficticios deben importarse.');
  return results;
}

test('una biblioteca ficticia de 1000 libros pagina, ordena y busca en todo el catálogo mediante la API', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T00:00:00Z') });
  const repository = new FakeLibraryRepository();
  const results = populate(repository, 1000);
  const app = await buildApp({ repository });
  t.after(async () => { await app.close(); });
  const read = async (query = '') => {
    const response = await app.inject(`/api/books${query}`);
    assert.equal(response.statusCode, 200, response.payload);
    return response.json<BooksResponse>();
  };

  const first = await read();
  assert.equal(BOOKS_PER_PAGE, 36);
  assert.equal(first.books.length, 36);
  assert.deepEqual({ ...first, books: [] }, {
    books: [], page: 1, pageSize: 36, totalBooks: 1000, totalAnnotations: 1200, matchingBooks: 1000, totalPages: 28,
  });
  assert.equal(first.books[0].title, 'Libro 0000');
  assert.equal(first.books.at(-1)?.title, 'Libro 0035');
  assert.deepEqual(repository.listBooks(), first);

  const allIds: string[] = [];
  for (let page = 1; page <= 28; page += 1) {
    const listed = await read(`?sort=title&page=${page}`);
    assert.equal(listed.page, page);
    assert.equal(listed.books.length, page === 28 ? 28 : 36);
    assert.equal(listed.totalBooks, 1000);
    assert.equal(listed.totalAnnotations, 1200);
    assert.equal(listed.matchingBooks, 1000);
    allIds.push(...listed.books.map(book => book.id));
  }
  const byTitle = [...results].reverse().map(result => result.bookId);
  assert.deepEqual(allIds, byTitle, 'Recorrer todas las páginas debe devolver cada libro una sola vez y en orden.');
  assert.equal(new Set(allIds).size, 1000);

  const authors = await read('?sort=author&page=2');
  assert.ok(authors.books.every(book => book.author === 'Autor 00'));
  assert.deepEqual(authors.books.map(book => book.title),
    Array.from({ length: 36 }, (_, index) => `Libro ${String((index + 36) * 10).padStart(4, '0')}`));

  const targetId = results[0].bookId!;
  assert.ok(!first.books.some(book => book.id === targetId));
  for (const query of ['LIBRO 0999', 'arboles', 'URSULA MUNOZ']) {
    const found = await read(`?query=${encodeURIComponent(query)}&page=20&sort=title`);
    assert.equal(found.page, 1, 'Una búsqueda con una sola página ajusta el número solicitado.');
    assert.equal(found.totalPages, 1);
    assert.equal(found.matchingBooks, 1);
    assert.equal(found.totalBooks, 1000);
    assert.equal(found.totalAnnotations, 1200);
    assert.deepEqual(found.books.map(book => book.id), [targetId]);
  }

  const last = await read(`?sort=title&page=${Number.MAX_SAFE_INTEGER}`);
  assert.equal(last.page, 28);
  assert.equal(last.books.length, 28);
  assert.equal(last.books.at(-1)?.id, targetId);

  repository.updateBook(targetId, { title: 'Título actualizado', author: 'Autora distinta' });
  assert.equal((await read()).books[0].id, targetId, 'El orden reciente debe responder a una modificación.');
  assert.equal((await read('?query=arboles')).matchingBooks, 0);
  const renamed = await read('?query=TITULO%20ACTUALIZADO');
  assert.deepEqual(renamed.books.map(book => book.id), [targetId]);
  assert.equal(renamed.totalAnnotations, 1200);

  const missing = await read('?query=sin-coincidencias&page=28');
  assert.deepEqual(missing, {
    books: [], page: 1, pageSize: 36, totalBooks: 1000, totalAnnotations: 1200, matchingBooks: 0, totalPages: 1,
  });
});

test('eliminar el último libro de la última página ajusta la página y conserva totales generales al filtrar', async t => {
  const repository = new FakeLibraryRepository();
  populate(repository, 37);
  const app = await buildApp({ repository });
  t.after(async () => { await app.close(); });

  const before = (await app.inject('/api/books?sort=title&page=2')).json<BooksResponse>();
  assert.equal(before.page, 2);
  assert.equal(before.totalPages, 2);
  assert.equal(before.totalBooks, 37);
  assert.equal(before.totalAnnotations, 45);
  assert.equal(before.books.length, 1);
  assert.equal(before.books[0].title, 'Libro 0036');
  const removed = await app.inject({ method: 'DELETE', url: `/api/books/${before.books[0].id}` });
  assert.equal(removed.statusCode, 200);

  const after = (await app.inject('/api/books?sort=title&page=2')).json<BooksResponse>();
  assert.equal(after.page, 1);
  assert.equal(after.totalPages, 1);
  assert.equal(after.books.length, 36);
  assert.equal(after.matchingBooks, 36);
  assert.equal(after.totalBooks, 36);
  assert.equal(after.totalAnnotations, 44);
  assert.ok(!after.books.some(book => book.id === before.books[0].id));

  const found = (await app.inject('/api/books?query=libro%200035')).json<BooksResponse>();
  assert.equal(found.matchingBooks, 1);
  assert.equal(found.totalBooks, 36);
  assert.equal(found.totalAnnotations, 44);
  const detail = repository.getBook(found.books[0].id);
  const note = detail.annotations.find(annotation => annotation.kind === 'note')!;
  assert.ok(note);
  const deleted = await app.inject({ method: 'DELETE', url: `/api/books/${detail.id}/annotations/${note.id}` });
  assert.equal(deleted.statusCode, 200);
  const updated = (await app.inject('/api/books?query=libro%200035')).json<BooksResponse>();
  assert.equal(updated.totalAnnotations, 43);
  assert.equal(updated.totalBooks, 36);
  assert.equal(updated.matchingBooks, 1);
  assert.equal(updated.books[0].noteCount, 0);
  assert.equal(updated.books[0].highlightCount, 1);
});

test('los tres órdenes desempatan de forma estable por id cuando coinciden los demás criterios', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T00:00:00Z') });
  const repository = new FakeLibraryRepository();
  const results = populate(repository, 40);
  for (const result of results) repository.updateBook(result.bookId!, { title: 'Mismo título', author: 'Mismo autor' });
  const expected = results.map(result => result.bookId!).sort((left, right) => left.localeCompare(right));
  for (const sort of ['recent', 'title', 'author'] as const) {
    const first = repository.listBooks({ sort });
    const second = repository.listBooks({ sort, page: 2 });
    assert.deepEqual([...first.books, ...second.books].map(book => book.id), expected, sort);
    assert.deepEqual(repository.listBooks({ sort }), first);
  }
});

test('la API y el repositorio rechazan paginación y filtros inválidos sin modificar datos', async t => {
  const repository = new FakeLibraryRepository();
  populate(repository, 1);
  const before = repository.listBooks();
  const app = await buildApp({ repository });
  t.after(async () => { await app.close(); });

  for (const query of [
    '?page=0', '?page=-1', '?page=1.5', '?page=NaN', '?page=Infinity', '?page=9007199254740992', '?page=',
    '?page=1&page=2', '?sort=unknown', '?sort=', '?sort=title&sort=author', '?query=uno&query=dos',
  ]) {
    const response = await app.inject(`/api/books${query}`);
    assert.equal(response.statusCode, 400, query);
    assert.equal(typeof response.json().message, 'string');
  }
  const invalid: unknown[] = [
    { page: 0 }, { page: -1 }, { page: 1.5 }, { page: Number.NaN }, { page: Number.POSITIVE_INFINITY },
    { page: Number.MAX_SAFE_INTEGER + 1 }, { page: '2' }, { page: null },
    { query: 12 }, { query: null }, { sort: 'unknown' }, { sort: null },
  ];
  for (const query of invalid) assert.throws(() => repository.listBooks(query as BookListQuery),
    error => error instanceof RepositoryError && error.statusCode === 400);
  assert.deepEqual(repository.listBooks(), before);
});
