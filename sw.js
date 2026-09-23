// =========================================================
// VERSION DEFINITION (Bump this to 'v2.1', 'v2.2', etc.)
// =========================================================
const APP_VERSION = 'v2.0';
const CACHE_NAME = `geologger-app-${APP_VERSION}`;
const TILE_CACHE_NAME = 'geologger-osm-tiles-v1'; // Map tiles preserved across app updates

// App shell and core static libraries required offline
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  `./app.js?v=${APP_VERSION}`,
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
];

// 1. INSTALL: Pre-cache static shell & force skipWaiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log(`[SW] Pre-caching static app shell for version ${APP_VERSION}`);
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 2. ACTIVATE: Automatically purge all legacy app caches while preserving cached map tiles
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          // Delete old app versions, but keep the OSM map tiles intact
          if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) {
            console.log(`[SW] Purging old cache: ${key}`);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. FETCH: Strategy Routing
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // A. OSM Tiles: Cache-First, network fallback, cache on fetch
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cachedTile = await cache.match(event.request);
        if (cachedTile) return cachedTile;

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.ok) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          return new Response('', { status: 404, statusText: 'Tile Offline Unavailable' });
        }
      })
    );
    return;
  }

  // B. Navigation / HTML: Network-First, Cache fallback (Ensures latest UI online, keeps working offline)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request) || caches.match('./index.html'))
    );
    return;
  }

  // C. Static Assets & App JS: Cache-First, Network Fallback
  event.respondWith(
    caches.match(event.request, { ignoreSearch: false }).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      });
    })
  );
});
