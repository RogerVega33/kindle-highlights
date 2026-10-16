import { BOOKS_PER_PAGE } from '../shared/limits.js';
import type { Book, BookListQuery, BooksResponse, BookSort } from '../shared/types.js';
import { RepositoryError } from './errors.js';

export function searchable(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
}

export function bookListOptions(options: BookListQuery = {}): Required<BookListQuery> {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new RepositoryError('Los parámetros de biblioteca no son válidos.');
  const { page = 1, query = '', sort = 'recent' } = options;
  if (!Number.isSafeInteger(page) || page < 1) throw new RepositoryError('La página debe ser un entero positivo.');
  if (typeof query !== 'string') throw new RepositoryError('La búsqueda debe ser texto.');
  if (!['recent', 'title', 'author'].includes(sort)) throw new RepositoryError('El orden debe ser recent, title o author.');
  return { page, query: searchable(query.trim()), sort };
}

export function bookListHttpQuery(raw: Record<string, unknown>): Required<BookListQuery> {
  if (raw.page !== undefined && (typeof raw.page !== 'string' || !/^\d+$/.test(raw.page))) {
    throw new RepositoryError('La página debe ser un entero positivo.');
  }
  return bookListOptions({
    page: raw.page === undefined ? undefined : Number(raw.page),
    query: raw.query as string | undefined,
    sort: raw.sort as BookSort | undefined,
  });
}

// Match PostgreSQL COLLATE "C" ordering, including characters outside the BMP.
function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(searchable(left)), Buffer.from(searchable(right)));
}

export function compareBooks(sort: BookSort): (left: Book, right: Book) => number {
  return (left, right) => {
    const primary = sort === 'recent'
      ? Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      : sort === 'author' ? compareText(left.author, right.author) : 0;
    return primary || compareText(left.title, right.title) || compareText(left.id, right.id);
  };
}

export function bookPage(
  options: Required<BookListQuery>, counts: { totalBooks: number; totalAnnotations: number; matchingBooks: number },
): Omit<BooksResponse, 'books'> {
  const totalPages = Math.max(1, Math.ceil(counts.matchingBooks / BOOKS_PER_PAGE));
  return { ...counts, page: Math.min(options.page, totalPages), pageSize: BOOKS_PER_PAGE, totalPages };
}
