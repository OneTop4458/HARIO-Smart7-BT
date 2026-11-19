const CACHE = 'smart7-offline-v2';
const assets = [
  './', './index.html', './style.css', './app.js', './protocol.js', './recipes.js', './app.webmanifest',
  './coffee.webp', './icon-192.png', './icon-512.png'
].map(path => new URL(path, self.registration.scope).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(assets)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('smart7-offline-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !assets.includes(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request, { cache: 'no-cache', signal: AbortSignal.timeout(2500) });
      if (response.ok) {
        await cache.put(request, response.clone());
        return response;
      }
      return await cache.match(request) || response;
    } catch {
      return await cache.match(request) || Response.error();
    }
  })());
});
