import type { Annotation, Book, BookDetail, BookListQuery, BooksResponse, ImportFile, ImportResult, RandomAnnotation, UpdateBookInput } from '../../shared/types.js';

export interface Cover {
  bytes: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
}

export type Awaitable<T> = T | Promise<T>;

export interface LibraryRepository {
  listBooks(options?: BookListQuery): Awaitable<BooksResponse>;
  getRandomAnnotation(excludeId?: string): Awaitable<RandomAnnotation | null>;
  getBook(id: string): Awaitable<BookDetail>;
  updateBook(id: string, metadata: UpdateBookInput): Awaitable<Book>;
  deleteBook(id: string): Awaitable<void>;
  updateAnnotation(bookId: string, annotationId: string, text: string): Awaitable<Annotation>;
  restoreAnnotation(bookId: string, annotationId: string): Awaitable<Annotation>;
  deleteAnnotation(bookId: string, annotationId: string): Awaitable<BookDetail>;
  importFiles(files: ImportFile[], bookId?: string): Awaitable<ImportResult[]>;
  setCover(id: string, dataUrl: string): Awaitable<Book>;
  deleteCover(id: string): Awaitable<Book>;
  getCover(id: string): Awaitable<Cover | null>;
}
