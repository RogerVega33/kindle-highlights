export const SESSION_EXPIRED_EVENT = 'kindle-session-expired';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const mutating = init?.method && !['GET', 'HEAD'].includes(init.method);
  const response = await fetch(url, {
    ...init, credentials: 'same-origin',
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(mutating ? { 'X-Requested-With': 'KindleHighlights' } : {}), ...init?.headers },
  });
  if (response.status === 401 && !url.startsWith('/api/auth/') && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new ApiError('No pudimos leer la respuesta. Inténtalo de nuevo.', response.status); }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
      ? data.message : 'No se pudo completar la operación. Inténtalo de nuevo.';
    throw new ApiError(message, response.status);
  }
  return data as T;
}
