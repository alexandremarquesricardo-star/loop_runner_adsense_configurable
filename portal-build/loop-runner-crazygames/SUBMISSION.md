# CrazyGames — Loop Runner submission

This folder is a stripped, iframe-friendly build of Loop Runner for CrazyGames Basic Launch.

## What was stripped vs. live playloop.run

- Google AdSense scripts + Funding Choices CMP (portal handles ads)
- All `<ins class="adsbygoogle">` slots and the JS that pushes them
- Top banner wrapper, ad-spacer, site nav, footer with external page links
- Ad-aware `resize()` logic (canvas now uses full viewport)
- `og:url` / canonical / preload-pointing-to-/-relative paths replaced with `./`
- `manifest.webmanifest` link removed
- About / How-to-Play / Updates / Privacy / Terms pages not included (portal hosts the chrome)

## What was kept

- Full gameplay (audio, enemies, upgrades, mobile controls, ammo HUD, banners, roasts)
- Supabase leaderboard (`azaqjxovkewurgbecizs.supabase.co`) — works from iframe
- Geo lookup (graceful fallback to "XX" if portal blocks ipapi.co/ipinfo.io)

## Local smoke-test

From the repo root:

```
npx serve portal-build/crazygames
```

Open the printed URL. The whole canvas should fill the viewport with no top nav, no ads, no scrollbar. Everything else (controls, leaderboard modal, upgrades, sounds) should behave exactly like the live site.

## Producing the ZIP

CrazyGames wants a ZIP whose root contains `index.html`. From the repo root in PowerShell:

```powershell
Compress-Archive -Path portal-build/crazygames/* -DestinationPath portal-build/loop-runner-crazygames.zip -Force
```

Verify before upload:
- ZIP unpacks to a flat structure with `index.html` at the top
- Total size well under 50 MB (currently ~2 MB incl. preview)
- Total file count well under 1,500

## What you still need to provide on the dev portal

CrazyGames developer portal: https://developer.crazygames.com/

Upload form fields you'll fill in manually:

| Field | Suggested for Loop Runner |
|---|---|
| Title | Loop Runner |
| Tagline | Dash, chain, climb the leaderboard |
| Description | (paste a 2–3 paragraph version of about.html) |
| Category | Action / Arcade / Skill |
| Tags | reflex, action, arcade, dodge, leaderboard, daily challenge, skill |
| Controls (desktop) | Mouse to move • Right-click to fire • Space to restart • P/Esc to pause |
| Controls (mobile) | Drag to move • Tap to fire |
| Age rating | PEGI 7 (no violence/gore) — confirm in their form |

## Cover image + video assets needed

CrazyGames spec evolves; check current dimensions at https://docs.crazygames.com/requirements/intro/. As of submission you'll typically need:

- A cover image — square PNG/JPG (commonly 800×800 or 512×512), title visible at thumbnail size
- A 1920×1080 hero/screenshot
- A short trailer (15–30s, MP4, no portal logos)

You can derive a starting cover from `looprunner-preview.png` in this folder (1200×630) — but recrop/resize to the exact dims their form asks for.

## Submission flow (Basic Launch)

1. Sign up / log in at https://developer.crazygames.com/
2. Click "Submit a game"
3. Upload the ZIP, fill in metadata, attach cover + screenshots + trailer
4. Submit for review
5. Basic Launch test runs ~2 weeks — they'll email approval/feedback
6. If they approve Full Launch, integrate the CrazyGames HTML5 v2 SDK
   (https://docs.crazygames.com/sdk/html5-v2/intro/) for rewarded ads, midroll, save data

## After Basic Launch — SDK integration prep

When approved for Full Launch you'll need to add:

```html
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
```

…and call:

- `window.CrazyGames.SDK.init()` on load
- `window.CrazyGames.SDK.ad.requestAd("midgame")` between runs (replaces the interstitial we drafted)
- `window.CrazyGames.SDK.ad.requestAd("rewarded")` for "watch ad → continue" if added later
- `window.CrazyGames.SDK.game.gameplayStart()` / `gameplayStop()` so they know when ads are safe to show
- `window.CrazyGames.SDK.data` for cloud save (replaces localStorage if desired)

This is a separate task — don't attempt before Basic Launch approval, since CrazyGames wants a vanilla build to evaluate first.

## Other portals (next up after CrazyGames)

- **GameDistribution** — https://gamedistribution.com/developers/ — also accepts a similar stripped iframe build, different SDK if you want their ad provider
- **Y8** — https://www.y8.com/upload — can use your own AdSense via "AdSense for Platforms" (AFP), an interesting hybrid path
- **Poki** — https://developers.poki.com/ — strictest, requires their SDK upfront, save for last
