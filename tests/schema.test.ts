import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSchema } from '../server/db/schema.js';
import type { DatabasePool, DatabaseResult } from '../server/db/types.js';

const tables = ['users', 'sessions', 'books', 'annotations', 'book_covers'];

// SQL is recorded only. The mutex simulates the transaction advisory lock; no driver is used.
function fixture(existing: string[] = [], fail?: 'create' | 'columns') {
  let installed = existing;
  let tail = Promise.resolve();
  let releases = 0;
  const calls: string[] = [];
  const pool: DatabasePool = {
    async query() { throw new Error('Debe usar una única conexión para la transacción.'); },
    async connect() {
      let unlock: (() => void) | undefined;
      let created = false;
      return {
        async query<Row extends Record<string, unknown>>(sql: string): Promise<DatabaseResult<Row>> {
          calls.push(sql);
          if (/pg_advisory_xact_lock/.test(sql)) {
            const previous = tail;
            tail = new Promise(resolve => { unlock = resolve; });
            await previous;
          }
          if (/CREATE TABLE/.test(sql)) {
            if (fail === 'create') throw new Error('Fallo ficticio al crear tablas.');
            created = true;
          }
          if (fail === 'columns' && /FROM public.books LIMIT 0/.test(sql)) throw new Error('Columna ficticia ausente.');
          const rows = /FROM pg_catalog.pg_class/.test(sql)
            ? installed.map(object_name => ({ schema_name: 'public', object_name })) : [];
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            if (created && sql === 'COMMIT') installed = [...tables];
            created = false;
            unlock?.();
          }
          return { rows: rows as unknown as Row[], rowCount: rows.length };
        },
        release() { releases++; },
      };
    },
  };
  return { pool, calls, installed: () => installed, releases: () => releases };
}

test('una base vacía recibe el esquema completo dentro de una transacción con bloqueo', async () => {
  const fake = fixture();
  await prepareSchema(fake.pool);
  assert.deepEqual(fake.installed(), tables);
  assert.equal(fake.calls[0], 'BEGIN');
  assert.ok(fake.calls.findIndex(sql => /pg_advisory_xact_lock/.test(sql)) < fake.calls.findIndex(sql => /FROM pg_catalog.pg_class/.test(sql)));
  const ddl = fake.calls.filter(sql => /CREATE TABLE/.test(sql));
  assert.equal(ddl.length, 1);
  for (const table of tables) assert.ok(ddl[0].includes(`CREATE TABLE ${table} (`));
  assert.doesNotMatch(ddl[0], /^\s*(?:BEGIN|COMMIT|DROP|ALTER|INSERT)\b/m);
  assert.equal(fake.calls.at(-1), 'COMMIT');
  assert.equal(fake.releases(), 1);
});

test('una base preparada se comprueba sin recrear tablas ni cambiar datos', async () => {
  const fake = fixture(tables);
  await prepareSchema(fake.pool);
  assert.ok(fake.calls.every(sql => !/CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE |DELETE FROM/.test(sql)));
  for (const table of tables) assert.ok(fake.calls.some(sql => sql.endsWith(`FROM public.${table} LIMIT 0`)));
  assert.equal(fake.calls.at(-1), 'COMMIT');
});

test('bases parciales o ajenas no se completan ni se sobrescriben automáticamente', async () => {
  for (const existing of [['users'], ['otra_aplicacion']]) {
    const fake = fixture(existing);
    await assert.rejects(prepareSchema(fake.pool), /incompleto|otra aplicación/);
    assert.deepEqual(fake.installed(), existing);
    assert.ok(fake.calls.every(sql => !/CREATE TABLE/.test(sql)));
    assert.equal(fake.calls.at(-1), 'ROLLBACK');
    assert.equal(fake.releases(), 1);
  }
});

test('fallos de creación o de columnas revierten la transacción y liberan la conexión', async () => {
  for (const fail of ['create', 'columns'] as const) {
    const initial = fail === 'columns' ? tables : [];
    const fake = fixture(initial, fail);
    await assert.rejects(prepareSchema(fake.pool));
    assert.deepEqual(fake.installed(), initial);
    assert.equal(fake.calls.at(-1), 'ROLLBACK');
    assert.equal(fake.releases(), 1);
  }
});

test('dos arranques concurrentes esperan el bloqueo y sólo uno instala el esquema', async () => {
  const fake = fixture();
  await Promise.all([prepareSchema(fake.pool), prepareSchema(fake.pool)]);
  assert.equal(fake.calls.filter(sql => /CREATE TABLE/.test(sql)).length, 1);
  assert.equal(fake.calls.filter(sql => sql === 'COMMIT').length, 2);
  assert.equal(fake.releases(), 2);
});
