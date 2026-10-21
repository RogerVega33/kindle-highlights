import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../server/app.js';
import type { Authentication } from '../server/auth/service.js';
import { parseRuntimeOptions } from '../server/runtime-options.js';

const proxy = '192.0.2.10';
const authentication: Authentication = {
  authenticate: async () => null,
  login: async () => ({ user: { id: 'fictional', username: 'Lectora', lastLoginAt: null }, token: 'a'.repeat(43) }),
  register: async () => { throw new Error('No se utiliza en esta prueba.'); },
  recover: async () => { throw new Error('No se utiliza en esta prueba.'); },
  changePassword: async () => { throw new Error('No se utiliza en esta prueba.'); },
  logout: async () => {},
};
const request = {
  method: 'POST' as const, url: '/api/auth/login', remoteAddress: proxy,
  headers: { host: 'backend:3001', origin: 'https://kindle.example',
    'x-forwarded-host': 'kindle.example', 'x-forwarded-proto': 'https',
    'x-forwarded-for': '198.51.100.20', 'x-requested-with': 'KindleHighlights' },
  payload: { username: 'Lectora', password: 'contraseña ficticia' },
};
function appFor(trustedProxies?: string[]) {
  return buildApp({ serveStatic: true, trustedProxies, authentication, health: { storage: 'postgres' },
    repositoryForUser: () => { throw new Error('Estas pruebas no deben consultar una biblioteca.'); } });
}

test('HTTPS desde el proxy confiable acepta el origen público y emite una cookie Secure', async t => {
  const app = await appFor(parseRuntimeOptions([], { TRUSTED_PROXY_IP: proxy }).trustedProxies);
  t.after(() => app.close());
  const response = await app.inject(request);
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['set-cookie']), /; Secure/);
  assert.equal(response.headers['cache-control'], 'no-store');
  const external = await app.inject({ ...request, headers: { ...request.headers, origin: 'https://externo.invalid' } });
  assert.equal(external.statusCode, 403);
});

test('conexiones no confiables no pueden falsificar host y protocolo con cabeceras de proxy', async t => {
  for (const trustedProxies of [parseRuntimeOptions([], { TRUSTED_PROXY_IP: '' }).trustedProxies, [proxy]]) {
    const app = await appFor(trustedProxies);
    t.after(() => app.close());
    const response = await app.inject({ ...request, remoteAddress: '192.0.2.11' });
    assert.equal(response.statusCode, 403);
    const { origin: _origin, ...headers } = request.headers;
    const direct = await app.inject({ ...request, remoteAddress: '192.0.2.11', headers });
    assert.equal(direct.statusCode, 200);
    assert.doesNotMatch(String(direct.headers['set-cookie']), /; Secure/);
  }
});

test('el límite de intentos distingue clientes del proxy y no acepta IP falsificada fuera de él', async t => {
  const app = await appFor([proxy]);
  t.after(() => app.close());
  for (let index = 0; index < 20; index++) assert.equal((await app.inject(request)).statusCode, 200);
  assert.equal((await app.inject(request)).statusCode, 429);
  assert.equal((await app.inject({ ...request, headers: { ...request.headers, 'x-forwarded-for': '198.51.100.21' } })).statusCode, 200);
  for (let index = 0; index < 21; index++) {
    const { origin: _origin, ...headers } = request.headers;
    const response = await app.inject({ ...request, remoteAddress: '192.0.2.11',
      headers: { ...headers, 'x-forwarded-for': `203.0.113.${index + 1}` } });
    assert.equal(response.statusCode, index < 20 ? 200 : 429);
  }
});

test('el proxy se configura sólo por IP explícita, sin confiar en cualquier origen', () => {
  assert.deepEqual(parseRuntimeOptions(['--trusted-proxy', proxy, '--trusted-proxy', '::1']).trustedProxies, [proxy, '::1']);
  for (const value of ['true', '*', '1', '0.0.0.0/0', 'loopback', '192.0.2.0/24']) {
    assert.throws(() => parseRuntimeOptions(['--trusted-proxy', value]), /dirección IP exacta/);
  }
  assert.throws(() => parseRuntimeOptions(['--trusted-proxy']), /dirección IP exacta/);
});

test('TRUSTED_PROXY_IP admite una IP exacta y vacío conserva el acceso directo', () => {
  for (const value of [proxy, '2001:db8::10', `  ${proxy}  `]) {
    assert.deepEqual(parseRuntimeOptions([], { TRUSTED_PROXY_IP: value }).trustedProxies, [value.trim()]);
  }
  for (const value of [undefined, '', '   ']) {
    assert.equal(parseRuntimeOptions([], { TRUSTED_PROXY_IP: value }).trustedProxies, undefined);
  }
});

test('TRUSTED_PROXY_IP rechaza redes, listas y valores ambiguos sin exponerlos en el error', () => {
  for (const value of ['true', '*', '1', '0.0.0.0/0', 'loopback', '192.0.2.0/24', `${proxy},::1`, `${proxy} ::1`]) {
    assert.throws(() => parseRuntimeOptions([], { TRUSTED_PROXY_IP: value }), {
      message: 'TRUSTED_PROXY_IP requiere la dirección IP exacta del proxy.',
    });
  }
});

test('los proxies explícitos por argumento tienen prioridad sin sumar los del entorno', () => {
  for (const value of ['192.0.2.11', 'invalid']) {
    assert.deepEqual(parseRuntimeOptions(['--trusted-proxy', proxy, '--trusted-proxy', '::1'], {
      TRUSTED_PROXY_IP: value,
    }).trustedProxies, [proxy, '::1']);
  }
});
