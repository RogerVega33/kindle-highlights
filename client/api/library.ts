import type { Annotation, Book, BookDetail, BookListQuery, BooksResponse, DeleteBookResponse, ImportFile, ImportRequest, ImportResponse, ImportResult, SetCoverInput, UpdateAnnotationInput, UpdateBookInput } from '../../shared/types';

import { request } from './request';

const bookPath = (id: string) => '/api/books/' + encodeURIComponent(id);
const annotationPath = (bookId: string, id: string) => bookPath(bookId) + '/annotations/' + encodeURIComponent(id);

export const libraryApi = {
  listBooks(options: BookListQuery = {}, signal?: AbortSignal): Promise<BooksResponse> {
    const params = new URLSearchParams();
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.query !== undefined) params.set('query', options.query);
    if (options.sort !== undefined) params.set('sort', options.sort);
    const query = params.toString();
    return request('/api/books' + (query ? '?' + query : ''), { signal });
  },
  getBook(id: string, signal?: AbortSignal): Promise<BookDetail> {
    return request(bookPath(id), { signal });
  },
  async importFiles(files: ImportFile[], bookId?: string): Promise<ImportResult[]> {
    const payload: ImportRequest = { files, ...(bookId !== undefined ? { bookId } : {}) };
    return (await request<ImportResponse>('/api/imports', {
      method: 'POST', body: JSON.stringify(payload),
    })).results;
  },
  updateBook(id: string, metadata: UpdateBookInput): Promise<Book> {
    return request(bookPath(id), { method: 'PATCH', body: JSON.stringify(metadata) });
  },
  async deleteBook(id: string): Promise<void> {
    await request<DeleteBookResponse>(bookPath(id), { method: 'DELETE' });
  },
  updateAnnotation(bookId: string, id: string, text: string): Promise<Annotation> {
    const payload: UpdateAnnotationInput = { text };
    return request(annotationPath(bookId, id), { method: 'PATCH', body: JSON.stringify(payload) });
  },
  deleteAnnotation(bookId: string, id: string): Promise<BookDetail> {
    return request(annotationPath(bookId, id), { method: 'DELETE' });
  },
  restoreAnnotation(bookId: string, id: string): Promise<Annotation> {
    return request(annotationPath(bookId, id) + '/edit', { method: 'DELETE' });
  },
  setCover(id: string, dataUrl: string): Promise<Book> {
    const payload: SetCoverInput = { dataUrl };
    return request(bookPath(id) + '/cover', { method: 'PUT', body: JSON.stringify(payload) });
  },
  deleteCover(id: string): Promise<Book> {
    return request(bookPath(id) + '/cover', { method: 'DELETE' });
  },
};
