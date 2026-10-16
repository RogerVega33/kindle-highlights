import { randomUUID } from 'node:crypto';
import type { User } from '../../shared/types.js';
import { RepositoryError } from '../../server/errors.js';
import type { AuthRepository, CredentialUser, NewSession } from '../../server/auth/repository.js';

export class FakeAuthRepository implements AuthRepository {
  readonly users = new Map<string, CredentialUser>();
  readonly sessions = new Map<string, { userId: string; expiresAt: Date }>();

  async findUser(username: string): Promise<CredentialUser | null> {
    const user = [...this.users.values()].find(user => user.username.toLowerCase() === username.toLowerCase());
    return user ? { ...user } : null;
  }
  private save(user: CredentialUser, session: NewSession): User {
    if (session.previousTokenHash) this.sessions.delete(session.previousTokenHash);
    this.sessions.set(session.tokenHash, { userId: user.id, expiresAt: session.expiresAt });
    user.lastLoginAt = new Date().toISOString();
    return { id: user.id, username: user.username, lastLoginAt: user.lastLoginAt };
  }
  async register(username: string, passwordHash: string, session: NewSession, recoveryPhraseHash: string): Promise<User> {
    if (await this.findUser(username)) throw new RepositoryError('Ese nombre de usuario ya está en uso.', 409);
    const user: CredentialUser = { id: randomUUID(), username, passwordHash, recoveryPhraseHash, lastLoginAt: null };
    this.users.set(user.id, user);
    return this.save(user, session);
  }
  async login(id: string, passwordHash: string, session: NewSession): Promise<User | null> {
    const user = this.users.get(id);
    return user?.passwordHash === passwordHash ? this.save(user, session) : null;
  }
  async recover(id: string, expectedRecoveryPhraseHash: string, passwordHash: string, recoveryPhraseHash: string, session: NewSession): Promise<User | null> {
    const user = this.users.get(id);
    if (!user || user.recoveryPhraseHash !== expectedRecoveryPhraseHash) return null;
    user.passwordHash = passwordHash;
    user.recoveryPhraseHash = recoveryPhraseHash;
    for (const [hash, stored] of this.sessions) if (stored.userId === id) this.sessions.delete(hash);
    return this.save(user, session);
  }
  async changePassword(id: string, expectedPasswordHash: string, passwordHash: string, currentTokenHash: string): Promise<User | null> {
    const user = this.users.get(id);
    if (!user || user.passwordHash !== expectedPasswordHash) return null;
    const current = this.sessions.get(currentTokenHash);
    if (!current || current.userId !== id || current.expiresAt.getTime() <= Date.now()) {
      throw new RepositoryError('Tu sesión terminó. Inicia sesión de nuevo.', 401);
    }
    user.passwordHash = passwordHash;
    for (const [hash, session] of this.sessions) if (session.userId === id && hash !== currentTokenHash) this.sessions.delete(hash);
    return { id: user.id, username: user.username, lastLoginAt: user.lastLoginAt };
  }
  async findSession(hash: string): Promise<User | null> {
    const session = this.sessions.get(hash);
    const user = session && session.expiresAt.getTime() > Date.now() ? this.users.get(session.userId) : null;
    return user?.passwordHash ? { id: user.id, username: user.username, lastLoginAt: user.lastLoginAt } : null;
  }
  async deleteSession(hash: string): Promise<void> { this.sessions.delete(hash); }
}
