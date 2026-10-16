export const SESSION_EXPIRED_EVENT = 'kindle-session-expired';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, options?: ErrorOptions) { super(message, options); }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const mutating = init?.method && !['GET', 'HEAD'].includes(init.method);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init, credentials: 'same-origin',
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(mutating ? { 'X-Requested-With': 'KindleHighlights' } : {}), ...init?.headers },
    });
  } catch (cause) {
    if (init?.signal?.aborted || (cause instanceof Error && cause.name === 'AbortError')) throw cause;
    throw new ApiError('No pudimos conectar con el servidor. Inténtalo de nuevo en unos momentos.', 0, { cause });
  }
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
