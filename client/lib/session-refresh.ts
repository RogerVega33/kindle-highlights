import type { User } from '../../shared/types';
import { authApi } from '../api/auth';
import { ApiError } from '../api/request';

interface SessionRefreshOptions {
  signal?: AbortSignal;
  isCurrent: () => boolean;
  onSession: (user: User | null) => void;
  onError: (message: string) => void;
  onUnavailable?: () => void;
}

/** A failed check does not establish that the existing session has ended. */
export async function refreshSession({ signal, isCurrent, onSession, onError, onUnavailable }: SessionRefreshOptions): Promise<void> {
  try {
    const session = await authApi.session(signal);
    const user = session.user;
    if (user !== null && (!user || typeof user !== 'object'
      || typeof user.id !== 'string' || !user.id
      || typeof user.username !== 'string' || !user.username
      || (user.lastLoginAt !== null && typeof user.lastLoginAt !== 'string'))) {
      throw new Error('La respuesta de sesión no es válida.');
    }
    if (isCurrent()) onSession(user);
  } catch (cause) {
    if (!isCurrent()) return;
    if (cause instanceof ApiError && cause.status === 401) {
      onSession(null);
      onError('Tu sesión terminó. Inicia sesión de nuevo.');
    } else {
      onUnavailable?.();
      onError('No pudimos comprobar tu sesión. Inténtalo de nuevo en unos momentos.');
    }
  }
}
