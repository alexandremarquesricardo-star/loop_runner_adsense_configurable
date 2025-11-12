# Playloop.run site bundle

Includes:
- index.html (game page with SEO, structured data, accessible UI)
- about/how-to-play/updates/privacy/terms pages with real content
- shared styles.css
- robots.txt, sitemap.xml, ads.txt
- manifest.webmanifest
- sw.js (optional service worker for basic caching)

Notes
- Keep your existing **game.js** and assets in the site root.
- Place **ads.txt** at the root domain.
- Ensure **/looprunner-preview.png**, **favicon.ico**, and **apple-touch-icon.png** exist.
- Register the service worker by adding:
  <script>if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');</script>

Last updated: 2025-11-12
