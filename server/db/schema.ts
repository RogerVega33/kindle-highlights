import { readFile } from 'node:fs/promises';
import type { DatabasePool } from './types.js';

// Static identifiers only; every column used by the application must exist.
const columns = {
  users: 'id, username, password_hash, recovery_phrase_hash, last_login_at, created_at',
  sessions: 'token_hash, user_id, created_at, expires_at',
  books: 'id, user_id, title, author, original_title, original_author, identity_hash, created_at, updated_at',
  annotations: 'id, book_id, kind, original_text, edited_text, page, location, color, section_title, chapter_title, source_order, insertion_order, fingerprint, created_at, updated_at',
  book_covers: 'book_id, data, mime_type, version, updated_at',
};

export async function prepareSchema(pool: DatabasePool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    // Serialize simultaneous first starts. The lock is released on commit/rollback.
    await client.query('SELECT pg_catalog.pg_advisory_xact_lock(86151015, 1)');
    await client.query('SET LOCAL search_path = public');
    const { rows } = await client.query<{ schema_name: string; object_name: string }>(`SELECT n.nspname AS schema_name, c.relname AS object_name
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`);
    if (!rows.length) {
      const schema = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8');
      await client.query(schema);
    } else if (!Object.keys(columns).every(table => rows.some(row => row.schema_name === 'public' && row.object_name === table))) {
      throw new Error('El esquema existente está incompleto o pertenece a otra aplicación.');
    }
    for (const [table, fields] of Object.entries(columns)) {
      await client.query(`SELECT ${fields} FROM public.${table} LIMIT 0`);
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the startup failure. */ }
    throw error;
  } finally {
    client.release();
  }
}
