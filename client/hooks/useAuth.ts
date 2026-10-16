import { useCallback, useEffect, useRef, useState } from 'react';
import type { Credentials, PasswordChangeInput, RecoveryCredentials, User } from '../../shared/types';
import { authApi } from '../api/auth';
import { ApiError, SESSION_EXPIRED_EVENT } from '../api/request';
import { messageOf } from '../lib/format';
import { refreshSession } from '../lib/session-refresh';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState<{ userId: string; username: string; phrase: string; reason: 'register' | 'recover' } | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);

  const restore = useCallback(async (signal?: AbortSignal, blocking = true) => {
    if (inFlight.current) return;
    const current = ++sequence.current;
    if (blocking) setChecking(true);
    setError('');
    try {
      await refreshSession({
        signal,
        isCurrent: () => current === sequence.current,
        onSession: nextUser => {
          setSessionUnavailable(false);
          setUser(nextUser);
          setRecovery(pending => pending?.userId === nextUser?.id ? pending : null);
        },
        onError: setError,
        onUnavailable: () => setSessionUnavailable(true),
      });
    } finally { if (current === sequence.current) setChecking(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void restore(controller.signal);
    function expired() { sequence.current++; setSessionUnavailable(false); setUser(null); setRecovery(null); setChecking(false); setError('Tu sesión terminó. Inicia sesión de nuevo.'); }
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('kindle-auth');
      channel.current.onmessage = () => { if (!inFlight.current) { setUser(null); void restore(); } };
    }
    return () => {
      sequence.current++;
      controller.abort();
      channel.current?.close();
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
    };
  }, [restore]);

  async function submit(action: 'login' | 'register' | 'logout' | 'recover', credentials?: Credentials | RecoveryCredentials) {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = ++sequence.current;
    setBusy(true);
    setError('');
    try {
      const session = action === 'logout' ? await authApi.logout()
        : action === 'recover' ? await authApi.recover(credentials as RecoveryCredentials)
          : await authApi[action](credentials!);
      if (current === sequence.current) {
        setSessionUnavailable(false);
        setUser(session.user);
        setRecovery((action === 'register' || action === 'recover') && 'recoveryPhrase' in session && typeof session.recoveryPhrase === 'string' && session.user
          ? { userId: session.user.id, username: session.user.username, phrase: session.recoveryPhrase, reason: action } : null);
        channel.current?.postMessage('changed');
      }
    } catch (cause) { if (current === sequence.current) setError(messageOf(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function changePassword(input: PasswordChangeInput) {
    if (inFlight.current) throw new Error('Hay otra solicitud en curso. Inténtalo de nuevo.');
    if (!user) throw new Error('Inicia sesión para cambiar tu contraseña.');
    inFlight.current = true;
    const current = ++sequence.current;
    setBusy(true);
    setError('');
    try {
      const session = await authApi.changePassword(input);
      if (current !== sequence.current || session.user?.id !== user.id) throw new Error('La sesión cambió durante la solicitud.');
      setUser(session.user);
      channel.current?.postMessage('changed');
    } catch (cause) {
      if (current === sequence.current && cause instanceof ApiError && cause.status === 401) {
        setSessionUnavailable(false);
        setUser(null); setRecovery(null); setError(messageOf(cause));
      }
      throw cause;
    } finally { inFlight.current = false; setBusy(false); }
  }

  return { user, checking, sessionUnavailable, busy, error, recovery, changePassword, retry: () => void restore(undefined, !user),
    clearError: () => setError(''), finishRecovery: () => setRecovery(null),
    authenticate: (action: 'login' | 'register', credentials: Credentials) => submit(action, credentials),
    recover: (credentials: RecoveryCredentials) => submit('recover', credentials),
    logout: () => void submit('logout') };
}
