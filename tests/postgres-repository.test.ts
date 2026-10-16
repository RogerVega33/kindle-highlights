import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { DatabaseClient, DatabasePool, DatabaseResult } from '../server/db/types.js';
import { SQL_MARK_PATTERN } from '../server/sql-search.js';
import { RepositoryError } from '../server/errors.js';
import { PostgresRepository } from '../server/repositories/postgres-repository.js';

const userId = '11111111-1111-4111-8111-111111111111';
const bookId = '33333333-3333-4333-8333-333333333333';
const annotationId = '44444444-4444-4444-8444-444444444444';
const otherAnnotationId = '55555555-5555-4555-8555-555555555555';
const coverVersion = '66666666-6666-4666-8666-666666666666';
const now = '2026-01-01T12:00:00.000Z';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6u4AAAAASUVORK5CYII=';
const html = `<div class="bookTitle">Libro fuente</div><div class="authors">Autora</div>
  <div class="sectionHeading">Una sección</div>
  <div class="noteHeading">Subrayado - Página 4 · Posición 20</div>
  <div class="noteText">Una   idea original.</div>
  <div class="noteHeading">Nota - Página 4</div>
  <div class="noteText">Una nota.<br>Otra línea.</div>`;

const bookRow = (overrides: Record<string, unknown> = {}) => ({
  id: bookId, title: 'Título personalizado', author: 'Autor personalizado',
  cover_version: null, highlight_count: '1', note_count: '1', created_at: now, updated_at: now,
  ...overrides,
});
const annotationRow = (overrides: Record<string, unknown> = {}) => ({
  id: annotationId, book_id: bookId, kind: 'highlight', original_text: 'Una idea original.',
  edited_text: 'Última edición.', page: '4', location: '20', color: null,
  section_title: 'Una sección', chapter_title: null, source_order: 1,
  ...overrides,
});

type Step = {
  via?: 'pool' | 'client';
  sql: RegExp;
  values?: unknown[];
  inspect?: (sql: string, values: unknown[]) => void;
  rows?: Record<string, unknown>[];
  rowCount?: number | null;
  error?: Error;
};

/** Scripted responses only: this fake never parses SQL or contacts a database. */
class ScriptedPool implements DatabasePool {
  readonly queries: { via: string; sql: string; values: unknown[] }[] = [];
  connections = 0;
  releases = 0;

  constructor(private readonly steps: Step[]) {}

  private async run<Row extends Record<string, unknown>>(via: 'pool' | 'client', sql: string, values: unknown[] = []): Promise<DatabaseResult<Row>> {
    this.queries.push({ via, sql, values });
    const step = this.steps.shift();
    assert.ok(step, `Consulta inesperada: ${sql}`);
    assert.equal(via, step.via ?? 'client');
    assert.match(sql, step.sql);
    if (step.values) assert.deepEqual(values, step.values);
    step.inspect?.(sql, values);
    if (step.error) throw step.error;
    return { rows: (step.rows ?? []) as Row[], rowCount: step.rowCount === undefined ? (step.rows?.length ?? 0) : step.rowCount };
  }

  query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<DatabaseResult<Row>> {
    return this.run<Row>('pool', sql, values);
  }

  async connect(): Promise<DatabaseClient> {
    this.connections += 1;
    return {
      query: <Row extends Record<string, unknown>>(sql: string, values?: unknown[]) => this.run<Row>('client', sql, values),
      release: () => { this.releases += 1; },
    };
  }

  done(connections = 1): void {
    assert.equal(this.steps.length, 0, 'Deben consumirse todas las respuestas programadas.');
    assert.equal(this.connections, connections);
    assert.equal(this.releases, connections, 'Cada cliente obtenido debe liberarse.');
  }
}

