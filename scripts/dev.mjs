import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}

function start(script, args) {
  const child = spawn(process.execPath, [resolve(root, script), ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  children.add(child);
  child.on('error', (error) => {
    console.error(`No se pudo iniciar el proyecto: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) stop(signal ? 1 : (code ?? 1));
  });
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());

console.log('Kindle highlights · Desarrollo');
console.log('Abre http://127.0.0.1:5173 cuando Vite esté listo.');
const backend = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', shell: false });
children.add(backend);
backend.on('error', error => { console.error(error.message); stop(1); });
backend.on('exit', (code, signal) => { children.delete(backend); if (!stopping) stop(signal ? 1 : (code ?? 1)); });
start('node_modules/vite/bin/vite.js', ['--host', '127.0.0.1']);
