import type { User } from '../../shared/types.js';

export interface CredentialUser extends User {
  passwordHash: string | null;
  recoveryPhraseHash: string | null;
}

export interface NewSession {
  tokenHash: string;
  expiresAt: Date;
  previousTokenHash: string | null;
}

export interface AuthRepository {
  findUser(username: string): Promise<CredentialUser | null>;
  register(username: string, passwordHash: string, session: NewSession, recoveryPhraseHash: string): Promise<User>;
  login(userId: string, expectedPasswordHash: string, session: NewSession): Promise<User | null>;
  recover(userId: string, expectedRecoveryPhraseHash: string, passwordHash: string, recoveryPhraseHash: string, session: NewSession): Promise<User | null>;
  changePassword(userId: string, expectedPasswordHash: string, passwordHash: string, currentTokenHash: string): Promise<User | null>;
  findSession(tokenHash: string): Promise<User | null>;
  deleteSession(tokenHash: string): Promise<void>;
}
