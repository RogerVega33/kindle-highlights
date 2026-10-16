import { randomUUID } from 'node:crypto';
import type { User } from '../../shared/types.js';
import type { DatabaseClient, DatabasePool } from '../db/types.js';
import { RepositoryError } from '../errors.js';
import type { AuthRepository, CredentialUser, NewSession } from './repository.js';
import type { DiagnosticLogger } from '../logging.js';

type UserRow = { id: string; username: string; last_login_at: string | Date | null };
const userOf = (row: UserRow): User => ({
  id: row.id, username: row.username,
  lastLoginAt: row.last_login_at === null ? null : new Date(row.last_login_at).toISOString(),
});

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly pool: DatabasePool, private readonly logger?: DiagnosticLogger) {}

  private async transaction<T>(operation: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { this.logger?.error({ event: 'database.rollback_failed', err: rollbackError }); }
      throw error;
    } finally { client.release(); }
  }

  async findUser(username: string): Promise<CredentialUser | null> {
    const { rows } = await this.pool.query<UserRow & { password_hash: string | null; recovery_phrase_hash: string | null }>(
      'SELECT id, username, password_hash, recovery_phrase_hash, last_login_at FROM users WHERE lower(username) = lower($1)', [username],
    );
    return rows[0] ? { ...userOf(rows[0]), passwordHash: rows[0].password_hash, recoveryPhraseHash: rows[0].recovery_phrase_hash } : null;
  }

  private async saveSession(client: DatabaseClient, userId: string, session: NewSession): Promise<void> {
    await client.query('DELETE FROM sessions WHERE expires_at <= clock_timestamp()');
    if (session.previousTokenHash) await client.query('DELETE FROM sessions WHERE token_hash = $1', [session.previousTokenHash]);
    await client.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [session.tokenHash, userId, session.expiresAt]);
  }

  async register(username: string, passwordHash: string, session: NewSession, recoveryPhraseHash: string): Promise<User> {
    try {
      return await this.transaction(async client => {
        const { rows } = await client.query<UserRow>(`INSERT INTO users (id, username, password_hash, recovery_phrase_hash, last_login_at)
          VALUES ($1, $2, $3, $4, clock_timestamp()) RETURNING id, username, last_login_at`, [randomUUID(), username, passwordHash, recoveryPhraseHash]);
        await this.saveSession(client, rows[0].id, session);
        return userOf(rows[0]);
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new RepositoryError('Ese nombre de usuario ya está en uso.', 409);
      }
      throw error;
    }
  }

  async login(userId: string, expectedPasswordHash: string, session: NewSession): Promise<User | null> {
    return this.transaction(async client => {
      const { rows } = await client.query<UserRow>(`UPDATE users SET last_login_at = clock_timestamp()
        WHERE id = $1 AND password_hash = $2 RETURNING id, username, last_login_at`, [userId, expectedPasswordHash]);
      if (!rows[0]) return null;
      await this.saveSession(client, userId, session);
      return userOf(rows[0]);
    });
  }

  async recover(userId: string, expectedRecoveryPhraseHash: string, passwordHash: string, recoveryPhraseHash: string, session: NewSession): Promise<User | null> {
    return this.transaction(async client => {
      const { rows } = await client.query<UserRow>(`UPDATE users SET password_hash = $3, recovery_phrase_hash = $4, last_login_at = clock_timestamp()
        WHERE id = $1 AND recovery_phrase_hash = $2 RETURNING id, username, last_login_at`,
      [userId, expectedRecoveryPhraseHash, passwordHash, recoveryPhraseHash]);
      if (!rows[0]) return null;
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await this.saveSession(client, userId, session);
      return userOf(rows[0]);
    });
  }

  async changePassword(userId: string, expectedPasswordHash: string, passwordHash: string, currentTokenHash: string): Promise<User | null> {
    return this.transaction(async client => {
      // Lock the user before its sessions, as login and recovery do.
      const { rows } = await client.query<UserRow>(`UPDATE users SET password_hash = $3
        WHERE id = $1 AND password_hash = $2 RETURNING id, username, last_login_at`, [userId, expectedPasswordHash, passwordHash]);
      if (!rows[0]) return null;
      const active = await client.query(`SELECT token_hash FROM sessions
        WHERE user_id = $1 AND token_hash = $2 AND expires_at > clock_timestamp() FOR UPDATE`, [userId, currentTokenHash]);
      // Roll back the password update if logout or expiry overtook the request.
      if (!active.rows[0]) throw new RepositoryError('Tu sesión terminó. Inicia sesión de nuevo.', 401);
      await client.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, currentTokenHash]);
      return userOf(rows[0]);
    });
  }

  async findSession(tokenHash: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(`SELECT u.id, u.username, u.last_login_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > clock_timestamp() AND u.password_hash IS NOT NULL`, [tokenHash]);
    return rows[0] ? userOf(rows[0]) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }
}
