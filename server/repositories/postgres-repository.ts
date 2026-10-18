import { randomUUID } from 'node:crypto';
import type { Annotation, Book, BookDetail, BookListQuery, BooksResponse, ImportFile, ImportResult, RandomAnnotation, UpdateBookInput } from '../../shared/types.js';
import { orderAnnotations } from '../../shared/annotation-order.js';
import { bookListOptions, bookPage } from '../book-list.js';
import { decodeCover } from '../covers.js';
import type { DatabaseClient, DatabaseExecutor, DatabasePool } from '../db/types.js';
import { RepositoryError } from '../errors.js';
import { annotationFingerprint, bookIdentityHash } from '../import-identity.js';
import { importedDisplayTitle } from '../import-title.js';
import { parseKindleHtml, type ParsedAnnotation, type ParsedBook } from '../parser.js';
import { SQL_MARK_PATTERN, sqlSearchable } from '../sql-search.js';
import type { Cover, LibraryRepository } from './library-repository.js';
import { validateAnnotationText, validateBookMetadata } from './validation.js';
import type { DiagnosticLogger } from '../logging.js';

type BookRow = {
  id: string;
  title: string;
  author: string;
  cover_version: string | null;
  highlight_count: string | number;
  note_count: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type AnnotationRow = {
  id: string;
  book_id: string;
  kind: Annotation['kind'];
  original_text: string | null;
  edited_text: string | null;
  page: string | number | null;
  location: string | number | null;
  color: Annotation['color'];
  section_title: string | null;
  chapter_title: string | null;
  source_order: number;
};

const BOOK_SELECT = `
  SELECT b.id, b.title, b.author, b.created_at, b.updated_at,
    c.version AS cover_version,
    (SELECT count(*) FROM annotations a WHERE a.book_id = b.id AND a.kind = 'highlight') AS highlight_count,
    (SELECT count(*) FROM annotations a WHERE a.book_id = b.id AND a.kind = 'note') AS note_count
  FROM books b
  LEFT JOIN book_covers c ON c.book_id = b.id`;

const ANNOTATION_COLUMNS = `a.id, a.book_id, a.kind, a.original_text, a.edited_text,
  a.page, a.location, a.color, a.section_title, a.chapter_title, a.source_order`;

function requireUuid(id: string, message = 'No se encontró el libro.'): void {
  if (typeof id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) {
    throw new RepositoryError(message, 404);
  }
}

function asNumber(value: string | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('La base devolvió un entero fuera del rango admitido.');
  return result;
}

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    coverUrl: row.cover_version ? `/api/books/${row.id}/cover?v=${row.cover_version}` : null,
    highlightCount: asNumber(row.highlight_count),
    noteCount: asNumber(row.note_count),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    bookId: row.book_id,
    kind: row.kind,
    text: row.edited_text ?? row.original_text,
    originalText: row.original_text,
    edited: row.edited_text !== null,
    page: row.page === null ? null : asNumber(row.page),
    location: row.location === null ? null : asNumber(row.location),
    color: row.color,
    sectionTitle: row.section_title,
    chapterTitle: row.chapter_title,
    sourceOrder: row.source_order,
  };
}

/** Persistence for one explicitly selected user; constructing it never opens a connection. */
export class PostgresRepository implements LibraryRepository {
  constructor(private readonly pool: DatabasePool, private readonly userId: string, private readonly logger?: DiagnosticLogger) {
    requireUuid(userId, 'No se encontró el usuario.');
  }