const begin = (): Step => ({ sql: /^BEGIN$/ });
const commit = (): Step => ({ sql: /^COMMIT$/ });
const lock = (): Step => ({ sql: /WHERE b\.id = \$1 AND b\.user_id = \$2 FOR UPDATE/, values: [bookId, userId], rows: [{ id: bookId }] });
const touch = (): Step => ({ sql: /UPDATE books SET updated_at = GREATEST[\s\S]*WHERE id = \$1 AND user_id = \$2/, values: [bookId, userId] });
const findBook = (overrides: Record<string, unknown> = {}): Step => ({ sql: /WHERE b\.id = \$1 AND b\.user_id = \$2$/, values: [bookId, userId], rows: [bookRow(overrides)] });
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isNotFound = (error: unknown): boolean => error instanceof RepositoryError && error.statusCode === 404;

test('PostgreSQL: construir el repositorio no conecta y la lista limita usuario sin descargar portadas', async () => {
  const pool = new ScriptedPool([
    { sql: /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/ },
    { sql: /WITH library AS[\s\S]*WHERE user_id = \$1/, values: [userId, '', SQL_MARK_PATTERN],
      rows: [{ total_books: '1', total_annotations: '15', matching_books: '1' }] }, {
    sql: /WHERE b\.user_id = \$1[\s\S]*ORDER BY b\.updated_at DESC[\s\S]*LIMIT \$4 OFFSET \$5/,
    values: [userId, '', SQL_MARK_PATTERN, 36, 0],
    rows: [bookRow({ cover_version: coverVersion, highlight_count: '12', note_count: 3 })],
    inspect: sql => {
      assert.doesNotMatch(sql, /\bc\.(?:data|mime_type)\b/);
      assert.match(sql, /count\(\*\)[\s\S]*kind = 'highlight'/);
      assert.match(sql, /count\(\*\)[\s\S]*kind = 'note'/);
    },
  }, commit()]);
  const repository = new PostgresRepository(pool, userId);
  assert.equal(pool.connections, 0);
  assert.equal(pool.queries.length, 0);
  assert.throws(() => new PostgresRepository(pool, 'inválido'), isNotFound);
  await assert.rejects(repository.getBook('inválido'), isNotFound);
  assert.equal(pool.queries.length, 0);
  const page = await repository.listBooks();
  const [book] = page.books;
  assert.equal(book.highlightCount, 12);
  assert.equal(book.noteCount, 3);
  assert.equal(book.coverUrl, `/api/books/${bookId}/cover?v=${coverVersion}`);
  assert.equal(book.createdAt, now);
  assert.deepEqual({ ...page, books: [] }, {
    books: [], page: 1, pageSize: 36, totalBooks: 1, totalAnnotations: 15, matchingBooks: 1, totalPages: 1,
  });
  pool.done();
});

