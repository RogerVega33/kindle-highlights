import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresAuthRepository } from '../server/auth/postgres-repository.js';
import type { DatabaseClient, DatabasePool, DatabaseResult } from '../server/db/types.js';
import type { NewSession } from '../server/auth/repository.js';

const userId = '11111111-1111-4111-8111-111111111111';
const now = '2026-01-01T12:00:00Z';
const row = { id: userId, username: 'Lectora', last_login_at: now };
const session: NewSession = { tokenHash: 'a'.repeat(64), previousTokenHash: 'b'.repeat(64), expiresAt: new Date('2026-01-08T12:00:00Z') };
type Step = { sql: RegExp; values?: unknown[]; rows?: Record<string, unknown>[]; error?: Error };

function pool(steps: Step[]) {
  let releases = 0;
  const calls: { text: string; values: unknown[] | undefined }[] = [];
  async function query<Row extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<DatabaseResult<Row>> {
    calls.push({ text, values });
    const step = steps.shift();
    assert.ok(step, `Consulta inesperada: ${text}`);
    assert.match(text, step.sql);
    if (step.values) assert.deepEqual(values, step.values);
    if (step.error) throw step.error;
    return { rows: (step.rows ?? []) as Row[], rowCount: step.rows?.length ?? 0 };
  }
  const client: DatabaseClient = { query, release: () => { releases++; } };
  const result: DatabasePool = { query, connect: async () => client };
  return { result, calls, done: (expectedReleases: number) => { assert.equal(steps.length, 0); assert.equal(releases, expectedReleases); } };
}
const begin = (): Step => ({ sql: /^BEGIN$/ });
const commit = (): Step => ({ sql: /^COMMIT$/ });
const cleanup = (): Step => ({ sql: /^DELETE FROM sessions WHERE expires_at <= clock_timestamp\(\)$/ });
const rotate = (): Step => ({ sql: /^DELETE FROM sessions WHERE token_hash = \$1$/, values: [session.previousTokenHash] });
const insert = (): Step => ({ sql: /^INSERT INTO sessions /, values: [session.tokenHash, userId, session.expiresAt] });

test('registro PostgreSQL guarda el hash y la sesión en la misma transacción', async () => {
  const fake = pool([begin(), { sql: /INSERT INTO users[\s\S]*clock_timestamp\(\)[\s\S]*RETURNING/, rows: [row] }, cleanup(), rotate(), insert(), commit()]);
  const user = await new PostgresAuthRepository(fake.result).register('Lectora', 'hash-ficticio', session, 'recovery-ficticio');
  assert.deepEqual(user, { id: userId, username: 'Lectora', lastLoginAt: new Date(now).toISOString() });
  assert.equal(fake.calls[1].values?.[1], 'Lectora');
  assert.equal(fake.calls[1].values?.[2], 'hash-ficticio');
  assert.equal(fake.calls[1].values?.[3], 'recovery-ficticio');
  fake.done(1);
});

test('un usuario duplicado revierte el registro y devuelve conflicto sin detalles SQL', async () => {
  const duplicate = Object.assign(new Error('SQL privado'), { code: '23505' });
  const fake = pool([begin(), { sql: /INSERT INTO users/, error: duplicate }, { sql: /^ROLLBACK$/ }]);
  await assert.rejects(new PostgresAuthRepository(fake.result).register('Lectora', 'hash', session, 'recovery-hash'), error => {
    assert.equal((error as { statusCode: number }).statusCode, 409);
    assert.equal((error as Error).message, 'Ese nombre de usuario ya está en uso.');
    return true;
  });
  fake.done(1);
});

test('login PostgreSQL actualiza último acceso y rota la sesión de forma atómica', async () => {
  const fake = pool([begin(), { sql: /UPDATE users SET last_login_at = clock_timestamp\(\)[\s\S]*WHERE id = \$1 AND password_hash = \$2/, values: [userId, 'hash'], rows: [row] }, cleanup(), rotate(), insert(), commit()]);
  assert.equal((await new PostgresAuthRepository(fake.result).login(userId, 'hash', session))?.id, userId);
  fake.done(1);
});

test('fallar al guardar la sesión revierte también el último acceso', async () => {
  const fake = pool([begin(), { sql: /UPDATE users/, rows: [row] }, cleanup(), rotate(),
    { sql: /^INSERT INTO sessions/, error: new Error('Fallo ficticio') }, { sql: /^ROLLBACK$/ }]);
  await assert.rejects(new PostgresAuthRepository(fake.result).login(userId, 'hash', session), /Fallo ficticio/);
  assert.ok(!fake.calls.some(call => call.text === 'COMMIT'));
  fake.done(1);
});

test('una contraseña cambiada durante el login no crea sesión ni actualiza otro usuario', async () => {
  const fake = pool([begin(), { sql: /UPDATE users[\s\S]*password_hash = \$2/, values: [userId, 'hash-anterior'] }, commit()]);
  assert.equal(await new PostgresAuthRepository(fake.result).login(userId, 'hash-anterior', session), null);
  fake.done(1);
});

