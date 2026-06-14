# Y8 — Loop Runner submission notes

> **🔄 REFRESHED 2026-06-14 — and the AdSense decision was REVERSED.** This build is now
> **ad-free** (identical to the itch/CrazyGames build), not AdSense-bearing as the older
> notes below describe. Reason: serving our own AdSense pub code on `y8.com` (a domain not
> in our AdSense account) risks the account — reckless while it's still in review. Y8 serves
> its own ads via revshare regardless. Build uses byte-identical current `game.js`/`styles.css`
> (no fork) so it carries clip capture + the modal fix. Listing copy + recipe:
> [`loop-runner-itch-SUBMISSION.md`](loop-runner-itch-SUBMISSION.md). **The AdSense sections
> below are obsolete — ignore them.**

**Build path:** `portal-build/loop-runner-y8/`. **This file lives outside the
build folder** so it can never accidentally leak into a submitted ZIP.

## Y8's monetization angle (why this build differs from CrazyGames)

CrazyGames mandates stripping AdSense (their SDK serves ads). Y8 has been
historically more lenient about devs keeping their own AdSense scripts
inside the iframe — though this depends on Y8's current developer
agreement, which can change. So this build keeps AdSense in the bundle:
- AdSense scripts STAY (will fire if Y8 doesn't block them)
- Funding Choices CMP STAYS
- All three ad slots STAY (top banner, leaderboard modal, interstitial)

If Y8 blocks the AdSense scripts (likely — they typically want their own
ad network to render), the bundle gracefully falls back to no-ad rendering
and you collect Y8's revshare instead. If Y8 allows them, you collect full
pub-id payout. Either way, keeping the scripts in costs nothing.

NOTE: I previously called this "AdSense for Platforms (AFP)" — that was
incorrect. AFP is a distinct Google partner program for platforms (like
Y8 itself), NOT for individual game devs hosted on a platform. There is
no "enable AFP" toggle in your AdSense console.

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

## Pre-flight checklist (Y8 submission)

There is no "enable AFP" toggle. The actual flow:

1. Create a developer account at https://www.y8.com/upload
2. Upload the ZIP (recipe below)
3. Read whatever monetization section appears in Y8's developer
   dashboard / developer agreement at upload time. That tells you
   which of these is true for your account:
   - Y8 strips your AdSense and serves their own ads (most common) →
     you accept their revshare. Bundle's AdSense becomes a no-op,
     no harm.
   - Y8 allows your AdSense to fire (less common) → your existing
     pub-id collects normally.
   - Y8 offers a separate monetization program (network/MCN) you opt
     into during upload.
4. (Optional) Create dedicated slots in AdSense for the three
   placements (`TOP_BANNER`, `LEADERBOARD_MODAL`, `INTERSTITIAL`) and
   swap the three `data-ad-slot="7067398117"` values in
   `portal-build/loop-runner-y8/index.html`. This gives per-placement
   revenue reporting if your AdSense does end up firing on Y8.

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
