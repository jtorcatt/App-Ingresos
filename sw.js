// ============================================================
// SERVICE WORKER — MiFondo PWA
// Versión de caché: incrementá este número cada vez que
// actualices los archivos para que el SW se refresque.
// ============================================================
const CACHE_NAME    = 'mifondo-v1';
const CACHE_OFFLINE = 'mifondo-offline-v1';

// Archivos que se guardan en caché para uso offline
const ARCHIVOS_CACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  // Fuentes de Google (se cachean en runtime — ver abajo)
];

// ── INSTALL: pre-cachear assets estáticos ──────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-cacheando archivos principales');
      return cache.addAll(ARCHIVOS_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar cachés viejas ────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== CACHE_OFFLINE)
          .map(k => {
            console.log('[SW] Eliminando caché antigua:', k);
            return caches.delete(k);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia híbrida ───────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Las peticiones a la WebApp de Google (fetch de sincronización)
  // NO deben ser interceptadas por el SW — van directo a la red.
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleapis.com')) {
    return; // deja pasar al navegador
  }

  // Fuentes de Google: Cache-First con fallback de red
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_OFFLINE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // Resto de recursos: Cache-First, con actualización en background
  // (Stale While Revalidate simplificado)
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request)
        .then(networkResp => {
          // Actualizar caché si la respuesta es válida
          if (networkResp && networkResp.status === 200 && networkResp.type === 'basic') {
            const cloned = networkResp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          }
          return networkResp;
        })
        .catch(() => null);

      // Devolver caché inmediatamente; la red actualiza en background
      return cached || fetchPromise;
    })
  );
});

// ── MENSAJE desde la app (e.g. forzar actualización) ────────
self.addEventListener('message', event => {
  if (event.data && event.data.tipo === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
