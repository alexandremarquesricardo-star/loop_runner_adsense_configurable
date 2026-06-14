/* Loop Runner service worker
 *
 * Cache strategy: cache-first for the shipped static shell, with a versioned cache name.
 * Bump CACHE_VERSION whenever index.html / game.js / styles.css change so returning
 * visitors fetch the new bundle instead of being pinned to a stale one.
 *
 * On activate we sweep any older pl-cache-* entries so the disk footprint stays tight.
 */
const CACHE_VERSION = 'pl-cache-v14-2026-06-14';
const SHELL = [
  '/',
  '/styles.css',
  '/game.js',
  '/about.html',
  '/how-to-play.html',
  '/updates.html',
  '/privacy.html',
  '/terms.html',
  '/strategy.html',
  '/themes.html',
  '/power-ups.html',
  '/hall-of-fame.html',
];

self.addEventListener('install', e => {
  // Activate the new worker as soon as it's installed — we want the new shell to win.
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('pl-cache-') && k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  // Network-first for navigations so a fresh deploy is picked up immediately;
  // cache-first for static asset GETs to keep play snappy.
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(req).then(r => r || caches.match('/')))
    );
    return;
  }

  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
