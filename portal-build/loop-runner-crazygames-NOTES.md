# CrazyGames — Loop Runner submission notes (v2)

**This file lives OUTSIDE the build folder on purpose.** v1 leaked it into the
submitted ZIP because `Compress-Archive -Path .../loop-runner-crazygames/*` globbed
it in. The .md mentioned AdSense and competitor portals — both policy violations.
Keeping it as a sibling means future ZIPs cannot accidentally include it.

## v2 fixes vs v1 (v1 was rejected 2026-05-08, generic template email)

### Bundling
- `SUBMISSION.md` is no longer inside the build folder (this very file, moved out)
- ZIP recipe (below) explicitly excludes `*.md` as belt-and-suspenders

### Robustness on QA networks
- `fetchWithTimeout()` helper added in `game.js` — 3s for ipapi/ipinfo, 5s for
  Supabase leaderboard + rank queries. Without timeouts, a silently-blocked host
  on a reviewer's network would hang the leaderboard's "Loading…" state forever
  and the build would *appear* broken. Now it falls through to the local-LB
  cache after 5s, exactly as it does for explicit network failures.

### Visual quality
- Massive content upgrade since v1: 8 rotating themes (Jurassic, Cyberpunk,
  Deep Sea, Underworld, Mythical, Cosmic, Glitch, Steampunk), each with custom
  vector creatures for all 6 enemy types. Theme cycles every 3 minutes (24-min
  full revolution), with a "YOU'VE CIRCLED ALL THEMES" reward banner.
- Custom vector player ship (with bank-tilt + thrust trail), comet-streak
  bullets, geometric shard death bursts, drifting nebula clouds.

### UX
- Removed the upgrade-pick modal. Upgrades now auto-apply at score thresholds
  with a banner + flash + shake (no cursor-stealing dialogue, which previously
  forced the player into a position they didn't want).
- Post-death canvas freeze: 1.5s after dying, the render loop returns without
  drawing — GPU goes idle under the leaderboard modal instead of redrawing
  60fps.

## What was stripped from the live `playloop.run/index.html` for this build
- Google AdSense scripts + Funding Choices CMP (portal serves its own ads)
- All `<ins class="adsbygoogle">` slots and the JS that pushes them
- Top banner wrapper, ad-spacer, site nav, footer with external page links
- Ad-aware `resize()` logic (canvas now uses full viewport)
- `og:url` / canonical / preload-pointing-to-/-relative paths replaced with `./`
- `manifest.webmanifest` link removed
- About / How-to-Play / Updates / Privacy / Terms pages not included

## What was kept
- Full gameplay (audio, all enemies, upgrades, mobile controls, ammo HUD)
- Supabase leaderboard (`azaqjxovkewurgbecizs.supabase.co`) — works from iframe
- Geo lookup (graceful fallback to "XX" if portal blocks ipapi.co/ipinfo.io)

## Local smoke-test

```
npx serve portal-build/loop-runner-crazygames
```

Whole canvas should fill the viewport. No top nav, no ads, no scrollbar.
Open the leaderboard with the network throttled to "Offline" in DevTools — it
should fall through to the local cache within 5 seconds (was: hang forever).

## Producing the ZIP

PowerShell, from repo root. The `-Exclude *.md` is defensive — there should be
no .md files in the build folder anyway, but this guarantees it.

```powershell
Get-ChildItem -Path portal-build/loop-runner-crazygames -Exclude *.md `
  | Compress-Archive -DestinationPath portal-build/loop-runner-crazygames.zip -Force
```

Verify before upload:
- ZIP unpacks to a flat structure with `index.html` at the top
- No `*.md` files in the listing
- Total size well under 50 MB
- Total file count well under 1,500

## Asset checklist (manual — what you upload to the dev portal alongside the ZIP)

CrazyGames cover/trailer specs are strict and were a likely factor in the v1
rejection. Re-audit each one against the latest spec at
https://docs.crazygames.com/requirements/game-covers/ before resubmitting.

| Asset | Spec | Status |
|---|---|---|
| Landscape cover | 1920x1080 PNG/JPG, no borders, no store logos, only the game's title text | confirm before upload |
| Portrait cover | 800x1200 PNG/JPG, same rules | confirm before upload |
| Square cover | 800x800 PNG/JPG, same rules | confirm before upload |
| Trailer | 15-20s, <=50 MB, 1080p 16:9, no opening logos / black screens / "Play Now" text / default cursors | confirm before upload |

The 1200x630 `looprunner-preview.png` is for SOCIAL share cards, NOT for
CrazyGames covers. Recrop/resize from source before uploading.

## Form fields on the dev portal

| Field | Suggested for Loop Runner |
|---|---|
| Title | Loop Runner |
| Tagline | Dash, chain, climb the leaderboard |
| Description | (paste a 2-3 paragraph version of about.html, mention the 8 rotating themes) |
| Category | Action / Arcade / Skill |
| Tags | reflex, action, arcade, dodge, leaderboard, daily challenge, skill, vector, themes |
| Controls (desktop) | Mouse to move - Right-click to fire - Space to restart - P/Esc to pause |
| Controls (mobile) | Drag to move - Tap to fire |
| Age rating | PEGI 7 (no violence/gore) - confirm in their form |

## Reply to v1 rejection?

Worth doing. Email them politely asking which specific reason applied (their
template lists four - gameplay quality, broken builds, copyright, integration).
Sometimes they elaborate with actionable feedback. You'd send this from the
account that submitted v1.

## After Basic Launch approval — SDK integration prep

```html
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
```

Then call `window.CrazyGames.SDK.init()`, `requestAd("midgame")` between runs,
`gameplayStart()` / `gameplayStop()` around play, optionally `requestAd("rewarded")`
for "watch ad -> continue". Reference:
https://docs.crazygames.com/sdk/html5-v2/intro/

This is a follow-up task — don't add the SDK until they've approved Basic Launch.
