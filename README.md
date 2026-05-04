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

## Files

- `index.html` — game page (SEO meta, structured data, AdSense, CMP)
- `game.js` — full game loop, rendering, leaderboard fetch/insert, geo lookup
- `styles.css` — shared styles
- `about.html`, `how-to-play.html`, `updates.html`, `privacy.html`, `terms.html` — content pages
- `manifest.webmanifest`, `sw.js` — PWA assets
- `robots.txt`, `sitemap.xml`, `ads.txt` — crawler / monetization
- `supabase.sql`, `supabase/migrations/` — database schema
