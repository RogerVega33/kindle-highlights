/* The production build supplies a content-based version and the public assets. */
const { cacheName, assets } = __PWA_CONFIG__;
const cachePrefix = 'kindle-highlights-static-';
const staticPaths = new Set(assets);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets.map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(cachePrefix) && name !== cacheName).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'GET_VERSION') event.ports?.[0]?.postMessage({ version: cacheName });
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Authentication, books, annotations and covers always go to the server.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      return await caches.open(cacheName).then(cache => cache.match('/')) ?? Response.error();
    }));
  } else if (staticPaths.has(url.pathname)) {
    event.respondWith(caches.open(cacheName).then(async cache => await cache.match(url.pathname) ?? fetch(request)));
  }
});
