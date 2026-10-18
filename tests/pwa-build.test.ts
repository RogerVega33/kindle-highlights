import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'vite';
import { pwaBuild } from '../scripts/pwa.js';

test('el manifiesto y los iconos públicos tienen identidad estable y tamaños instalables', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon: { sizes: string }) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon: { sizes: string }) => icon.sizes === '512x512'));
  assert.ok(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable'));
  for (const icon of [...manifest.icons, { src: '/apple-touch-icon.png', sizes: '180x180' }]) {
    const bytes = await readFile(new URL('../public' + icon.src, import.meta.url));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16) + 'x' + bytes.readUInt32BE(20), icon.sizes);
  }
});

test('Vite emite un worker con los archivos compilados y versiona las actualizaciones por contenido', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kindle-pwa-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'public'));
  await mkdir(join(root, 'pwa'));
  for (const filename of ['manifest.webmanifest', 'favicon.svg', 'pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png', 'apple-touch-icon.png']) {
    await copyFile(new URL('../public/' + filename, import.meta.url), join(root, 'public', filename));
  }
  await copyFile(new URL('../pwa/service-worker.js', import.meta.url), join(root, 'pwa/service-worker.js'));
  await writeFile(join(root, 'index.html'), '<html><body><script type="module" src="/entry.js"></script></body></html>');
  await writeFile(join(root, 'entry.js'), 'console.log("interfaz ficticia uno");');
  const compile = async () => {
    // No personal configuration, environment files, application server or database.
    await build({ root, configFile: false, envDir: false, plugins: [pwaBuild()], logLevel: 'silent', build: { outDir: 'dist' } });
    const source = await readFile(join(root, 'dist/sw.js'), 'utf8');
    const config = JSON.parse(/const \{ cacheName, assets \} = (.*);/.exec(source)![1]) as { cacheName: string; assets: string[] };
    assert.match(config.cacheName, /^kindle-highlights-static-[a-f0-9]{16}$/);
    const html = await readFile(join(root, 'dist/index.html'), 'utf8');
    assert.ok(html.includes(`<meta name="app-version" content="${config.cacheName}">`));
    assert.ok(!html.includes('__KINDLE_PWA_VERSION__'));
    assert.ok(config.assets.some(path => /^\/assets\/.+\.js$/.test(path)));
    assert.ok(config.assets.every(path => !path.startsWith('/api')));
    for (const path of config.assets) await readFile(join(root, 'dist', path === '/' ? 'index.html' : path.slice(1)));
    return { source, config };
  };
  const first = await compile();
  assert.deepEqual(await compile(), first, 'Una compilación idéntica no debe generar otra actualización.');
  await writeFile(join(root, 'entry.js'), 'console.log("interfaz ficticia dos");');
  const updated = await compile();
  assert.notEqual(updated.config.cacheName, first.config.cacheName);
  assert.notDeepEqual(updated.config.assets, first.config.assets);
  await writeFile(join(root, 'index.html'), '<html><head><title>Nuevo texto ficticio</title></head><body><script type="module" src="/entry.js"></script></body></html>');
  const htmlUpdated = await compile();
  assert.notEqual(htmlUpdated.config.cacheName, updated.config.cacheName, 'Los cambios exclusivos del HTML también deben cambiar la versión.');
});
