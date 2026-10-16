import type { FastifyInstance, FastifyRequest } from 'fastify';
import { RepositoryError } from '../errors.js';
import type { Authentication } from './service.js';
import { SESSION_COOKIE, SESSION_SECONDS } from './service.js';

export function sessionToken(request: FastifyRequest): string | null {
  const matches = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(SESSION_COOKIE + '='));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(SESSION_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function cookie(token: string, secure: boolean, expires = false): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expires ? 0 : SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}

export function registerAuthRoutes(app: FastifyInstance, auth: Authentication): void {
  const attempts = new Map<string, { count: number; expires: number }>();
  function limit(request: FastifyRequest): void {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
    const key = request.ip;
    const current = attempts.get(key) ?? { count: 0, expires: now + 15 * 60 * 1000 };
    if (current.count >= 20 || (!attempts.has(key) && attempts.size >= 10000)) {
      throw new RepositoryError('Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.', 429);
    }
    current.count++;
    attempts.set(key, current);
  }
  for (const action of ['register', 'login', 'recover'] as const) {
    app.post('/api/auth/' + action, { bodyLimit: 4096, preHandler: async request => limit(request) }, async (request, reply) => {
      const session = await auth[action](request.body, sessionToken(request));
      reply.header('Set-Cookie', cookie(session.token, request.protocol === 'https'));
      return reply.code(action === 'register' ? 201 : 200).send({ user: session.user,
        ...('recoveryPhrase' in session ? { recoveryPhrase: session.recoveryPhrase } : {}) });
    });
  }
  app.get('/api/auth/session', async request => ({ user: await auth.authenticate(sessionToken(request)) }));
  app.post('/api/auth/password', { bodyLimit: 4096, preHandler: async request => limit(request) }, async request =>
    ({ user: await auth.changePassword(request.body, sessionToken(request)) }));
  app.post('/api/auth/logout', async (request, reply) => {
    await auth.logout(sessionToken(request));
    reply.header('Set-Cookie', cookie('', request.protocol === 'https', true));
    return { user: null };
  });
}
