import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import pino, { type DestinationStream } from 'pino';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import { RepositoryError } from './errors.js';

const messages = {
  'http.request_started': 'Solicitud recibida.',
  'http.request_completed': 'Solicitud completada.',
  'http.request_failed': 'Error al procesar la solicitud.',
  'http.request_aborted': 'El cliente interrumpió la solicitud.',
  'http.request_timeout': 'La conexión agotó su tiempo de espera.',
  'import.parse_failed': 'No se pudo interpretar una importación.',
  'import.storage_failed': 'No se pudo guardar una importación.',
  'database.rollback_failed': 'No se pudo revertir una transacción.',
  'database.idle_error': 'Se interrumpió una conexión inactiva con PostgreSQL.',
  'database.prepare_failed': 'No se pudo preparar PostgreSQL.',
  'database.close_failed': 'No se pudo cerrar PostgreSQL correctamente.',
  'server.starting': 'Iniciando el servidor.',
  'server.ready': 'Servidor disponible.',
  'server.start_failed': 'No se pudo iniciar el servidor.',
  'server.stopping': 'Deteniendo el servidor.',
  'server.stopped': 'Servidor detenido.',
  'server.shutdown_failed': 'No se pudo detener el servidor correctamente.',
  'framework.log': 'Aviso del servidor HTTP.',
} as const;

type LogEvent = keyof typeof messages;
export interface LogDetails {
  event: LogEvent;
  err?: unknown;
  method?: string;
  route?: string;
  statusCode?: number;
  durationMs?: number;
  fileIndex?: number;
  port?: number;
  clientIp?: string;
  peerIp?: string;
  protocol?: 'http' | 'https';
}

/** Repositories only depend on this small diagnostic contract. */
export interface DiagnosticLogger {
  info(details: LogDetails): void;
  warn(details: LogDetails): void;
  error(details: LogDetails): void;
}

// Only registered, static templates may enter logs. New routes default to "unmatched"
// until explicitly added here; raw paths, IDs and query strings are never a fallback.
const routes = new Set([
  '/api/health', '/api/books', '/api/books/:id', '/api/books/:id/annotations/:annotationId',
  '/api/books/:id/cover', '/api/imports', '/api/auth/register', '/api/auth/login',
  '/api/auth/recover', '/api/auth/session', '/api/auth/password', '/api/auth/logout', '/*',
  '/api/books/random-annotation', '/api/books/:id/annotations/:annotationId/edit',
]);
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const errorCodes = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  'EHOSTUNREACH', 'ENETUNREACH', 'EADDRINUSE', 'EACCES', 'EPERM', 'ENOENT',
  '08000', '08001', '08003', '08004', '08006', '08P01', '22001', '22003', '22021',
  '22P02', '23502', '23503', '23505', '23514', '40001', '40P01', '42P01', '42703',
  '53300', '53400', '57014', '57P01', '57P02', '57P03',
  'FST_ERR_CTP_INVALID_JSON_BODY', 'FST_ERR_CTP_BODY_TOO_LARGE',
  'FST_ERR_CTP_INVALID_MEDIA_TYPE', 'FST_ERR_VALIDATION',
  'FST_ERR_REP_ALREADY_SENT', 'FST_ERR_REP_INVALID_PAYLOAD_TYPE',
]);
const requestIdPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const levels = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

function safeBindings(bindings: Record<string, unknown>): Record<string, string> {
  try {
    return {
      ...(typeof bindings.reqId === 'string' && requestIdPattern.test(bindings.reqId) ? { reqId: bindings.reqId } : {}),
    };
  } catch { return {}; }
}

function safeError(error: unknown): { type: string; code?: string } {
  try {
    const type = error instanceof RepositoryError ? 'RepositoryError'
      : error instanceof TypeError ? 'TypeError'
        : error instanceof RangeError ? 'RangeError'
          : error instanceof ReferenceError ? 'ReferenceError'
            : error instanceof SyntaxError ? 'SyntaxError'
              : error instanceof Error ? 'Error' : 'UnknownError';
    // Never serialize the error: message, stack, SQL details, cause and custom
    // properties may all contain credentials or private imported content.
    const code = error && typeof error === 'object'
      ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
    return typeof code === 'string' && errorCodes.has(code) ? { type, code } : { type };
  } catch {
    return { type: 'UnknownError' };
  }
}

// Compare equivalent IPv6 spellings and IPv4-mapped addresses without changing
// the address printed in the log. Inputs have already passed isIP validation.
function comparableIp(address: string): string {
  const [ip, zone] = address.split('%', 2);
  const literal = isIP(ip) === 4 ? `::ffff:${ip}` : ip;
  return new URL(`http://[${literal}]/`).hostname + (zone ? `%${zone}` : '');
}

