import { createHash, randomBytes } from 'node:crypto';
import type { Credentials, User } from '../../shared/types.js';
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH } from '../../shared/limits.js';
import { RepositoryError } from '../errors.js';
import { hashPassword, verifyPassword } from './passwords.js';
import type { AuthRepository, NewSession } from './repository.js';
import { generateRecoveryPhrase, normalizeRecoveryPhrase } from './recovery-phrase.js';

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_COOKIE = 'kh_session';
export const sessionHash = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface AuthenticatedSession { user: User; token: string }
export interface RecoverySession extends AuthenticatedSession { recoveryPhrase: string }
export interface Authentication {
  authenticate(token: string | null): Promise<User | null>;
  register(input: unknown, previousToken: string | null): Promise<RecoverySession>;
  login(input: unknown, previousToken: string | null): Promise<AuthenticatedSession>;
  recover(input: unknown, previousToken: string | null): Promise<RecoverySession>;
  changePassword(input: unknown, token: string | null): Promise<User>;
  logout(token: string | null): Promise<void>;
}

function credentials(input: unknown, registering: boolean): Credentials {
  if (!input || typeof input !== 'object' || !('username' in input) || !('password' in input)
    || typeof input.username !== 'string' || typeof input.password !== 'string') {
    throw new RepositoryError('Escribe tu usuario y contraseña.');
  }
  const username = input.username;
  const password = input.password;
  if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH || /[^a-zA-Z0-9@._-]/.test(username)) {
    throw new RepositoryError(`El usuario debe tener entre ${MIN_USERNAME_LENGTH} y ${MAX_USERNAME_LENGTH} caracteres. Se permiten letras sin acentos, números y los símbolos @ . - _. Sin espacios.`);
  }
  const length = Array.from(password).length;
  if (length > MAX_PASSWORD_LENGTH || length < (registering ? MIN_PASSWORD_LENGTH : 1)) {
    throw new RepositoryError(`La contraseña debe tener entre ${registering ? MIN_PASSWORD_LENGTH : 1} y ${MAX_PASSWORD_LENGTH} caracteres.`);
  }
  return { username, password };
}

export class AuthService implements Authentication {
  constructor(private readonly repository: AuthRepository) {}

  private newSession(previousToken: string | null): { token: string; session: NewSession } {
    const token = randomBytes(32).toString('base64url');
    return { token, session: { tokenHash: sessionHash(token), expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
      previousTokenHash: previousToken ? sessionHash(previousToken) : null } };
  }

  async authenticate(token: string | null): Promise<User | null> {
    return token ? this.repository.findSession(sessionHash(token)) : null;
  }

  async register(input: unknown, previousToken: string | null): Promise<RecoverySession> {
    const { username, password } = credentials(input, true);
    const passwordHash = await hashPassword(password);
    const recoveryPhrase = generateRecoveryPhrase();
    const recoveryPhraseHash = await hashPassword(recoveryPhrase);
    const { token, session } = this.newSession(previousToken);
    const user = await this.repository.register(username, passwordHash, session, recoveryPhraseHash);
    return { user, token, recoveryPhrase };
  }

  async recover(input: unknown, previousToken: string | null): Promise<RecoverySession> {
    const { username, password } = credentials(input, true);
    const phrase = normalizeRecoveryPhrase((input as Record<string, unknown>).recoveryPhrase);
    const stored = await this.repository.findUser(username);
    const expectedRecoveryPhraseHash = stored?.recoveryPhraseHash ?? null;
    const valid = await verifyPassword(phrase ?? '', expectedRecoveryPhraseHash);
    const failure = () => new RepositoryError('Usuario o palabras de recuperación incorrectos.', 401);
    if (!phrase || !stored || !expectedRecoveryPhraseHash || !valid) throw failure();
    const passwordHash = await hashPassword(password);
    const recoveryPhrase = generateRecoveryPhrase();
    const recoveryPhraseHash = await hashPassword(recoveryPhrase);
    const { token, session } = this.newSession(previousToken);
    const user = await this.repository.recover(stored.id, expectedRecoveryPhraseHash, passwordHash, recoveryPhraseHash, session);
    if (!user) throw failure();
    return { user, token, recoveryPhrase };
  }

  async login(input: unknown, previousToken: string | null): Promise<AuthenticatedSession> {
    const { username, password } = credentials(input, false);
    const stored = await this.repository.findUser(username);
    const valid = await verifyPassword(password, stored?.passwordHash ?? null);
    if (!stored?.passwordHash || !valid) throw new RepositoryError('Usuario o contraseña incorrectos.', 401);
    const { token, session } = this.newSession(previousToken);
    const user = await this.repository.login(stored.id, stored.passwordHash, session);
    if (!user) throw new RepositoryError('Usuario o contraseña incorrectos.', 401);
    return { user, token };
  }

  async changePassword(input: unknown, token: string | null): Promise<User> {
    const user = await this.authenticate(token);
    if (!user || !token) throw new RepositoryError('Tu sesión terminó. Inicia sesión de nuevo.', 401);
    if (!input || typeof input !== 'object' || !('currentPassword' in input) || !('newPassword' in input)
      || typeof input.currentPassword !== 'string' || typeof input.newPassword !== 'string') {
      throw new RepositoryError('Escribe la contraseña actual y la nueva.');
    }
    if (!input.currentPassword || Array.from(input.currentPassword).length > MAX_PASSWORD_LENGTH) {
      throw new RepositoryError('La contraseña actual no es correcta.');
    }
    const { password } = credentials({ username: user.username, password: input.newPassword }, true);
    const stored = await this.repository.findUser(user.username);
    const expectedPasswordHash = stored?.passwordHash ?? null;
    const valid = await verifyPassword(input.currentPassword, expectedPasswordHash);
    if (!stored || stored.id !== user.id || !expectedPasswordHash || !valid) {
      throw new RepositoryError('La contraseña actual no es correcta.');
    }
    if (input.currentPassword === password) throw new RepositoryError('La nueva contraseña debe ser diferente de la actual.');
    const passwordHash = await hashPassword(password);
    const updated = await this.repository.changePassword(user.id, expectedPasswordHash, passwordHash, sessionHash(token));
    if (!updated) throw new RepositoryError('Tu contraseña cambió durante la solicitud. Inténtalo de nuevo.', 409);
    return updated;
  }

  async logout(token: string | null): Promise<void> {
    if (token) await this.repository.deleteSession(sessionHash(token));
  }
}
