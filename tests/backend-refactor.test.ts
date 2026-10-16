import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import type { Annotation, Book, BookDetail, ImportResult } from '../shared/types.js';
import { buildTestApp as buildApp } from './helpers/app.js';
import { registerStaticRoutes } from '../server/http/static-files.js';
import type { LibraryRepository } from '../server/repositories/library-repository.js';
import { FakeLibraryRepository } from './helpers/fake-library-repository.js';
import { BOOKS_PER_PAGE } from '../shared/limits.js';

const emptyLibrary = { books: [], page: 1, pageSize: BOOKS_PER_PAGE, totalBooks: 0, totalAnnotations: 0, matchingBooks: 0, totalPages: 1 };

const html = `<div class="bookTitle">Libro sintético</div><div class="authors">Autora</div>
  <div class="sectionHeading">Una sección</div>
  <div class="noteHeading">Subrayado - Página 4</div><div class="noteText">Una idea original.</div>
  <div class="noteHeading">Nota - Página 4</div><div class="noteText">Una nota original.</div>`;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6u4AAAAASUVORK5CYII=';

test('las rutas permiten un repositorio asíncrono sin cambiar los contratos ni la importación aditiva', async t => {
  const fixture = new FakeLibraryRepository();
  const repository: LibraryRepository = {
    listBooks: async options => fixture.listBooks(options),
    getBook: async id => fixture.getBook(id),
    updateBook: async (id, metadata) => fixture.updateBook(id, metadata),
    deleteBook: async id => fixture.deleteBook(id),
    updateAnnotation: async (bookId, annotationId, text) => fixture.updateAnnotation(bookId, annotationId, text),
    deleteAnnotation: async (bookId, annotationId) => fixture.deleteAnnotation(bookId, annotationId),
    importFiles: async (files, bookId) => fixture.importFiles(files, bookId),
    setCover: async (id, dataUrl) => fixture.setCover(id, dataUrl),
    deleteCover: async id => fixture.deleteCover(id),
    getCover: async id => fixture.getCover(id),
  };
  const app = await buildApp({ repository });
  t.after(async () => { await app.close(); });

  assert.deepEqual((await app.inject('/api/books')).json(), emptyLibrary);
  const payload = { files: [{ filename: 'prueba.html', html }] };
  const imported = (await app.inject({ method: 'POST', url: '/api/imports', payload }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(imported.added, 2);
  assert.ok(imported.bookId);
  const bookPath = `/api/books/${imported.bookId}`;
  const before = (await app.inject(bookPath)).json<BookDetail>();
  const note = before.annotations.find(annotation => annotation.kind === 'note')!;
  const updated = (await app.inject({ method: 'PATCH', url: `${bookPath}/annotations/${note.id}`, payload: { text: 'Edición\n\ncon párrafos.' } })).json<Annotation>();
  assert.equal(updated.text, 'Edición\n\ncon párrafos.');
  assert.equal(updated.originalText, note.text);
  assert.equal(updated.edited, true);
  const metadata = (await app.inject({ method: 'PATCH', url: bookPath, payload: { title: 'Título personalizado', author: '' } })).json<Book>();
  assert.equal(metadata.title, 'Título personalizado');
  const cover = await app.inject({ method: 'PUT', url: `${bookPath}/cover`, payload: { dataUrl: png } });
  assert.equal(cover.statusCode, 200);
  assert.match(String((await app.inject(`${bookPath}/cover`)).headers['content-type']), /^image\/png/);

  const repeated = (await app.inject({ method: 'POST', url: '/api/imports', payload }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(repeated.added, 0);
  assert.equal(repeated.repeated, 2);
  const after = (await app.inject(bookPath)).json<BookDetail>();
  assert.equal(after.annotations.find(annotation => annotation.id === note.id)?.text, updated.text);
  assert.equal(after.title, metadata.title);
  assert.equal(after.coverUrl, cover.json<Book>().coverUrl);

  assert.equal((await app.inject({ method: 'DELETE', url: `${bookPath}/annotations/${note.id}` })).json<BookDetail>().noteCount, 0);
  const restored = (await app.inject({ method: 'POST', url: '/api/imports', payload }))
    .json<{ results: ImportResult[] }>().results[0];
  assert.equal(restored.added, 1);
  assert.equal(restored.repeated, 1);
  assert.equal((await app.inject({ method: 'DELETE', url: `${bookPath}/cover` })).json<Book>().coverUrl, null);
  assert.deepEqual((await app.inject({ method: 'DELETE', url: bookPath })).json(), { deletedBookId: imported.bookId });
  assert.deepEqual((await app.inject('/api/books')).json(), emptyLibrary);
  const missing = await app.inject(bookPath);
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { message: 'No se encontró el libro.' });
});

test('las rutas estáticas extraídas conservan MIME, SPA y rechazo de enlaces sintéticos', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'kindle-static-test-'));
  const directory = join(fixture, 'publico');
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(join(directory, 'index.html'), '<html><body>Interfaz sintética</body></html>');
  await writeFile(join(directory, 'assets', 'app.js'), 'console.log("Archivo sintético");');
  await writeFile(join(directory, 'assets', 'app.css'), 'body { color: black; }');
  await writeFile(join(directory, 'sw.js'), '// Worker sintético');
  await writeFile(join(directory, 'manifest.webmanifest'), '{"name":"Aplicación ficticia"}');
  await writeFile(join(fixture, 'fuera.js'), 'Archivo sintético fuera del directorio público.');
  await symlink(join(fixture, 'fuera.js'), join(directory, 'assets', 'enlace.js'));
  const app = Fastify();
  registerStaticRoutes(app, directory);
  const alias = join(fixture, 'alias');
  await symlink(directory, alias, 'dir');
  const aliasApp = Fastify();
  registerStaticRoutes(aliasApp, alias);
  const linkedDirectory = join(fixture, 'publico-con-enlace');
  await mkdir(linkedDirectory);
  await symlink(join(directory, 'assets'), join(linkedDirectory, 'assets'), 'dir');
  const linkedAssetsApp = Fastify();
  registerStaticRoutes(linkedAssetsApp, linkedDirectory);
  t.after(async () => { await app.close(); await aliasApp.close(); await linkedAssetsApp.close(); await rm(fixture, { recursive: true, force: true }); });

  const script = await app.inject('/assets/app.js');
  assert.equal(script.statusCode, 200);
  assert.match(String(script.headers['content-type']), /^text\/javascript/);
  assert.match(String((await app.inject('/assets/app.css')).headers['content-type']), /^text\/css/);
  for (const [url, mime] of [['/sw.js', /^text\/javascript/], ['/manifest.webmanifest', /^application\/manifest\+json/]] as const) {
    const resource = await app.inject(url);
    assert.equal(resource.statusCode, 200);
    assert.match(String(resource.headers['content-type']), mime);
    assert.equal(resource.headers['cache-control'], 'no-store');
  }
  for (const url of ['/libros', '/books/11111111-1111-4111-8111-111111111111']) {
    const page = await app.inject(url);
    assert.equal(page.statusCode, 200);
    assert.match(page.payload, /Interfaz sintética/);
    assert.equal(page.headers['cache-control'], 'no-store');
  }
  const head = await app.inject({ method: 'HEAD', url: '/assets/app.js' });
  assert.equal(head.statusCode, 200);
  assert.equal(head.payload, '');
  for (const url of ['/api/no-existe', '/assets/app.js.map', '/assets/enlace.js', '/privado.txt', '/arbitrario.js', '/pwa/service-worker.js']) {
    assert.equal((await app.inject(url)).statusCode, 404);
  }
  assert.equal((await aliasApp.inject('/assets/app.js')).statusCode, 404);
  assert.equal((await linkedAssetsApp.inject('/assets/app.js')).statusCode, 404);
});
