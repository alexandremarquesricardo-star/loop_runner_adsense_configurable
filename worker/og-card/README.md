# playloop-og-card

Cloudflare Worker that renders 1200×630 PNG OG cards for Loop Runner challenge URLs.

When deployed at `og.playloop.run/card?c=<seed>&from=<name>&score=<n>`, the main site can reference these URLs in `og:image` meta tags so shared challenge links produce personalised previews in iMessage, Discord, X, WhatsApp, and Slack.

This is the **distribution multiplier**: every shared score gets its own visual preview, which is what turns a copy-pasted link into a click magnet.

## What it does

- Takes URL params (`c`, `from`, `score`/`beat`, `country`, `theme`, `date`, optional `rival`).
- Builds an SVG with brand wordmark, theme-tinted backdrop, huge tier-coloured score, country flag, 5-tier ladder, optional challenge ribbon.
- Rasterises via `@resvg/resvg-wasm` to PNG.
- Returns `image/png` with `Cache-Control: public, max-age=31536000, immutable` — cards are deterministic per URL.

## First-time deploy

```bash
cd worker/og-card
npm install                     # installs resvg-wasm + wrangler
npx wrangler login              # one-time Cloudflare auth
# Optional first sanity run on workers.dev — uncomment after route is wired:
# npx wrangler dev
npx wrangler deploy             # deploys to playloop-og-card.<account>.workers.dev
```

> **Before the cards render text**, you must bundle Inter (or any TTF) into `src/fonts/`. Cloudflare Workers has no system fonts, so `<text>` nodes render empty until two files exist:
>
> ```bash
> mkdir -p src/fonts
> # Grab Inter from https://github.com/rsms/inter/releases (Inter-4.x.zip)
> # Copy these two from the unzipped "Inter Desktop" folder:
> #   Inter-Regular.ttf  → src/fonts/Inter-Regular.ttf
> #   Inter-Bold.ttf     → src/fonts/Inter-Bold.ttf
> ```
>
> Then uncomment the two `import interBold/interRegular` lines at the top of `src/index.mjs` and redeploy. The worker will deploy without fonts (good for initial smoke-test that the route + WASM init works), but cards will be text-less until you add them.

Hit it once to confirm:
```
curl -I "https://playloop-og-card.<account>.workers.dev/card?c=12345&from=Ricardo&score=12400&country=PT&theme=cyberpunk"
# Expect: 200 OK, Content-Type: image/png
```

## Wire to playloop.run

Once the worker is healthy on `workers.dev`:

1. **DNS**: In Cloudflare DNS for `playloop.run`, add a CNAME `og` pointing to `playloop-og-card.<account>.workers.dev` (proxied / orange cloud on).
2. **Route**: In `wrangler.toml`, uncomment and set `route = "og.playloop.run/*"`. Redeploy.
3. **Main-site integration**: In `index.html`, conditionally swap the `og:image` meta tag when the URL has a `?c=` param. Two options:
   - Client-side JS rewrites `<meta property="og:image">` early in `<head>` so any Web Share API call picks up the new URL. (Note: this does NOT help crawlers, only manual scrapers — most messengers fetch HTML server-side.)
   - **Better** — host a slim wrapper route via the Worker itself: extend this worker so `https://og.playloop.run/c/<seed>/<from>/<beat>` returns HTML with `og:image` pointing to `https://og.playloop.run/card?...` and a `<meta http-equiv="refresh">` to `https://playloop.run/?c=...`. Share links then use `og.playloop.run/c/...` URLs and previews work everywhere.

## Cost

Cloudflare Workers free tier: 100,000 requests/day, 10ms CPU per request. PNG render is well under 10ms once the WASM is warm. Even at 1M shares/day this is comfortably free.

## Notes

- Font: text renders only when TTFs are bundled into `src/fonts/`. See the "First-time deploy" section above. The Resvg constructor automatically picks up whatever fonts are imported at the top of `src/index.mjs` via the `Data` rule in `wrangler.toml`.
- The error path returns a minimal branded SVG so OG previews never break entirely.
- If you ever need to bust caches, bump `CACHE_VERSION` in `src/index.mjs`.
