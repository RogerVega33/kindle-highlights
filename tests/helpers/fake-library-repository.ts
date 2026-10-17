import { randomUUID } from 'node:crypto';
import type { Annotation, Book, BookDetail, BookListQuery, BooksResponse, ImportFile, ImportResult, UpdateBookInput } from '../../shared/types.js';
import { orderAnnotations } from '../../shared/annotation-order.js';
import { bookListOptions, bookPage, compareBooks, searchable } from '../../server/book-list.js';
import { decodeCover } from '../../server/covers.js';
import { RepositoryError } from '../../server/errors.js';
import { parseKindleHtml } from '../../server/parser.js';
import { annotationFingerprint, bookIdentityHash } from '../../server/import-identity.js';
import type { Cover, LibraryRepository } from '../../server/repositories/library-repository.js';
import { validateAnnotationText, validateBookMetadata } from '../../server/repositories/validation.js';

interface StoredBook {
  book: Book;
  identity: string;
  annotations: Annotation[];
  fingerprints: Set<string>;
  cover: Cover | null;
  coverRevision: number;
}

// Test double for HTTP and UI contracts. Never imported by the application.
// Persistence behavior is covered separately by PostgresRepository's SQL tests.
export class FakeLibraryRepository implements LibraryRepository {
  private readonly books = new Map<string, StoredBook>();

  private touchBook(stored: StoredBook): void {
    stored.book.updatedAt = new Date(Math.max(Date.now(), Date.parse(stored.book.updatedAt) + 1)).toISOString();
  }

  private requireBook(id: string): StoredBook {
    const stored = this.books.get(id);
    if (!stored) throw new RepositoryError('No se encontró el libro.', 404);
    return stored;
  }

  listBooks(options?: BookListQuery): BooksResponse {
    const parsed = bookListOptions(options);
    const all = [...this.books.values()].map(stored => stored.book);
    const matching = all.filter(book => !parsed.query || searchable(`${book.title} ${book.author}`).includes(parsed.query));
    const page = bookPage(parsed, {
      totalBooks: all.length,
      totalAnnotations: all.reduce((sum, book) => sum + book.highlightCount + book.noteCount, 0),
      matchingBooks: matching.length,
    });
    const offset = (page.page - 1) * page.pageSize;
    return { ...page, books: matching.sort(compareBooks(parsed.sort)).slice(offset, offset + page.pageSize).map(book => ({ ...book })) };
  }

  getBook(id: string): BookDetail {
    const stored = this.requireBook(id);
    const annotations = orderAnnotations(stored.annotations.map(annotation => ({ ...annotation })));
    return { ...stored.book, annotations };
  }

  updateBook(id: string, metadata: UpdateBookInput): Book {
    const stored = this.requireBook(id);
    const { title, author } = validateBookMetadata(metadata);
    if (stored.book.title !== title || stored.book.author !== author) {
      stored.book.title = title;
      stored.book.author = author;
      // Keep the original import identity so later exports retain these custom labels.
      this.touchBook(stored);
    }
    return { ...stored.book };
  }

  deleteBook(id: string): void {
    this.requireBook(id);
    this.books.delete(id);
  }

  updateAnnotation(bookId: string, annotationId: string, text: string): Annotation {
    const stored = this.requireBook(bookId);
    const annotation = stored.annotations.find(entry => entry.id === annotationId && entry.bookId === bookId);
    if (!annotation) throw new RepositoryError('No se encontró la anotación en este libro.', 404);
    validateAnnotationText(text);
    if (annotation.text !== text) {
      annotation.text = text;
      annotation.edited = text !== annotation.originalText;
      this.touchBook(stored);
    }
    return { ...annotation };
  }

  restoreAnnotation(bookId: string, annotationId: string): Annotation {
    const stored = this.requireBook(bookId);
    const annotation = stored.annotations.find(entry => entry.id === annotationId && entry.bookId === bookId);
    if (!annotation) throw new RepositoryError('No se encontró la anotación en este libro.', 404);
    if (annotation.edited) {
      annotation.text = annotation.originalText;
      annotation.edited = false;
      this.touchBook(stored);
    }
    return { ...annotation };
  }