function safeFields(input: unknown): { event: LogEvent } & Record<string, unknown> {
  if (!input || typeof input !== 'object' || input instanceof Error) {
    return { event: 'framework.log', ...(input instanceof Error ? { error: safeError(input) } : {}) };
  }
  const source = input as Record<string, unknown>;
  const event = typeof source.event === 'string' && Object.hasOwn(messages, source.event)
    ? source.event as LogEvent : 'framework.log';
  const fields: { event: LogEvent } & Record<string, unknown> = { event };
  if (source.err !== undefined) fields.error = safeError(source.err);
  // Unrecognised framework records must not supply arbitrary context or text.
  if (event === 'framework.log') return fields;
  if (source.method !== undefined) fields.method = typeof source.method === 'string' && methods.has(source.method) ? source.method : 'OTHER';
  if (source.route !== undefined) fields.route = typeof source.route === 'string' && routes.has(source.route) ? source.route : 'unmatched';
  if (event.startsWith('http.')) {
    // Addresses are the only request-derived strings allowed here. Never log raw
    // forwarding headers: an untrusted client can put arbitrary content in them.
    for (const key of ['clientIp', 'peerIp'] as const) {
      if (typeof source[key] === 'string' && isIP(source[key])) fields[key] = source[key];
    }
    if (typeof fields.clientIp === 'string' && typeof fields.peerIp === 'string'
      && comparableIp(fields.clientIp) === comparableIp(fields.peerIp)) delete fields.clientIp;
    if (source.protocol === 'http' || source.protocol === 'https') fields.protocol = source.protocol;
  }
  if (Number.isInteger(source.statusCode) && Number(source.statusCode) >= 100 && Number(source.statusCode) <= 599) fields.statusCode = source.statusCode;
  if (typeof source.durationMs === 'number' && Number.isFinite(source.durationMs) && source.durationMs >= 0) fields.durationMs = Math.round(source.durationMs * 1000) / 1000;
  if (Number.isSafeInteger(source.fileIndex) && Number(source.fileIndex) > 0) fields.fileIndex = source.fileIndex;
  if (Number.isInteger(source.port) && Number(source.port) > 0 && Number(source.port) <= 65535) fields.port = source.port;
  return fields;
}

/** Allowlist records AND messages, including logging performed internally by Fastify. */
export function createLogger(destination: DestinationStream = process.stdout): FastifyBaseLogger {
  const logger: FastifyBaseLogger = pino({
    level: 'info',
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: label => ({ level: label }),
      bindings: safeBindings,
    },
    hooks: {
      logMethod(args, method) {
        let fields: ReturnType<typeof safeFields>;
        try { fields = safeFields(args[0]); }
        catch { fields = { event: 'framework.log', error: { type: 'UnknownError' } }; }
        method.call(this, fields, messages[fields.event]);
      },
    },
  }, destination);
  // Pino does not inherit the bindings formatter when creating children.
  // Filter before serialization and retain only a recognised child log level;
  // custom prefixes/serializers must not bypass the shared privacy policy.
  const child = logger.child;
  function protect(instance: FastifyBaseLogger): FastifyBaseLogger {
    instance.child = function (bindings, options) {
      const safeOptions = options?.level && levels.has(options.level) ? { level: options.level } : {};
      return protect(child.call(this, safeBindings(bindings), safeOptions));
    };
    return instance;
  }
  return protect(logger);
}

export const newRequestId = (): string => randomUUID();

export function requestContext(request: FastifyRequest): Pick<LogDetails,
  'method' | 'route' | 'clientIp' | 'peerIp' | 'protocol'> {
  return {
    method: request.method,
    route: request.routeOptions.url ?? 'unmatched',
    clientIp: request.ip,
    peerIp: request.raw.socket.remoteAddress,
    protocol: request.protocol === 'http' || request.protocol === 'https' ? request.protocol : undefined,
  };
}

function isHealthCheck(request: FastifyRequest): boolean {
  return request.routeOptions.url === '/api/health' && (request.method === 'GET' || request.method === 'HEAD');
}

export function registerRequestLogging(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-ID', request.id);
    if (isHealthCheck(request)) return;
    request.log.info({ event: 'http.request_started', ...requestContext(request) });
  });
  app.addHook('onResponse', async (request, reply) => {
    if (isHealthCheck(request) && reply.statusCode >= 200 && reply.statusCode < 300) return;
    request.log.info({ event: 'http.request_completed', ...requestContext(request), statusCode: reply.statusCode, durationMs: reply.elapsedTime });
  });
  app.addHook('onRequestAbort', async request => {
    request.log.warn({ event: 'http.request_aborted', ...requestContext(request) });
  });
  app.addHook('onTimeout', async (request, reply) => {
    request.log.warn({ event: 'http.request_timeout', ...requestContext(request), durationMs: reply.elapsedTime });
  });
}
