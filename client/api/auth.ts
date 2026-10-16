import type { Credentials, PasswordChangeInput, RecoveryCredentials, RecoverySessionResponse, SessionResponse } from '../../shared/types';
import { request } from './request';

export const authApi = {
  session: (signal?: AbortSignal) => request<SessionResponse>('/api/auth/session', { signal }),
  login: (credentials: Credentials) => request<SessionResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
  register: (credentials: Credentials) => request<RecoverySessionResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(credentials) }),
  recover: (credentials: RecoveryCredentials) => request<RecoverySessionResponse>('/api/auth/recover', { method: 'POST', body: JSON.stringify(credentials) }),
  changePassword: (input: PasswordChangeInput) => request<SessionResponse>('/api/auth/password', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request<SessionResponse>('/api/auth/logout', { method: 'POST' }),
};
