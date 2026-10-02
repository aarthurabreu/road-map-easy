/* Generated with a build-specific, closed public-asset allowlist. */
const cacheName = 'easy-road-map-shell-' + '__BUILD_ID__';
const assets = __PUBLIC_ASSETS__;
const shellPath = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      const request = new Request(shellPath, { credentials: 'omit', cache: 'no-store', headers: { Accept: 'text/html' } });
      const response = await fetch(request);
      const url = new URL(response.url);
      if (response.status !== 200 || response.redirected || url.origin !== self.location.origin || url.pathname !== shellPath || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Public shell unavailable');
      await cache.put(shellPath, response);
      await cache.addAll(assets.map((url) => new Request(url, { credentials: 'omit', cache: 'reload' })));
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  // No skipWaiting/clients.claim: old tabs finish with their original assets.
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('easy-road-map-shell-') && name !== cacheName) await caches.delete(name);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === shellPath)) {
    event.respondWith(fetch(request).catch(async () => {
      const shell = await (await caches.open(cacheName)).match(shellPath);
      return shell || Response.error();
    }));
    return;
  }
  // APIs, invites, RSC requests, Google data/photos and all other URLs bypass cache.
  if (!assets.includes(url.pathname)) return;
  event.respondWith((async () => (await (await caches.open(cacheName)).match(url.pathname)) || fetch(request))());
});
