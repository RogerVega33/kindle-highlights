import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { BookCover } from '../client/components/BookCover.js';
import type { Book } from '../shared/types.js';

const book: Book = {
  id: 'sintetico', title: 'Título', author: 'Autora', coverUrl: '/api/books/sintetico/cover?v=1',
  highlightCount: 1, noteCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function imageSource(value: Book) {
  return load(renderToStaticMarkup(createElement(BookCover, { book: value })))('img').attr('src');
}

test('editar metadatos no invalida una portada y cambiar su versión sí actualiza la imagen', () => {
  assert.equal(imageSource(book), book.coverUrl);
  assert.equal(imageSource({ ...book, title: 'Corregido', updatedAt: '2026-01-02T00:00:00Z' }), book.coverUrl);
  const newCover = '/api/books/sintetico/cover?v=2';
  assert.equal(imageSource({ ...book, coverUrl: newCover }), newCover);
});

test('quitar una portada muestra el título provisional en lugar de mantener la imagen anterior', () => {
  const html = load(renderToStaticMarkup(createElement(BookCover, { book: { ...book, coverUrl: null } })));
  assert.equal(html('img').length, 0);
  assert.equal(html('.cover-title').text(), book.title);
});