  private async transaction<T>(operation: (client: DatabaseClient) => Promise<T>, readOnly = false): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { this.logger?.error({ event: 'database.rollback_failed', err: rollbackError }); }
      throw error;
    } finally {
      client.release();
    }
  }

  private async findBook(executor: DatabaseExecutor, id: string): Promise<Book> {
    requireUuid(id);
    const { rows } = await executor.query<BookRow>(`${BOOK_SELECT} WHERE b.id = $1 AND b.user_id = $2`, [id, this.userId]);
    if (!rows[0]) throw new RepositoryError('No se encontró el libro.', 404);
    return toBook(rows[0]);
  }

  // All related writes take this lock first, including imports. Counts are read after the mutation.
  private async lockBook(executor: DatabaseExecutor, id: string): Promise<string> {
    requireUuid(id);
    const { rows } = await executor.query<{ id: string }>(
      'SELECT b.id FROM books b WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE', [id, this.userId],
    );
    if (!rows[0]) throw new RepositoryError('No se encontró el libro.', 404);
    return rows[0].id;
  }

  private async touchBook(executor: DatabaseExecutor, id: string): Promise<void> {
    await executor.query(`UPDATE books SET updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE id = $1 AND user_id = $2`, [id, this.userId]);
  }

  private async detail(executor: DatabaseExecutor, id: string): Promise<BookDetail> {
    const book = await this.findBook(executor, id);
    const { rows } = await executor.query<AnnotationRow>(`SELECT ${ANNOTATION_COLUMNS}
      FROM annotations a JOIN books b ON b.id = a.book_id
      WHERE a.book_id = $1 AND b.user_id = $2 ORDER BY a.insertion_order`, [id, this.userId]);
    return { ...book, annotations: orderAnnotations(rows.map(toAnnotation)) };
  }

  async listBooks(options?: BookListQuery): Promise<BooksResponse> {
    const parsed = bookListOptions(options);
    const search = sqlSearchable("b.title || ' ' || b.author");
    const title = `${sqlSearchable('b.title')} COLLATE "C"`;
    const author = `${sqlSearchable('b.author')} COLLATE "C"`;
    const order = parsed.sort === 'author' ? `${author}, ${title}, b.id`
      : parsed.sort === 'title' ? `${title}, b.id` : `b.updated_at DESC, ${title}, b.id`;
    return this.transaction(async client => {
      const { rows: counts } = await client.query<{
        total_books: string | number; total_annotations: string | number; matching_books: string | number;
      }>(`WITH library AS (SELECT id, title, author FROM books WHERE user_id = $1)
        SELECT count(*) AS total_books,
          count(*) FILTER (WHERE $2 = '' OR strpos(${search}, $2) > 0) AS matching_books,
          (SELECT count(*) FROM annotations a JOIN library owned ON owned.id = a.book_id) AS total_annotations
        FROM library b`, [this.userId, parsed.query, SQL_MARK_PATTERN]);
      const page = bookPage(parsed, {
        totalBooks: asNumber(counts[0].total_books),
        totalAnnotations: asNumber(counts[0].total_annotations),
        matchingBooks: asNumber(counts[0].matching_books),
      });
      const { rows } = await client.query<BookRow>(`${BOOK_SELECT}
        WHERE b.user_id = $1 AND ($2 = '' OR strpos(${search}, $2) > 0)
        ORDER BY ${order} LIMIT $4 OFFSET $5`,
      [this.userId, parsed.query, SQL_MARK_PATTERN, page.pageSize, (page.page - 1) * page.pageSize]);
      return { ...page, books: rows.map(toBook) };
    }, true);
  }

  async getRandomAnnotation(excludeId?: string): Promise<RandomAnnotation | null> {
    if (excludeId !== undefined) requireUuid(excludeId, 'La anotación no es válida.');
    const { rows } = await this.pool.query<AnnotationRow & { book_title: string; book_author: string }>(
      `SELECT ${ANNOTATION_COLUMNS}, b.title AS book_title, b.author AS book_author
        FROM annotations a JOIN books b ON b.id = a.book_id
        WHERE b.user_id = $1 AND NULLIF(btrim(COALESCE(a.edited_text, a.original_text)), '') IS NOT NULL
        ORDER BY CASE WHEN a.id = $2::uuid THEN 1 ELSE 0 END, random() LIMIT 1`,
      [this.userId, excludeId ?? null],
    );
    const row = rows[0];
    return row ? {
      book: { id: row.book_id, title: row.book_title, author: row.book_author },
      annotation: toAnnotation(row),
    } : null;
  }

  async getBook(id: string): Promise<BookDetail> {
    requireUuid(id);
    return this.transaction(client => this.detail(client, id), true);
  }

  async updateBook(id: string, metadata: UpdateBookInput): Promise<Book> {
    requireUuid(id);
    return this.transaction(async client => {
      await this.lockBook(client, id);
      const { title, author } = validateBookMetadata(metadata);
      await client.query(`UPDATE books SET title = $3, author = $4,
        updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
        WHERE id = $1 AND user_id = $2 AND (title, author) IS DISTINCT FROM ($3, $4)`, [id, this.userId, title, author]);
      return this.findBook(client, id);
    });
  }

  async deleteBook(id: string): Promise<void> {
    requireUuid(id);
    const { rowCount } = await this.pool.query('DELETE FROM books WHERE id = $1 AND user_id = $2', [id, this.userId]);
    if (!rowCount) throw new RepositoryError('No se encontró el libro.', 404);
  }

  async updateAnnotation(bookId: string, annotationId: string, value: string): Promise<Annotation> {
    requireUuid(bookId);
    requireUuid(annotationId, 'No se encontró la anotación en este libro.');
    return this.transaction(async client => {
      await this.lockBook(client, bookId);
      const { rows: previous } = await client.query<AnnotationRow>(`SELECT ${ANNOTATION_COLUMNS}
        FROM annotations a JOIN books b ON b.id = a.book_id
        WHERE a.id = $1 AND a.book_id = $2 AND b.user_id = $3`, [annotationId, bookId, this.userId]);
      if (!previous[0]) throw new RepositoryError('No se encontró la anotación en este libro.', 404);
      const text = validateAnnotationText(value);
      if ((previous[0].edited_text ?? previous[0].original_text) === text) return toAnnotation(previous[0]);
      const { rows } = await client.query<AnnotationRow>(`UPDATE annotations a
        SET edited_text = NULLIF($4, a.original_text), updated_at = clock_timestamp()
        FROM books b WHERE a.id = $1 AND a.book_id = $2 AND b.id = a.book_id AND b.user_id = $3
        RETURNING ${ANNOTATION_COLUMNS}`, [annotationId, bookId, this.userId, text]);
      await this.touchBook(client, bookId);
      return toAnnotation(rows[0]);
    });
  }

  async restoreAnnotation(bookId: string, annotationId: string): Promise<Annotation> {
    requireUuid(bookId);
    requireUuid(annotationId, 'No se encontró la anotación en este libro.');
    return this.transaction(async client => {
      await this.lockBook(client, bookId);
      const { rows: previous } = await client.query<AnnotationRow>(`SELECT ${ANNOTATION_COLUMNS}
        FROM annotations a JOIN books b ON b.id = a.book_id
        WHERE a.id = $1 AND a.book_id = $2 AND b.user_id = $3`, [annotationId, bookId, this.userId]);
      if (!previous[0]) throw new RepositoryError('No se encontró la anotación en este libro.', 404);
      if (previous[0].edited_text === null) return toAnnotation(previous[0]);
      const { rows } = await client.query<AnnotationRow>(`UPDATE annotations a
        SET edited_text = NULL, updated_at = clock_timestamp()
        FROM books b WHERE a.id = $1 AND a.book_id = $2 AND b.id = a.book_id AND b.user_id = $3
        RETURNING ${ANNOTATION_COLUMNS}`, [annotationId, bookId, this.userId]);
      await this.touchBook(client, bookId);
      return toAnnotation(rows[0]);
    });
  }

  async deleteAnnotation(bookId: string, annotationId: string): Promise<BookDetail> {
    requireUuid(bookId);
    requireUuid(annotationId, 'No se encontró la anotación en este libro.');
    return this.transaction(async client => {
      await this.lockBook(client, bookId);
      const { rowCount } = await client.query(`DELETE FROM annotations a USING books b
        WHERE a.id = $1 AND a.book_id = $2 AND b.id = a.book_id AND b.user_id = $3`, [annotationId, bookId, this.userId]);
      if (!rowCount) throw new RepositoryError('No se encontró la anotación en este libro.', 404);
      await this.touchBook(client, bookId);
      return this.detail(client, bookId);
    });
  }

  private async importBook(client: DatabaseClient, parsed: ParsedBook, explicitId?: string): Promise<string> {
    if (explicitId !== undefined) {
      return this.lockBook(client, explicitId);
    }
    const identityHash = bookIdentityHash(parsed.title, parsed.author);
    const { rows: inserted } = await client.query<{ id: string }>(`INSERT INTO books
      (id, user_id, title, author, original_title, original_author, identity_hash)
      VALUES ($1, $2, $3, $4, $5, $4, $6)
      ON CONFLICT (user_id, identity_hash) DO NOTHING RETURNING id`,
    [randomUUID(), this.userId, importedDisplayTitle(parsed.title), parsed.author, parsed.title, identityHash]);
    const id = inserted[0]?.id ?? (await client.query<{ id: string }>(
      'SELECT id FROM books WHERE user_id = $1 AND identity_hash = $2', [this.userId, identityHash],
    )).rows[0]?.id;
    if (!id) throw new RepositoryError('No se encontró el libro.', 404);
    await this.lockBook(client, id);
    return id;
  }

  private async insertAnnotations(client: DatabaseClient, bookId: string, annotations: ParsedAnnotation[]): Promise<Annotation['kind'][]> {
    const insertedKinds: Annotation['kind'][] = [];
    // Stay well below PostgreSQL's parameter limit for unusually large exports.
    for (let start = 0; start < annotations.length; start += 500) {
      const values: unknown[] = [];
      const tuples = annotations.slice(start, start + 500).map(annotation => {
        const offset = values.length;
        values.push(randomUUID(), bookId, annotation.kind, annotation.text, annotation.page,
          annotation.location, annotation.color, annotation.sectionTitle, annotation.chapterTitle,
          annotation.sourceOrder, annotationFingerprint(bookId, annotation));
        const types = ['uuid', 'uuid', 'text', 'text', 'bigint', 'bigint', 'text', 'text', 'text', 'integer', 'text'];
        return `(${types.map((type, i) => `$${offset + i + 1}::${type}`).join(', ')})`;
      });
      const { rows } = await client.query<{ kind: Annotation['kind'] }>(`INSERT INTO annotations
        (id, book_id, kind, original_text, page, location, color, section_title, chapter_title, source_order, fingerprint)
        SELECT imported.* FROM (VALUES ${tuples.join(', ')}) AS imported
        (id, book_id, kind, original_text, page, location, color, section_title, chapter_title, source_order, fingerprint)
        JOIN books b ON b.id = imported.book_id::uuid AND b.user_id = $${values.length + 1}
        WHERE true
        ON CONFLICT (book_id, fingerprint) DO NOTHING RETURNING kind`, [...values, this.userId]);
      insertedKinds.push(...rows.map(row => row.kind));
    }
    return insertedKinds;
  }

  async importFiles(files: ImportFile[], bookId?: string): Promise<ImportResult[]> {
    if (bookId !== undefined) await this.findBook(this.pool, bookId);
    const results: ImportResult[] = [];
    for (const [index, file] of files.entries()) {
      const result: ImportResult = { filename: file.filename, bookId: null, bookTitle: null, status: 'error',
        added: 0, repeated: 0, incomplete: 0, highlights: 0, notes: 0, issues: [] };
      let parsed: ParsedBook;
      try {
        parsed = parseKindleHtml(file.html);
        result.bookTitle = parsed.title;
        result.incomplete = parsed.incomplete;
        result.issues = parsed.issues;
      } catch (error) {
        this.logger?.warn({ event: 'import.parse_failed', fileIndex: index + 1, err: error });
        result.error = error instanceof Error ? error.message : 'No se pudo importar el archivo.';
        results.push(result);
        continue;
      }
      try {
        const imported = await this.transaction(async client => {
          const id = await this.importBook(client, parsed, bookId);
          const kinds = await this.insertAnnotations(client, id, parsed.annotations);
          if (kinds.length) await this.touchBook(client, id);
          return { book: await this.findBook(client, id), kinds };
        });
        result.bookId = imported.book.id;
        result.bookTitle = imported.book.title;
        result.added = imported.kinds.length;
        result.repeated = parsed.annotations.length - result.added;
        result.highlights = imported.kinds.filter(kind => kind === 'highlight').length;
        result.notes = result.added - result.highlights;
        result.status = 'success';
      } catch (error) {
        this.logger?.error({ event: 'import.storage_failed', fileIndex: index + 1, err: error });
        result.error = error instanceof RepositoryError ? error.message : 'No se pudo guardar la importación.';
      }
      results.push(result);
    }
    return results;
  }

  async setCover(id: string, dataUrl: string): Promise<Book> {
    requireUuid(id);
    return this.transaction(async client => {
      await this.lockBook(client, id);
      const cover = decodeCover(dataUrl);
      await client.query(`INSERT INTO book_covers (book_id, data, mime_type, version)
        SELECT b.id, $3, $4, $5 FROM books b WHERE b.id = $1 AND b.user_id = $2
        ON CONFLICT (book_id) DO UPDATE SET data = EXCLUDED.data, mime_type = EXCLUDED.mime_type,
          version = EXCLUDED.version, updated_at = clock_timestamp()`, [id, this.userId, cover.bytes, cover.mime, randomUUID()]);
      await this.touchBook(client, id);
      return this.findBook(client, id);
    });
  }

  async deleteCover(id: string): Promise<Book> {
    requireUuid(id);
    return this.transaction(async client => {
      await this.lockBook(client, id);
      await client.query(`DELETE FROM book_covers c USING books b
        WHERE c.book_id = $1 AND b.id = c.book_id AND b.user_id = $2`, [id, this.userId]);
      await this.touchBook(client, id);
      return this.findBook(client, id);
    });
  }

  async getCover(id: string): Promise<Cover | null> {
    requireUuid(id);
    const { rows } = await this.pool.query<{ id: string; data: Buffer | null; mime_type: Cover['mime'] | null }>(`SELECT b.id, c.data, c.mime_type
      FROM books b LEFT JOIN book_covers c ON c.book_id = b.id
      WHERE b.id = $1 AND b.user_id = $2`, [id, this.userId]);
    if (!rows[0]) throw new RepositoryError('No se encontró el libro.', 404);
    return rows[0].data && rows[0].mime_type ? { bytes: Buffer.from(rows[0].data), mime: rows[0].mime_type } : null;
  }
}
