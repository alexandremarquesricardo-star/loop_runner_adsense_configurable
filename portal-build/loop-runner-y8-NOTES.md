# Y8 — Loop Runner submission notes

**Build path:** `portal-build/loop-runner-y8/`. **This file lives outside the
build folder** so it can never accidentally leak into a submitted ZIP.

## Y8's monetization angle (why this build differs from CrazyGames)

Y8 explicitly allows publishers to use their own AdSense via
**AdSense for Platforms (AFP)**. This means:
- AdSense scripts STAY in this build (unlike CrazyGames where they were
  stripped out)
- Funding Choices CMP STAYS in this build
- All three ad slots STAY (top banner, leaderboard modal, interstitial)
- Revenue: full pub-id payout (typically a higher share than the standard
  portal split)

## What was stripped vs the live `playloop.run/index.html`
- Site nav (`<nav id="site-nav">`) — Y8 wraps the page chrome
- Footer with external links to about/privacy/terms
- The H1/SEO hero section (`<section class="container"><div class="hero">`)
- `<link rel="canonical">` and `og:url` pointing at `playloop.run`
- `<link rel="manifest">` and `<link rel="apple-touch-icon">` (asset paths point at /
  which won't resolve from an iframe context)
- All `og:` and `twitter:` meta tags (portal sets its own preview)
- Structured Data JSON-LD (was for SEO on playloop.run — not useful in iframe)
- The site-nav height-measurement script (no nav to measure)

## What was kept
- Full gameplay (audio, all 6 enemy types × 8 themes, upgrades, mobile
  controls, ammo HUD, pause button)
- Supabase leaderboard at `azaqjxovkewurgbecizs.supabase.co` — works from
  iframe with the existing SB_HEADERS
- Geo lookup (graceful fallback to "XX" if portal blocks ipapi/ipinfo)
- Timeout-hardened fetch helper (5s on Supabase, 3s on geo)
- Boss waves, theme cycle (every 3 min), personal history chart, live ticker

## Pre-flight checklist (Y8 + AFP)

**You must do this before submitting** — most of these are dashboard-only:

1. Sign in to AdSense console at https://www.google.com/adsense/
2. Find "Sites" → enable **AdSense for Platforms** for the
   `loop-runner` (or whatever Y8 hosts this at) URL/domain. Wait for
   approval (typically 1–3 business days).
3. Once approved, AFP will start serving ads on Y8 with your pub-id.
4. (Optional but recommended) Create dedicated slots in AdSense for the
   three placements:
   - `LOOPRUNNER_Y8_TOP_BANNER`
   - `LOOPRUNNER_Y8_LEADERBOARD_MODAL`
   - `LOOPRUNNER_Y8_INTERSTITIAL`
   And swap the three `data-ad-slot="7067398117"` values in
   `portal-build/loop-runner-y8/index.html`. This gives per-placement
   revenue reporting.

## Local smoke-test

```
npx serve portal-build/loop-runner-y8
```

Open the printed URL. The canvas should fill the viewport. The top ad
banner should be visible (or collapsed if no fill, that's fine on
localhost — it'll fill on Y8). Leaderboard modal should open without
errors. Open DevTools console and confirm no AdSense `403 Forbidden` on
production (some are expected on localhost — that's normal).

## Producing the ZIP

```powershell
Get-ChildItem -Path portal-build/loop-runner-y8 -Exclude *.md `
  | Compress-Archive -DestinationPath portal-build/loop-runner-y8.zip -Force
```

Verify before upload:
- ZIP unpacks to a flat structure with `index.html` at the top
- No `*.md` files in the listing (defensive: there shouldn't be any in
  the build folder anyway)
- Total size well under 50 MB
- Total file count well under 1,500

## Submission flow

1. Go to https://www.y8.com/upload
2. Sign in / create a developer account if needed
3. Upload the ZIP, fill in metadata
4. Y8 will host the iframe — your AdSense will serve via AFP

## Form fields (suggested)

| Field | Suggested |
|---|---|
| Title | Loop Runner |
| Tagline | Dash, chain, climb the leaderboard |
| Description | (paste a 2-3 paragraph version of about.html, mention 8 themes, Daily Runs, boss waves) |
| Category | Action / Arcade / Skill |
| Tags | reflex, action, arcade, dodge, leaderboard, daily, boss, vector, themes |
| Controls (desktop) | Mouse to move - Right-click to fire - Space to restart - P/Esc to pause |
| Controls (mobile) | Drag to move - Tap to fire |
| Age rating | All ages (no violence/gore) |