test('PostgreSQL: filtra, ordena y limita la página en SQL dentro del mismo snapshot que los totales', async () => {
  const query = " ÁRBOL %_' ; -- ";
  const normalized = "arbol %_' ; --";
  for (const sort of ['recent', 'title', 'author'] as const) {
    const pool = new ScriptedPool([
      { sql: /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/ },
      {
        sql: /WITH library AS[\s\S]*FROM books WHERE user_id = \$1[\s\S]*count\(\*\) FILTER[\s\S]*JOIN library owned ON owned\.id = a\.book_id/,
        values: [userId, normalized, SQL_MARK_PATTERN],
        rows: [{ total_books: '1000', total_annotations: '1200', matching_books: '73' }],
        inspect: sql => {
          assert.match(sql, /strpos\(lower\(regexp_replace\(normalize\(b\.title \|\| ' ' \|\| b\.author, NFD\), \$3, '', 'g'\)\), \$2\) > 0/);
          assert.doesNotMatch(sql, /ÁRBOL|arbol|ILIKE|\bc\.data\b/);
        },
      },
      {
        sql: /WHERE b\.user_id = \$1[\s\S]*LIMIT \$4 OFFSET \$5$/,
        values: [userId, normalized, SQL_MARK_PATTERN, 36, 72],
        rows: [bookRow()],
        inspect: sql => {
          const order = sql.slice(sql.indexOf('ORDER BY'));
          assert.match(order, /COLLATE "C"/);
          assert.match(order, /, b\.id LIMIT/);
          if (sort === 'recent') assert.match(order, /^ORDER BY b\.updated_at DESC,/);
          if (sort === 'title') assert.match(order, /^ORDER BY lower\(regexp_replace\(normalize\(b\.title,/);
          if (sort === 'author') assert.match(order, /^ORDER BY lower\(regexp_replace\(normalize\(b\.author,/);
          assert.doesNotMatch(sql, /ÁRBOL|arbol|\bc\.data\b/);
        },
      },
      commit(),
    ]);
    const result = await new PostgresRepository(pool, userId).listBooks({ page: Number.MAX_SAFE_INTEGER, query, sort });
    assert.equal(result.books.length, 1);
    assert.deepEqual({ ...result, books: [] }, {
      books: [], page: 3, pageSize: 36, totalBooks: 1000, totalAnnotations: 1200, matchingBooks: 73, totalPages: 3,
    });
    pool.done();
  }
});

test('PostgreSQL: una biblioteca vacía conserva página uno y un error de listado libera el cliente sin ocultarlo', async () => {
  const empty = new ScriptedPool([
    { sql: /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/ },
    { sql: /WITH library AS/, rows: [{ total_books: '0', total_annotations: '0', matching_books: '0' }] },
    { sql: /LIMIT \$4 OFFSET \$5$/, values: [userId, '', SQL_MARK_PATTERN, 36, 0] }, commit(),
  ]);
  assert.deepEqual(await new PostgresRepository(empty, userId).listBooks({ page: 500 }), {
    books: [], page: 1, pageSize: 36, totalBooks: 0, totalAnnotations: 0, matchingBooks: 0, totalPages: 1,
  });
  empty.done();
  const failure = new Error('Error ficticio de lectura.');
  const broken = new ScriptedPool([
    { sql: /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/ },
    { sql: /WITH library AS/, error: failure }, { sql: /^ROLLBACK$/, error: new Error('Rollback ficticio.') },
  ]);
  await assert.rejects(new PostgresRepository(broken, userId).listBooks(), error => error === failure);
  broken.done();
  const untouched = new ScriptedPool([]);
  await assert.rejects(new PostgresRepository(untouched, userId).listBooks({ page: 0 }), error => error instanceof RepositoryError && error.statusCode === 400);
  untouched.done(0);
});

test('el patrón SQL de acentos cubre marcas Unicode de varios alfabetos y planos', () => {
  const marks = new RegExp(SQL_MARK_PATTERN, 'gu');
  for (const text of ['Árbol', 'A\u0301rbol', 'שָׁלוֹם', 'किताब', 'a\u{1e8d0}b\u{e0100}']) {
    assert.equal(text.normalize('NFD').replace(marks, ''), text.normalize('NFD').replace(/\p{M}/gu, ''));
  }
});

test('PostgreSQL: libros ajenos producen 404 antes de leer contenido o modificar hijos', async () => {
  const readPool = new ScriptedPool([
    { sql: /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/ },
    { sql: /WHERE b\.id = \$1 AND b\.user_id = \$2$/, values: [bookId, userId] },
    { sql: /^ROLLBACK$/ },
  ]);
  await assert.rejects(new PostgresRepository(readPool, userId).getBook(bookId), isNotFound);
  readPool.done();

  const mutations = [
    (repository: PostgresRepository) => repository.updateBook(bookId, { title: 'Otro título', author: '' }),
    (repository: PostgresRepository) => repository.updateAnnotation(bookId, annotationId, 'Edición'),
    (repository: PostgresRepository) => repository.deleteAnnotation(bookId, annotationId),
    (repository: PostgresRepository) => repository.setCover(bookId, png),
    (repository: PostgresRepository) => repository.deleteCover(bookId),
  ];
  for (const mutate of mutations) {
    const pool = new ScriptedPool([
      begin(), { sql: /WHERE b\.id = \$1 AND b\.user_id = \$2 FOR UPDATE/, values: [bookId, userId] },
      { sql: /^ROLLBACK$/ },
    ]);
    await assert.rejects(mutate(new PostgresRepository(pool, userId)), isNotFound);
    pool.done();
  }
  const directPool = new ScriptedPool([
    { via: 'pool', sql: /^DELETE FROM books WHERE id = \$1 AND user_id = \$2$/, values: [bookId, userId], rowCount: 0 },
    { via: 'pool', sql: /SELECT b\.id, c\.data, c\.mime_type[\s\S]*WHERE b\.id = \$1 AND b\.user_id = \$2$/, values: [bookId, userId] },
    { ...findBook(), via: 'pool', rows: [] },
  ]);
  const repository = new PostgresRepository(directPool, userId);
  await assert.rejects(repository.deleteBook(bookId), isNotFound);
  await assert.rejects(repository.getCover(bookId), isNotFound);
  await assert.rejects(repository.importFiles([{ filename: 'fuente.html', html }], bookId), isNotFound);
  directPool.done(0);
});

test('PostgreSQL: reimportar usa identidad fuente y huellas canónicas sin reemplazar metadatos ni ediciones', async () => {
  const pool = new ScriptedPool([
    begin(),
    {
      sql: /INSERT INTO books[\s\S]*ON CONFLICT \(user_id, identity_hash\) DO NOTHING RETURNING id/,
      inspect: (sql, values) => {
        assert.equal(values[1], userId);
        assert.deepEqual(values.slice(2), ['Libro fuente', 'Autora', 'Libro fuente', hash(['libro fuente', 'autora'])]);
        assert.doesNotMatch(sql, /DO UPDATE/);
      },
    },
    { sql: /^SELECT id FROM books WHERE user_id = \$1 AND identity_hash = \$2$/, values: [userId, hash(['libro fuente', 'autora'])], rows: [{ id: bookId }] },
    lock(),
    {
      sql: /INSERT INTO annotations[\s\S]*ON CONFLICT \(book_id, fingerprint\) DO NOTHING RETURNING kind/,
      inspect: (sql, values) => {
        assert.equal(values.length, 23);
        assert.deepEqual(values.slice(1, 11), [bookId, 'highlight', 'Una idea original.', 4, 20, null, 'Una sección', null, 1,
          hash([bookId, 'highlight', 'location', 20, 'Una idea original.'])]);
        assert.deepEqual(values.slice(12, 22), [bookId, 'note', 'Una nota.\nOtra línea.', 4, null, null, 'Una sección', null, 2,
          hash([bookId, 'note', 'page', 4, 'Una nota.\nOtra línea.'])]);
        assert.equal(values[22], userId);
        assert.match(sql, /JOIN books b ON b\.id = imported\.book_id::uuid AND b\.user_id = \$23/);
        assert.doesNotMatch(sql, /edited_text|DO UPDATE/);
      },
    },
    findBook({ cover_version: coverVersion }), commit(),
    { sql: /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/ }, findBook({ cover_version: coverVersion }),
    {
      sql: /FROM annotations a JOIN books b[\s\S]*WHERE a\.book_id = \$1 AND b\.user_id = \$2 ORDER BY a\.insertion_order/,
      values: [bookId, userId], rows: [annotationRow()],
    },
    commit(),
  ]);
  const repository = new PostgresRepository(pool, userId);
  const [result] = await repository.importFiles([{ filename: 'fuente.html', html }]);
  assert.deepEqual({ status: result.status, added: result.added, repeated: result.repeated, title: result.bookTitle },
    { status: 'success', added: 0, repeated: 2, title: 'Título personalizado' });
  const detail = await repository.getBook(bookId);
  assert.equal(detail.title, 'Título personalizado');
  assert.equal(detail.author, 'Autor personalizado');
  assert.equal(detail.annotations[0].originalText, 'Una idea original.');
  assert.equal(detail.annotations[0].text, 'Última edición.');
  assert.equal(detail.annotations[0].edited, true);
  assert.equal(detail.coverUrl, `/api/books/${bookId}/cover?v=${coverVersion}`);
  pool.done(2);
});

test('PostgreSQL: al importar separa el título visible del original y conserva la identidad completa', async () => {
  const titles = [
    ['El juego infinito (Spanish Edition)', 'El juego infinito'],
    ['Magia de pensar en grande: Aprenda los secretos éxito y alcance lo que siempre ha querido...', 'Magia de pensar en grande'],
    ['Scrum: El arte de hacer el doble de trabajo en la mitad de tiempo (Alta Definición)', 'Scrum'],
    ['Homo Deus: Breve historia del mañana', 'Homo Deus'],
    ['Un pequeño empujón: El impulso que necesitas para tomar mejores decisiones sobre salud, dinero y felicidad', 'Un pequeño empujón'],
    ['El millonario de la puerta de al lado (EXITO)', 'El millonario de la puerta de al lado'],
    ['El juego infinito: ¿Sabes a qué estás jugando? (Gestión del conocimiento)', 'El juego infinito'],
    ['Cómo fracasar en casi todo y aun así triunfar: Algo así como la historia de mi vida (Gestion Del Conocimiento)', 'Cómo fracasar en casi todo y aun así triunfar'],
    ['La vaca púrpura: Diferénciate para transformar tu negocio', 'La vaca púrpura'],
    ['Creatividad, S.A.: Cómo llevar la inspiración', 'Creatividad, S.A.'],
    ['Creatividad, S.A. (Spanish Edition)', 'Creatividad, S.A.'],
    ['Creatividad, S.A.', 'Creatividad, S.A.'],
    ['Una historia. Un subtítulo', 'Una historia. Un subtítulo'],
    ['Una historia...', 'Una historia...'],
    ['Título completo', 'Título completo'],
    ['(Un título)', '(Un título)'],
  ];
  for (const [original, display] of titles) {
    const pool = new ScriptedPool([
      begin(), {
        sql: /INSERT INTO books[\s\S]*VALUES \(\$1, \$2, \$3, \$4, \$5, \$4, \$6\)/,
        rows: [{ id: bookId }],
        inspect: (_sql, values) => assert.deepEqual(values.slice(1), [userId, display, 'Autora', original, hash([original.toLowerCase(), 'autora'])]),
      }, lock(), { sql: /INSERT INTO annotations/, rows: [{ kind: 'highlight' }, { kind: 'note' }] },
      touch(), findBook({ title: display }), commit(),
    ]);
    const [result] = await new PostgresRepository(pool, userId).importFiles([{ filename: 'fuente.html', html: html.replace('Libro fuente', original) }]);
    assert.equal(result.status, 'success', result.error);
    assert.equal(result.bookTitle, display);
    pool.done();
  }
});

test('PostgreSQL: importar más respeta el destino explícito aunque la fuente tenga otro título', async () => {
  const pool = new ScriptedPool([
    { ...findBook(), via: 'pool' }, begin(), lock(),
    {
      sql: /INSERT INTO annotations/,
      inspect: (_sql, values) => {
        assert.equal(values[1], bookId);
        assert.equal(values[12], bookId);
        assert.equal(values.at(-1), userId);
      },
      rows: [{ kind: 'highlight' }, { kind: 'note' }],
    },
    touch(), findBook({ highlight_count: '2', note_count: '2' }), commit(),
  ]);
  const [result] = await new PostgresRepository(pool, userId).importFiles([{ filename: 'otro-libro.html', html }], bookId);
  assert.equal(result.status, 'success');
  assert.equal(result.bookId, bookId);
  assert.equal(result.bookTitle, 'Título personalizado');
  assert.equal(result.added, 2);
  assert.equal(result.highlights, 1);
  assert.equal(result.notes, 1);
  assert.equal(result.repeated, 0);
  assert.equal(pool.queries.some(query => /INSERT INTO books|identity_hash/.test(query.sql)), false);
  pool.done();
});

test('PostgreSQL: una importación fallida revierte, libera el cliente y no expone errores internos', async () => {
  const internalError = new Error('Fallo SQL sintético con detalle interno de infraestructura.');
  const pool = new ScriptedPool([
    begin(), { sql: /INSERT INTO books/, error: internalError },
    { sql: /^ROLLBACK$/, error: new Error('También falló el rollback sintético.') },
    begin(), { sql: /INSERT INTO books/, rows: [{ id: bookId }] }, lock(),
    { sql: /INSERT INTO annotations/, rows: [{ kind: 'highlight' }, { kind: 'note' }] },
    touch(), findBook(), commit(),
  ]);
  const results = await new PostgresRepository(pool, userId).importFiles([
    { filename: 'fallo.html', html }, { filename: 'correcto.html', html },
  ]);
  assert.equal(results[0].status, 'error');
  assert.equal(results[0].error, 'No se pudo guardar la importación.');
  assert.equal(results[0].bookId, null);
  assert.equal(results[0].added, 0);
  assert.doesNotMatch(JSON.stringify(results[0]), /SQL sintético|infraestructura|rollback/);
  assert.equal(results[1].status, 'success');
  assert.equal(results[1].added, 2);
  pool.done(2);
});

test('PostgreSQL: editar sólo reemplaza la última edición y volver al original limpia edited_text', async () => {
  const before = annotationRow();
  const afterEdit = annotationRow({ edited_text: 'Nueva edición.' });
  const restored = annotationRow({ edited_text: null });
  const previous = (row: Record<string, unknown>): Step => ({
    sql: /WHERE a\.id = \$1 AND a\.book_id = \$2 AND b\.user_id = \$3$/,
    values: [annotationId, bookId, userId], rows: [row],
  });
  const update = (text: string, row: Record<string, unknown>): Step => ({
    sql: /SET edited_text = NULLIF\(\$4, a\.original_text\)[\s\S]*b\.user_id = \$3/,
    values: [annotationId, bookId, userId, text], rows: [row],
    inspect: sql => { assert.doesNotMatch(sql, /SET\s+original_text\s*=|fingerprint\s*=/); },
  });
  const pool = new ScriptedPool([
    begin(), lock(), previous(before), update('Nueva edición.', afterEdit), touch(), commit(),
    begin(), lock(), previous(afterEdit), update('Una idea original.', restored), touch(), commit(),
    begin(), lock(), previous(restored), commit(),
  ]);
  const repository = new PostgresRepository(pool, userId);
  const edited = await repository.updateAnnotation(bookId, annotationId, 'Nueva edición.');
  assert.equal(edited.text, 'Nueva edición.');
  assert.equal(edited.originalText, 'Una idea original.');
  assert.equal(edited.edited, true);
  const original = await repository.updateAnnotation(bookId, annotationId, 'Una idea original.');
  assert.equal(original.text, original.originalText);
  assert.equal(original.edited, false);
  assert.deepEqual(await repository.updateAnnotation(bookId, annotationId, 'Una idea original.'), original);
  pool.done(3);

  const missing = new ScriptedPool([begin(), lock(), { ...previous(before), rows: [] }, { sql: /^ROLLBACK$/ }]);
  await assert.rejects(new PostgresRepository(missing, userId).updateAnnotation(bookId, annotationId, 'Edición'), isNotFound);
  missing.done();
});

test('PostgreSQL: eliminar devuelve conteos posteriores y el esquema elimina hijos por cascada', async () => {
  const pool = new ScriptedPool([
    begin(), lock(),
    { sql: /DELETE FROM annotations a USING books b[\s\S]*a\.id = \$1 AND a\.book_id = \$2[\s\S]*b\.user_id = \$3/, values: [annotationId, bookId, userId], rowCount: 1 },
    touch(), findBook({ highlight_count: '0', note_count: '1' }),
    { sql: /WHERE a\.book_id = \$1 AND b\.user_id = \$2 ORDER BY a\.insertion_order/, values: [bookId, userId], rows: [annotationRow({ id: otherAnnotationId, kind: 'note', edited_text: null, location: null })] },
    commit(),
    { via: 'pool', sql: /^DELETE FROM books WHERE id = \$1 AND user_id = \$2$/, values: [bookId, userId], rowCount: 1 },
  ]);
  const repository = new PostgresRepository(pool, userId);
  const detail = await repository.deleteAnnotation(bookId, annotationId);
  assert.equal(detail.highlightCount, 0);
  assert.equal(detail.noteCount, 1);
  assert.deepEqual(detail.annotations.map(annotation => annotation.id), [otherAnnotationId]);
  await repository.deleteBook(bookId);
  pool.done();
  const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
  assert.match(schema, /CREATE TABLE annotations[\s\S]*?book_id uuid NOT NULL REFERENCES books\(id\) ON DELETE CASCADE/);
  assert.match(schema, /CREATE TABLE book_covers[\s\S]*?book_id uuid PRIMARY KEY REFERENCES books\(id\) ON DELETE CASCADE/);
  assert.match(schema, /UNIQUE \(book_id, fingerprint\)/);
});

test('PostgreSQL: cada portada obtiene otra versión y leerla o eliminarla conserva el scope', async () => {
  const versions: string[] = [];
  const coverWrite = (): Step => ({
    sql: /INSERT INTO book_covers[\s\S]*WHERE b\.id = \$1 AND b\.user_id = \$2[\s\S]*version = EXCLUDED\.version/,
    inspect: (_sql, values) => {
      assert.deepEqual(values.slice(0, 2), [bookId, userId]);
      assert.ok(Buffer.isBuffer(values[2]));
      assert.equal(values[3], 'image/png');
      assert.match(String(values[4]), /^[\da-f-]{36}$/);
      versions.push(String(values[4]));
    },
  });
  const bytes = Buffer.from('portada sintética');
  const pool = new ScriptedPool([
    begin(), lock(), coverWrite(), touch(), findBook({ cover_version: coverVersion }), commit(),
    begin(), lock(), coverWrite(), touch(), findBook({ cover_version: coverVersion }), commit(),
    { via: 'pool', sql: /SELECT b\.id, c\.data, c\.mime_type[\s\S]*WHERE b\.id = \$1 AND b\.user_id = \$2$/, values: [bookId, userId], rows: [{ id: bookId, data: bytes, mime_type: 'image/png' }] },
    begin(), lock(),
    { sql: /DELETE FROM book_covers c USING books b[\s\S]*c\.book_id = \$1[\s\S]*b\.user_id = \$2/, values: [bookId, userId] },
    touch(), findBook(), commit(),
    { via: 'pool', sql: /SELECT b\.id, c\.data, c\.mime_type[\s\S]*WHERE b\.id = \$1 AND b\.user_id = \$2$/, values: [bookId, userId], rows: [{ id: bookId, data: null, mime_type: null }] },
  ]);
  const repository = new PostgresRepository(pool, userId);
  await repository.setCover(bookId, png);
  await repository.setCover(bookId, png);
  assert.equal(new Set(versions).size, 2, 'Reemplazar debe invalidar la URL de portada anterior.');
  const cover = await repository.getCover(bookId);
  assert.deepEqual(cover, { bytes, mime: 'image/png' });
  assert.notEqual(cover?.bytes, bytes, 'No debe exponer la referencia mutable del driver.');
  assert.equal((await repository.deleteCover(bookId)).coverUrl, null);
  assert.equal(await repository.getCover(bookId), null);
  pool.done(3);
});
