# GameDistribution — Loop Runner submission

> **🔄 REFRESHED 2026-06-14.** Regenerated from current `playloop.run` (clip capture + modal
> fix included). **This notes file was moved OUT of the build folder** (it had been leaking
> into the ZIP). The GD HTML5 SDK is now wired in `index.html` (`GD_OPTIONS` + loader), and
> the pause/resume + between-runs `gdsdk.showAd()` hooks live in the **shared** `game.js`
> behind `typeof gdsdk` guards — so they're inert on `playloop.run` and active only here
> (no game.js fork). Build uses byte-identical current `game.js`/`styles.css`. Shared recipe
> + listing copy: [`loop-runner-itch-SUBMISSION.md`](loop-runner-itch-SUBMISSION.md).

This folder is a stripped, iframe-friendly build of Loop Runner for GameDistribution. The
build is portal-agnostic apart from the GD SDK block in `index.html`; submission metadata is below.

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
- Supabase leaderboard (`azaqjxovkewurgbecizs.supabase.co`) — works from iframe, worldwide pool
- Geo lookup (graceful fallback to "XX" if portal blocks ipapi.co/ipinfo.io)

## Local smoke-test

From the repo root:

```
npx serve portal-build/loop-runner-gamedistribution
```

Open the printed URL. The canvas should fill the viewport with no top nav, no ads, no scrollbar. Everything else (controls, leaderboard modal, upgrades, sounds) should behave exactly like the live site.

## Producing the ZIP

GameDistribution wants a ZIP whose root contains `index.html`. From the repo root in PowerShell:

```powershell
Compress-Archive -Path portal-build/loop-runner-gamedistribution/* -DestinationPath portal-build/loop-runner-gamedistribution.zip -Force
```

Verify before upload:
- ZIP unpacks to a flat structure with `index.html` at the top
- Total size well under 50 MB (currently ~2 MB incl. preview)
- Total file count well under 1,500

## What you still need to provide on the dev portal

GameDistribution developer portal: https://gamedistribution.com/developers/

Upload form fields you'll fill in manually (mirror what was used for CrazyGames — different platforms accept very similar metadata):

| Field | Suggested for Loop Runner |
|---|---|
| Title | Loop Runner |
| Tagline | Dash, chain, climb the leaderboard |
| Description | Reflex-first arcade dodger — pilot a glowing dot through tightening rings of enemies, dash through gaps, chain near-misses to climb a global leaderboard. One mistake ends the run. Daily Run uses a shared seed for fair skill comparison. Built for instant play; loads in under two seconds; works on desktop and mobile. |
| Category | Action / Arcade / Skill |
| Tags | reflex, action, arcade, dodge, leaderboard, daily challenge, skill |
| Controls (desktop) | Mouse to move • Right-click to fire • Space to restart • P/Esc to pause |
| Controls (mobile) | Drag to move • Tap to fire |
| Languages | English |
| Mobile-friendly | Yes |
| Multiplayer | No |
| In-game purchases | No |

## Cover image + video assets

GameDistribution dimensions can shift; check current spec on their developer portal before generating new assets. The covers you produced for CrazyGames (1920×1080 / 800×1200 / 800×800) cover most portal requirements, so reuse them as a starting point and recrop only if their form rejects them.

A short trailer (15–30s, MP4, no portal logos) is recommended — the same asset works across portals.

## Submission flow

1. Sign up / log in at https://gamedistribution.com/developers/
2. Upload the ZIP, fill in metadata, attach cover + screenshots + trailer
3. Submit for review
4. After approval, integrate the GameDistribution HTML5 SDK for ad revenue (see next section)

## After approval — SDK integration prep

GameDistribution provides an HTML5 SDK that handles preroll / midroll / rewarded ads with their fill network. Find the HTML5 SDK docs from their developer portal.

Plan when you're ready to integrate (do NOT pre-integrate before initial approval — they want to evaluate the vanilla build first):

1. Add their SDK script tag to `<head>` of `index.html`
2. Initialize on load with the `gameId` they assign you after approval
3. Wire ad calls into the `submitScore()` flow (after game over, before showing the leaderboard) — same insertion point as the CrazyGames SDK midgame ad
4. Keep the Supabase leaderboard call alongside the ad call — they're independent

Their SDK is functionally similar to CrazyGames' v3 SDK (gameplayStart/Stop hooks, ad request methods) but the function names and init shape differ. Check their docs for exact API.

## Other portal variants

- **CrazyGames** — `portal-build/loop-runner-crazygames/` — submitted 2026-05-07, in review
- **Y8** — not yet built — can use own AdSense via "AdSense for Platforms" (AFP), an interesting hybrid path; upload at https://www.y8.com/upload
- **Poki** — not yet built — strictest, requires their SDK upfront, save for last
