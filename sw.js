self.addEventListener('install', e => {
  e.waitUntil(caches.open('pl-cache-v1').then(c=>c.addAll([
    '/', '/styles.css', '/game.js', '/about.html', '/how-to-play.html', '/updates.html', '/privacy.html', '/terms.html'
  ])));
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});