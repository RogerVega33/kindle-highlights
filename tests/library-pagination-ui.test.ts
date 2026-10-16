import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import type { Book } from '../shared/types.js';
import { LibraryView, type LibraryViewProps } from '../client/features/library/LibraryView.js';
import { LibraryPagination } from '../client/features/library/LibraryPagination.js';

const noop = () => {};
const books: Book[] = Array.from({ length: 36 }, (_, index) => ({
  id: `libro-${index}`, title: `Libro ficticio ${index}`, author: 'Autora ficticia', coverUrl: null,
  highlightCount: 1, noteCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}));

function renderLibrary(overrides: Partial<LibraryViewProps> = {}) {
  const props: LibraryViewProps = {
    books, page: 1, pageSize: 36, totalBooks: 1000, totalAnnotations: 461,
    matchingBooks: 1000, totalPages: 28, loading: false, loadError: '',
    headingRef: { current: null }, query: '', sort: 'recent',
    onQueryChange: noop, onSortChange: noop, onPageChange: noop, onImport: noop,
    onImportBook: noop, onOpen: noop, onCover: noop, onDelete: noop, onRetry: noop,
    ...overrides,
  };
  return load(renderToStaticMarkup(createElement(LibraryView, props)));
}

function renderPagination(page: number, totalPages = 28, matchingBooks = 1000, loading = false) {
  return load(renderToStaticMarkup(createElement(LibraryPagination, {
    page, pageSize: 36, matchingBooks, totalPages, loading, onPageChange: noop,
  })));
}

test('el contador de cada portada suma subrayados y notas como anotaciones y respeta el singular', () => {
  const entries = [
    { ...books[0], highlightCount: 3, noteCount: 1 },
    { ...books[1], highlightCount: 0, noteCount: 1 },
    { ...books[2], highlightCount: 0, noteCount: 0 },
  ];
  const html = renderLibrary({ books: entries, totalBooks: 3, totalAnnotations: 5, matchingBooks: 3, totalPages: 1 });
  assert.deepEqual(html('.book-annotation-count').map((_, element) => html(element).text()).get(), [
    '4 anotaciones', '1 anotación', '0 anotaciones',
  ]);
});

test('la biblioteca muestra solo los libros recibidos y mantiene los totales de todo el catálogo', () => {
  const html = renderLibrary();
  assert.equal(html('.book-card').length, 36);
  assert.equal(html('.library-totals').text(), '1000 libros·461 anotaciones');
  assert.equal(html('.library-page-range > [aria-hidden]').text(), '1–36 de 1000 libros');
  assert.match(html('.library-page-range .sr-only').text(), /Libros 1 a 36 de 1000\. Página 1 de 28\./);

  const filtered = renderLibrary({ query: 'búsqueda resuelta por el servidor', matchingBooks: 72, totalPages: 2 });
  assert.equal(filtered('.book-card').length, 36, 'La vista no debe volver a filtrar una página del servidor.');
  assert.equal(filtered('.library-totals').text(), '72 de 1000 libros·461 anotaciones');
  assert.equal(filtered('.library-page-range > [aria-hidden]').text(), '1–36 de 72 libros');
});

test('el paginador identifica la página actual, limita controles y desactiva los extremos', () => {
  const first = renderPagination(1);
  assert.equal(first('nav[aria-label="Páginas de la biblioteca"]').length, 1);
  assert.equal(first('[aria-current="page"]').text(), '1');
  assert.equal(first('[aria-current="page"]').attr('aria-label'), 'Página 1');
  assert.equal(first('.pagination-step').first().is('[disabled]'), true);
  assert.equal(first('.pagination-step').last().is('[disabled]'), false);
  assert.equal(first('.pagination-pages > li').length, 7);

  const middle = renderPagination(14);
  assert.deepEqual(middle('.pagination-page').map((_, button) => middle(button).text()).get(), ['1', '13', '14', '15', '28']);
  assert.equal(middle('.pagination-ellipsis').length, 2);
  assert.equal(middle('[aria-current="page"]').text(), '14');

  const last = renderPagination(28);
  assert.equal(last('.library-page-range > [aria-hidden]').text(), '973–1000 de 1000 libros');
  assert.equal(last('.pagination-step').first().is('[disabled]'), false);
  assert.equal(last('.pagination-step').last().is('[disabled]'), true);
  assert.equal(last('[aria-current="page"]').text(), '28');

  for (const page of [1, 4, 5, 500000, 999997, 1000000]) {
    const huge = renderPagination(page, 1000000, 36000000);
    assert.ok(huge('.pagination-pages > li').length <= 7, 'Un catálogo grande no debe crear miles de botones.');
    assert.equal(huge('[aria-current="page"]').text(), String(page));
    assert.equal(huge('.pagination-page').first().text(), '1');
    assert.equal(huge('.pagination-page').last().text(), '1000000');
  }
});

test('la carga desactiva toda navegación y los errores no conservan tarjetas de otra página', () => {
  const loading = renderLibrary({ loading: true });
  assert.equal(loading('.book-card').length, 0);
  assert.equal(loading('.library-loading[role="status"]').length, 1);
  assert.equal(loading('.pagination-controls button:not([disabled])').length, 0);
  assert.equal(loading('.library-page-range').text(), 'Cargando libros…');

  const failed = renderLibrary({ loadError: 'Error de prueba' });
  assert.equal(failed('.book-card').length, 0);
  assert.equal(failed('.page-error[role="alert"]').length, 1);
  assert.equal(failed('.pagination-controls').length, 0);
  assert.equal(failed('.empty-library').length, 0);
});

test('una biblioteca vacía se distingue de una búsqueda sin coincidencias y de una única página', () => {
  const empty = renderLibrary({ books: [], totalBooks: 0, totalAnnotations: 0, matchingBooks: 0, totalPages: 1 });
  assert.equal(empty('.empty-library').length, 1);
  assert.equal(empty('.no-books').length, 0);
  assert.equal(empty('.library-pagination').length, 0);

  const missing = renderLibrary({ books: [], query: 'sin coincidencias', matchingBooks: 0, totalPages: 1 });
  assert.equal(missing('.no-books').length, 1);
  assert.equal(missing('.empty-library').length, 0);
  assert.equal(missing('.library-totals').text(), '0 de 1000 libros·461 anotaciones');
  assert.equal(missing('.library-pagination').length, 0);

  const smallLibrary = renderLibrary({ books: books.slice(0, 3), totalBooks: 3, matchingBooks: 3, totalPages: 1 });
  assert.equal(smallLibrary('.book-card').length, 3);
  assert.equal(smallLibrary('.library-pagination').length, 0, 'Una única página no necesita repetir el conteo al pie.');

  const single = renderPagination(1, 1, 1);
  assert.equal(single('.library-page-range > [aria-hidden]').text(), '1–1 de 1 libro');
  assert.equal(single('.pagination-controls').length, 0);
});
