import Fastify, { LogController, type FastifyBaseLogger } from 'fastify';
import { MAX_HTML_BYTES } from '../shared/limits.js';
import type { BooksResponse, DeleteBookResponse, HealthResponse, ImportFile, ImportResponse, User } from '../shared/types.js';
import { RepositoryError } from './errors.js';
import { bookListHttpQuery } from './book-list.js';
import { validFilename } from './filenames.js';
import { registerStaticRoutes } from './http/static-files.js';
import type { LibraryRepository } from './repositories/library-repository.js';
import type { Authentication } from './auth/service.js';
import { registerAuthRoutes, sessionToken } from './auth/http.js';
import { newRequestId, registerRequestLogging, requestContext, type DiagnosticLogger } from './logging.js';

declare module 'fastify' {
  interface FastifyRequest { user: User | null }
}

export interface AppOptions {
  repositoryForUser: (userId: string, logger?: DiagnosticLogger) => LibraryRepository;
  authentication: Authentication;
  serveStatic?: boolean;
  health: HealthResponse;
  trustedProxies?: string[];
  logger?: FastifyBaseLogger;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RepositoryError('El cuerpo de la solicitud debe ser un objeto JSON.');
  return value as Record<string, unknown>;
}

function importFiles(body: Record<string, unknown>): ImportFile[] {
  if (!Array.isArray(body.files) || body.files.length === 0) throw new RepositoryError('Selecciona al menos un archivo HTML.');
  return body.files.map(raw => {
    const file = object(raw);
    if (!validFilename(file.filename) || typeof file.html !== 'string') throw new RepositoryError('Cada archivo debe incluir un nombre válido y su contenido HTML.');
    if (Buffer.byteLength(file.html, 'utf8') > MAX_HTML_BYTES) throw new RepositoryError(`Cada HTML debe pesar como máximo ${MAX_HTML_BYTES / 1024 / 1024} MB.`);
    return { filename: file.filename, html: file.html };
  });
}

function targetBook(body: Record<string, unknown>): string | undefined {
  if (body.bookId === undefined) return undefined;
  if (typeof body.bookId !== 'string' || !body.bookId.trim() || body.bookId.length > 100) throw new RepositoryError('El libro de destino no es válido.');
  return body.bookId;
}

export async function buildApp({ repositoryForUser, authentication, serveStatic = false, health, trustedProxies, logger }: AppOptions) {
  const app = Fastify({
    bodyLimit: 32 * 1024 * 1024,
    ...(logger ? { loggerInstance: logger } : { logger: false }),
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: newRequestId,
    trustProxy: trustedProxies?.length ? trustedProxies : false,
  });
  app.decorateRequest('user', null);
  registerRequestLogging(app);

  function repository(request: import('fastify').FastifyRequest): LibraryRepository {
    if (!request.user) throw new RepositoryError('Inicia sesión para acceder a tu biblioteca.', 401);
    return repositoryForUser(request.user.id, request.log);
  }

  app.setErrorHandler((error, request, reply) => {
    const candidate = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const code = error instanceof RepositoryError ? error.statusCode : typeof candidate === 'number' && candidate >= 400 && candidate < 500 ? candidate : 500;
    const message = code === 500 || !(error instanceof Error) ? 'No se pudo completar la solicitud.' : error.message;
    const details = { event: 'http.request_failed', ...requestContext(request), statusCode: code, err: error };
    if (code >= 500) request.log.error(details);
    else request.log.warn(details);
    void reply.code(code).send({ message });
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) || !request.headers.origin) return;
    let origin: URL;
    try { origin = new URL(request.headers.origin); }
    catch { throw new RepositoryError('El origen de la solicitud no es válido.', 403); }
    const sameHost = origin.host === request.host && origin.protocol === `${request.protocol}:`;
    const localFrontend = !serveStatic && ['http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin.origin);
    if (!sameHost && !localFrontend) throw new RepositoryError('El origen de la solicitud no está permitido.', 403);
  });

  app.addHook('preHandler', async request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.url.startsWith('/api/')
      && request.headers['x-requested-with'] !== 'KindleHighlights') {
      throw new RepositoryError('La solicitud no es válida. Recarga la página e inténtalo de nuevo.', 403);
    }
    const route = request.routeOptions.url ?? '';
    if (route.startsWith('/api/books') || route === '/api/imports') {
      request.user = await authentication.authenticate(sessionToken(request));
      if (!request.user) throw new RepositoryError('Inicia sesión para acceder a tu biblioteca.', 401);
    }
  });

  registerAuthRoutes(app, authentication);

  app.get<{ Reply: HealthResponse }>('/api/health', async () => health);
  app.get<{ Querystring: Record<string, unknown>; Reply: BooksResponse }>('/api/books', async request => repository(request).listBooks(bookListHttpQuery(request.query)));
  app.get<{ Params: { id: string } }>('/api/books/:id', async request => repository(request).getBook(request.params.id));
  app.patch<{ Params: { id: string } }>('/api/books/:id', async request => {
    const body = object(request.body);
    if (typeof body.title !== 'string' || typeof body.author !== 'string') throw new RepositoryError('El título y el autor deben ser texto.');
    return repository(request).updateBook(request.params.id, { title: body.title, author: body.author });
  });
  app.delete<{ Params: { id: string }; Reply: DeleteBookResponse }>('/api/books/:id', async request => {
    await repository(request).deleteBook(request.params.id);
    return { deletedBookId: request.params.id };
  });
  app.patch<{ Params: { id: string; annotationId: string } }>('/api/books/:id/annotations/:annotationId', async request => {
    const body = object(request.body);
    if (typeof body.text !== 'string') throw new RepositoryError('El contenido de la anotación debe ser texto.');
    return repository(request).updateAnnotation(request.params.id, request.params.annotationId, body.text);
  });
  app.delete<{ Params: { id: string; annotationId: string } }>('/api/books/:id/annotations/:annotationId', async request =>
    repository(request).deleteAnnotation(request.params.id, request.params.annotationId));
  app.delete<{ Params: { id: string; annotationId: string } }>('/api/books/:id/annotations/:annotationId/edit', async request =>
    repository(request).restoreAnnotation(request.params.id, request.params.annotationId));

  app.post<{ Reply: ImportResponse }>('/api/imports', async request => {
    const body = object(request.body);
    return { results: await repository(request).importFiles(importFiles(body), targetBook(body)) };
  });

  app.put<{ Params: { id: string } }>('/api/books/:id/cover', async request => {
    const body = object(request.body);
    if (typeof body.dataUrl !== 'string') throw new RepositoryError('Debes enviar el contenido de la portada.');
    return repository(request).setCover(request.params.id, body.dataUrl);
  });
  app.delete<{ Params: { id: string } }>('/api/books/:id/cover', async request => repository(request).deleteCover(request.params.id));
  app.get<{ Params: { id: string } }>('/api/books/:id/cover', async (request, reply) => {
    const cover = await repository(request).getCover(request.params.id);
    if (!cover) throw new RepositoryError('Este libro todavía no tiene portada.', 404);
    return reply.type(cover.mime).header('Cache-Control', 'no-store').send(cover.bytes);
  });

  if (serveStatic) registerStaticRoutes(app);

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ message: 'No se encontró el recurso.' }));
  return app;
}