test('buscar sesión exige caducidad válida; logout elimina únicamente el hash recibido', async () => {
  const fake = pool([
    { sql: /WHERE lower\(username\) = lower\(\$1\)/, values: ['lectora'], rows: [{ ...row, password_hash: 'hash', recovery_phrase_hash: 'recovery-hash' }] },
    { sql: /JOIN users u ON u.id = s.user_id[\s\S]*s.token_hash = \$1 AND s.expires_at > clock_timestamp\(\) AND u.password_hash IS NOT NULL/, values: [session.tokenHash], rows: [row] },
    { sql: /^DELETE FROM sessions WHERE token_hash = \$1$/, values: [session.tokenHash] },
  ]);
  const repository = new PostgresAuthRepository(fake.result);
  const credentials = await repository.findUser('lectora');
  assert.equal(credentials?.passwordHash, 'hash');
  assert.equal(credentials?.recoveryPhraseHash, 'recovery-hash');
  const user = await repository.findSession(session.tokenHash);
  assert.ok(user && !('passwordHash' in user));
  await repository.deleteSession(session.tokenHash);
  fake.done(0);
});

test('recuperar actualiza ambos hashes y revoca las sesiones antes de crear la nueva, dentro de una transacción', async () => {
  const fake = pool([begin(), {
    sql: /UPDATE users SET password_hash = \$3, recovery_phrase_hash = \$4[\s\S]*WHERE id = \$1 AND recovery_phrase_hash = \$2/,
    values: [userId, 'recovery-anterior', 'password-nuevo', 'recovery-nuevo'], rows: [row],
  }, { sql: /^DELETE FROM sessions WHERE user_id = \$1$/, values: [userId] }, cleanup(), rotate(), insert(), commit()]);
  const user = await new PostgresAuthRepository(fake.result).recover(userId, 'recovery-anterior', 'password-nuevo', 'recovery-nuevo', session);
  assert.equal(user?.id, userId);
  assert.equal(user && 'recoveryPhraseHash' in user, false);
  fake.done(1);
});

test('un fallo al crear la sesión de recuperación revierte contraseña, palabras y revocación', async () => {
  const fake = pool([begin(), { sql: /UPDATE users/, rows: [row] }, { sql: /^DELETE FROM sessions WHERE user_id/ }, cleanup(), rotate(),
    { sql: /^INSERT INTO sessions/, error: new Error('Fallo ficticio') }, { sql: /^ROLLBACK$/ }]);
  await assert.rejects(new PostgresAuthRepository(fake.result).recover(userId, 'anterior', 'password', 'nuevo', session), /Fallo ficticio/);
  assert.ok(!fake.calls.some(call => call.text === 'COMMIT'));
  fake.done(1);
});

test('reutilizar palabras ya cambiadas no modifica sesiones ni confirma una recuperación', async () => {
  const fake = pool([begin(), { sql: /UPDATE users[\s\S]*recovery_phrase_hash = \$2/, values: [userId, 'anterior', 'password', 'nuevo'] }, commit()]);
  assert.equal(await new PostgresAuthRepository(fake.result).recover(userId, 'anterior', 'password', 'nuevo', session), null);
  fake.done(1);
});

test('cambiar contraseña conserva el token y vencimiento actuales, sin tocar palabras ni último acceso', async () => {
  const fake = pool([begin(), {
    sql: /^UPDATE users SET password_hash = \$3\s+WHERE id = \$1 AND password_hash = \$2 RETURNING/,
    values: [userId, 'password-anterior', 'password-nuevo'], rows: [row],
  }, { sql: /^SELECT token_hash FROM sessions[\s\S]*user_id = \$1 AND token_hash = \$2 AND expires_at > clock_timestamp\(\) FOR UPDATE$/,
    values: [userId, session.tokenHash], rows: [{ token_hash: session.tokenHash }] },
  { sql: /^DELETE FROM sessions WHERE user_id = \$1 AND token_hash <> \$2$/, values: [userId, session.tokenHash] }, commit()]);
  const user = await new PostgresAuthRepository(fake.result).changePassword(userId, 'password-anterior', 'password-nuevo', session.tokenHash);
  assert.equal(user?.id, userId);
  assert.equal(user?.lastLoginAt, new Date(now).toISOString());
  assert.ok(!fake.calls.some(call => /recovery_phrase|INSERT|expires_at\s*=|SET last_login_at/.test(call.text)));
  fake.done(1);
});

test('un cambio concurrente de contraseña no revoca sesiones ni sobrescribe el hash nuevo', async () => {
  const fake = pool([begin(), { sql: /^UPDATE users[\s\S]*password_hash = \$2/, values: [userId, 'anterior', 'nuevo'] }, commit()]);
  assert.equal(await new PostgresAuthRepository(fake.result).changePassword(userId, 'anterior', 'nuevo', session.tokenHash), null);
  fake.done(1);
});

test('sesión vencida o revocada durante el cambio provoca rollback de la contraseña', async () => {
  const fake = pool([begin(), { sql: /^UPDATE users/, rows: [row] }, { sql: /^SELECT token_hash FROM sessions[\s\S]*FOR UPDATE$/ }, { sql: /^ROLLBACK$/ }]);
  await assert.rejects(new PostgresAuthRepository(fake.result).changePassword(userId, 'anterior', 'nuevo', session.tokenHash), error => {
    assert.equal((error as { statusCode: number }).statusCode, 401);
    return true;
  });
  fake.done(1);
});

test('fallar al revocar otras sesiones revierte el cambio y libera la conexión', async () => {
  const fake = pool([begin(), { sql: /^UPDATE users/, rows: [row] }, { sql: /^SELECT token_hash FROM sessions/, rows: [{ token_hash: session.tokenHash }] },
    { sql: /^DELETE FROM sessions WHERE user_id/, error: new Error('Fallo ficticio') }, { sql: /^ROLLBACK$/ }]);
  await assert.rejects(new PostgresAuthRepository(fake.result).changePassword(userId, 'anterior', 'nuevo', session.tokenHash), /Fallo ficticio/);
  fake.done(1);
});