  deleteAnnotation(bookId: string, annotationId: string): BookDetail {
    const stored = this.requireBook(bookId);
    const index = stored.annotations.findIndex(annotation => annotation.id === annotationId && annotation.bookId === bookId);
    if (index === -1) throw new RepositoryError('No se encontró la anotación en este libro.', 404);
    const annotation = stored.annotations[index];
    const key = annotationFingerprint(bookId, { ...annotation, text: annotation.originalText });
    stored.annotations.splice(index, 1);
    stored.fingerprints.delete(key);
    if (annotation.kind === 'highlight') stored.book.highlightCount -= 1;
    else stored.book.noteCount -= 1;
    this.touchBook(stored);
    return this.getBook(bookId);
  }

  importFiles(files: ImportFile[], bookId?: string): ImportResult[] {
    if (bookId !== undefined) this.requireBook(bookId);
    return files.map(file => {
      const result: ImportResult = { filename: file.filename, bookId: null, bookTitle: null, status: 'error', added: 0, repeated: 0, incomplete: 0, highlights: 0, notes: 0, issues: [] };
      try {
        const parsed = parseKindleHtml(file.html);
        result.bookTitle = parsed.title;
        result.incomplete = parsed.incomplete;
        result.issues = parsed.issues;
        const identity = bookIdentityHash(parsed.title, parsed.author);
        const candidates = [...this.books.values()].filter(stored => stored.identity === identity);
        if (bookId === undefined && candidates.length > 1) throw new RepositoryError('Hay varios libros coincidentes. Selecciona explícitamente el libro de destino.');
        // Explicit imports trust the chosen destination; matching the source book is not enforced yet.
        let stored = bookId === undefined ? candidates[0] : this.requireBook(bookId);
        if (!stored) {
          const now = new Date().toISOString();
          const book: Book = { id: randomUUID(), title: parsed.title, author: parsed.author, coverUrl: null, highlightCount: 0, noteCount: 0, createdAt: now, updatedAt: now };
          stored = { book, identity, annotations: [], fingerprints: new Set(), cover: null, coverRevision: 0 };
          this.books.set(book.id, stored);
        }
        result.bookId = stored.book.id;
        result.bookTitle = stored.book.title;
        for (const annotation of parsed.annotations) {
          const key = annotationFingerprint(stored.book.id, annotation);
          if (stored.fingerprints.has(key)) {
            result.repeated += 1;
            continue;
          }
          stored.fingerprints.add(key);
          stored.annotations.push({ ...annotation, originalText: annotation.text, edited: false, id: randomUUID(), bookId: stored.book.id });
          result.added += 1;
          if (annotation.kind === 'highlight') { stored.book.highlightCount += 1; result.highlights += 1; }
          else { stored.book.noteCount += 1; result.notes += 1; }
        }
        if (result.added) this.touchBook(stored);
        result.status = 'success';
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'No se pudo importar el archivo.';
      }
      return result;
    });
  }

  setCover(id: string, dataUrl: string): Book {
    const stored = this.requireBook(id);
    stored.cover = decodeCover(dataUrl);
    stored.coverRevision += 1;
    stored.book.coverUrl = `/api/books/${stored.book.id}/cover?v=${stored.coverRevision}`;
    this.touchBook(stored);
    return { ...stored.book };
  }

  deleteCover(id: string): Book {
    const stored = this.requireBook(id);
    stored.cover = null;
    stored.book.coverUrl = null;
    this.touchBook(stored);
    return { ...stored.book };
  }

  getCover(id: string): Cover | null {
    const cover = this.requireBook(id).cover;
    return cover ? { mime: cover.mime, bytes: Buffer.from(cover.bytes) } : null;
  }
}
