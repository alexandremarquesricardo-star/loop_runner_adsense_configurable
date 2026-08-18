# Loop Runner — playloop.run

Free browser action game. Static site (HTML/CSS/vanilla JS canvas) deployed to GitHub Pages at [playloop.run](https://playloop.run).

## Local dev

```sh
npm run dev    # serves the site locally via `npx serve .`
```

## Deployment

GitHub Pages serves from the repo root. The `CNAME` file maps the site to `playloop.run`. Make sure `ads.txt`, `favicon.ico`, `apple-touch-icon.png`, and `looprunner-preview.png` are present at the root.

The service worker (`sw.js`) is included for basic caching but is not registered yet — add this to `index.html` to enable it:

```html
<script>if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');</script>
```

## AdSense

- Publisher: `ca-pub-3857946786580406`
- Slot (top banner + leaderboard modal): `7067398117`

## Supabase leaderboard

The leaderboard is backed by Supabase. The anon key is embedded client-side (it's safe — RLS policies in `supabase.sql` restrict writes appropriately).

### Setup (one-time)

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase.sql` to create the `scores` table and policies.
3. In `game.js`, replace `SB_URL` and `SB_KEY` with your project URL and anon key.

If Supabase is unreachable, the leaderboard falls back to a local (per-device) list automatically.

## Store art capture

`tools/capture.mjs` renders the portal/social art straight from the live game, so the
covers always match what the build actually looks like. Zero npm deps — it serves the
site over a built-in static server and drives Chrome via CDP.

```sh
node tools/capture.mjs                          # six cover JPEGs, Cyberpunk theme
node tools/capture.mjs --theme cosmic           # any theme key from THEMES
node tools/capture.mjs --video --seconds 10     # plus landscape + portrait MP4s (needs ffmpeg)
node tools/capture.mjs --skip-stills --clip portrait
```

Output goes to `portal-build/store-assets/` (`--out` to change). It works by posing
the game through `window.__lrCapture`, a hook in `game.js` that only exists when the URL
carries `?capture=1` **and** the host is localhost — it can set an arbitrary score, and
the leaderboard has no server-side validation, so it must never be reachable in production.

Clips are rendered offline: the world is paused and advanced by an exact 1/30s per frame.
Headless software-GL renders far slower than real time, so recording live (via CDP
screencast) yields ~2fps; stepping decouples clip framerate from wall-clock and gives a
true 30fps at the cost of taking a few minutes to produce.

The 2026-06 covers were shot from a fresh run — a near-empty screen captioned
"WARMING UP" — which is what every portal reviewer saw first. Capture at a high score
with a bright theme, never from the opening seconds.

## Files

- `index.html` — game page (SEO meta, structured data, AdSense, CMP)
- `game.js` — full game loop, rendering, leaderboard fetch/insert, geo lookup
- `styles.css` — shared styles
- `about.html`, `how-to-play.html`, `updates.html`, `privacy.html`, `terms.html` — content pages
- `manifest.webmanifest`, `sw.js` — PWA assets
- `robots.txt`, `sitemap.xml`, `ads.txt` — crawler / monetization
- `supabase.sql`, `supabase/migrations/` — database schema
