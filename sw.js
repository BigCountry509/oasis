/*
 * Offline support.
 *
 * Everything the calculator needs is a handful of static files, so they are
 * cached on install and served from cache first. That means the tool keeps
 * working in a field with no signal, which is exactly where it gets used.
 *
 * Bump CACHE_VERSION whenever the tip data or the app files change, otherwise
 * phones that already installed it will keep serving the old copy.
 */

const CACHE_VERSION = 'nozzlecalc-v7';

const ASSETS = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'assets/styles.css',
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'js/app.js',
  'js/engine.js',
  'js/store.js',
  'js/config.js',
  'js/data/nozzles.js',
  'js/data/applications.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  /* Never cache the account API or a third-party backend: stale spray records
   * would be worse than an error message. */
  if (url.pathname.includes('/api/') || url.origin !== location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        /* Refresh in the background so the next load is current. */
        fetch(request)
          .then((response) => {
            if (response.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(request, response));
          })
          .catch(() => {});
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('index.html'));
    }),
  );
});
