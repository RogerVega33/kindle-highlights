import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { RepositoryError } from '../errors.js';

const DIST_DIRECTORY = fileURLToPath(new URL('../../dist/', import.meta.url));
const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// The production build contains only our index and explicitly allowed static assets.
async function sendBuildFile(filename: string, reply: FastifyReply, buildDirectory: string) {
  try {
    for (const directory of filename.startsWith('assets/') ? [buildDirectory, join(buildDirectory, 'assets')] : [buildDirectory]) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new RepositoryError('No se encontró el recurso.', 404);
    }
    const handle = await open(join(buildDirectory, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await handle.stat()).isFile()) throw new RepositoryError('No se encontró el recurso.', 404);
      return reply
        .type(STATIC_MIME[extname(filename)] || 'application/octet-stream')
        .header('Cache-Control', filename === 'index.html' ? 'no-store' : 'public, max-age=3600')
        .send(await handle.readFile());
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(error.code))) {
      throw new RepositoryError('No se encontró el recurso.', 404);
    }
    throw error;
  }
}

export function registerStaticRoutes(app: FastifyInstance, buildDirectory = DIST_DIRECTORY): void {
  app.get<{ Params: { '*': string } }>('/*', async (request, reply) => {
    const pathname = request.params['*'];
    if (pathname === 'api' || pathname.startsWith('api/') || pathname.split(/[\\/]/).some(part => part.startsWith('.'))) return reply.code(404).send({ message: 'No se encontró el recurso.' });
    const asset = /^(?:assets\/[A-Za-z0-9_.-]+\.(?:js|css|png|jpe?g|webp|gif|svg|woff2?|ttf|ico)|[A-Za-z0-9_-]+\.(?:svg|png|ico)|manifest\.webmanifest)$/.test(pathname);
    if (asset) return sendBuildFile(pathname, reply, buildDirectory);
    if (extname(pathname)) return reply.code(404).send({ message: 'No se encontró el recurso.' });
    return sendBuildFile('index.html', reply, buildDirectory);
  });
}
