const CACHE_NAME    = 'mifondo-v2';
const CACHE_OFFLINE = 'mifondo-fonts-v2';

const ARCHIVOS_CACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ARCHIVOS_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k!==CACHE_NAME && k!==CACHE_OFFLINE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Las llamadas a GAS van siempre a la red — nunca al caché
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleapis.com')) {
    return;
  }

  // Fuentes de Google: caché con fallback de red
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_OFFLINE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => new Response('', {status:503}));
        })
      )
    );
    return;
  }

  // Resto: caché primero, red en background
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fromNet = fetch(event.request).then(resp => {
        if (resp && resp.status===200 && resp.type==='basic') {
          caches.open(CACHE_NAME).then(c => c.put(event.request, resp.clone()));
        }
        return resp;
      }).catch(() => null);
      return cached || fromNet;
    })
  );
});
