import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('los COPY del Dockerfile incluyen todo lo necesario para compilar la imagen y la PWA', async t => {
  const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');
  const stage = /FROM dependencies AS build\n([\s\S]*?)RUN npm run build/.exec(dockerfile);
  assert.ok(stage, 'La etapa de build debe poder verificarse sin ejecutar contenedores.');
  const directory = await mkdtemp(join(tmpdir(), 'kindle-docker-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // Only explicit application sources: never copy a checkout, environment files or credentials.
  const allowed = new Set([
    'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts', 'index.html',
    'client', 'server', 'shared', 'tests', 'public', 'database/schema.sql',
    'scripts/copy-schema.mjs', 'scripts/pwa.ts', 'pwa',
  ]);
  for (const filename of ['package.json', 'package-lock.json']) {
    await cp(join(root, filename), join(directory, filename));
  }
  for (const line of stage[1].split('\n').filter(line => line.startsWith('COPY '))) {
    const parts = line.trim().split(/\s+/).slice(1);
    const destination = parts.pop()!;
    assert.ok(!destination.startsWith('/') && !destination.includes('..'), 'El destino debe permanecer en el fixture.');
    for (const source of parts) {
      assert.ok(allowed.has(source), 'Revisar explícitamente la nueva fuente de build: ' + source);
      const target = destination.endsWith('/') ? join(directory, destination, basename(source)) : join(directory, destination);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(root, source), target, { recursive: true, filter: async path => {
        const name = basename(path);
        if (name.startsWith('.env') || /\.env(?:\.|$)/.test(name) || ['.git', '.ssh', '.aws', '.codex', 'node_modules'].includes(name)) return false;
        return !(await lstat(path)).isSymbolicLink();
      } });
    }
  }

  // Reuse installed dependencies; no downloads, npm profiles, server or database execution.
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
  const execute = async (entry: string, args: string[] = []) => {
    try {
      await run(process.execPath, [join(directory, entry), ...args], {
        cwd: directory, timeout: 120_000,
        env: { PATH: dirname(process.execPath) + ':/usr/bin:/bin' },
      });
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      assert.fail([failure.message, failure.stdout, failure.stderr].filter(Boolean).join('\n'));
    }
  };
  await execute('node_modules/typescript/bin/tsc', ['--noEmit']);
  await execute('node_modules/vite/bin/vite.js', ['build']);
  await execute('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.server.json']);
  await execute('scripts/copy-schema.mjs');
  for (const filename of ['build/server/index.js', 'build/database/schema.sql', 'build/dist/index.html', 'build/dist/sw.js', 'build/dist/manifest.webmanifest']) {
    assert.ok((await readFile(join(directory, filename))).length > 0, filename);
  }
});
