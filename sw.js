// =========================================================
// VERSION DEFINITION (Bumped to v2.1 for GeoPDF & GeoTIFF)
// =========================================================
const APP_VERSION = 'v2.1';
const CACHE_NAME = `geologger-app-${APP_VERSION}`;
const TILE_CACHE_NAME = 'geologger-osm-tiles-v1'; // Preserved across app shell bumps

// App shell and core offline dependencies (Leaflet, Pako, PDF.js, GeoTIFF, Proj4)
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  `./app.js?v=${APP_VERSION}`,
  './icon-192.png',
  './icon-512.png',
  // Leaflet & Icons
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  // Zlib Decompression for compressed GeoPDF /GPTS streams
  'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js',
  // GeoPDF Engine (PDF.js + Worker)
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  // GeoTIFF & Reprojection Engine
  'https://unpkg.com/proj4',
  'https://unpkg.com/georaster',
  'https://unpkg.com/georaster-layer-for-leaflet'
];

// 1. INSTALL: Pre-cache static shell & activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log(`[SW] Pre-caching static app shell for version ${APP_VERSION}`);
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 2. ACTIVATE: Purge previous version app caches while preserving offline map tiles
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) {
            console.log(`[SW] Purging outdated cache: ${key}`);
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

  // B. Navigation / HTML: Network-First, Cache fallback (Ensures latest code online, offline durability)
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
