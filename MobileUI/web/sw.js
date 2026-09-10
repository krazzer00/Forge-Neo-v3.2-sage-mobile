/* Service worker: кеширует только статику приложения.
   Запросы к /api/ и /forge/ всегда идут в сеть. */
const CACHE = 'forge-mobile-v4';
const ASSETS = [
  '/', '/index.html', '/css/app.css',
  '/js/app.js', '/js/core.js', '/js/ui.js', '/js/state.js', '/js/gen.js',
  '/js/extensions.js', '/js/presets.js', '/js/characters.js',
  '/js/t2i.js', '/js/i2i.js', '/js/mask.js',
  '/js/extras.js', '/js/browser.js', '/js/settings.js',
  '/manifest.webmanifest', '/icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/forge/')) return;

  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp && resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});
