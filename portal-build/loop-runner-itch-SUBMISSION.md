# Loop Runner — Community Portal submission kit (itch.io · Newgrounds · GameJolt)

**Build path:** `portal-build/loop-runner-itch/` → zipped to `portal-build/loop-runner-itch.zip` (~1.8 MB).
**This notes file lives OUTSIDE the build folder so it never leaks into the uploaded ZIP.**

One build serves all three free community portals — they all host an HTML5 game in an
iframe and don't want your own ad code. Verified 2026-06-14 in headless Edge: loads
ad-free, zero console errors, zero ad-network requests, plays through to game-over, and
the in-modal "🎬 Save Clip" produces a valid WebM.

## What this build is
- **Current** `game.js` + `styles.css` (byte-identical copies of live `playloop.run`), so it
  includes the 2026-06-14 replay-clip capture and the leaderboard-modal fix. Re-copy these
  two files whenever the main game updates — there is **no game.js fork** to drift out of date.
- A **stripped, ad-free** `index.html` derived from the live one.

### Stripped vs live playloop.run/index.html
- All AdSense (`adsbygoogle` scripts, 3 ad slots, the inline pushes) + Funding Choices CMP
- The between-runs **interstitial** element (game.js `shouldShowInterstitial()` returns false
  when the element is absent — no forced ad-break friction on portals)
- Site nav, footer, the SEO hero/H1, features/FAQ text, JSON-LD structured data
- `canonical` / `og:` / `twitter:` / `keywords` meta, manifest, apple-touch-icon
- Plausible loader (replaced with a no-op stub so `plausible(...)` calls stay safe but portal
  plays don't pollute playloop.run analytics)
- The Privacy external link in the HUD and all `/page.html` nav links (no external links)
- Absolute asset paths → relative (`./game.js`, `./styles.css`, `./favicon.ico`)

### Kept
- Full gameplay: 6 enemy types × 8 themes, boss waves, roguelite upgrades, theme cycle,
  mobile drag/tap controls, pause button
- Supabase worldwide + country leaderboard (works from an iframe; single global pool shared
  with playloop.run and every other portal — same scores everywhere)
- Daily Run (shared daily seed) + daily hero panel + personal history chart + live ticker
- Replay clip capture — and the clip's baked-in **"playloop.run" watermark is the funnel-back**
  to the main site (since we stripped the on-page links to stay portal-compliant)

## Regenerate the ZIP (after re-copying game.js/styles.css)
```powershell
Copy-Item game.js,styles.css,favicon.ico,looprunner-preview.png portal-build/loop-runner-itch/ -Force
Compress-Archive -Path portal-build/loop-runner-itch/* -DestinationPath portal-build/loop-runner-itch.zip -Force
```
Verify: unpacks flat with `index.html` at top, well under 50 MB / 1,500 files.

---

## Listing copy (paste into all three)

**Title:** Loop Runner

**Tagline / short:** Dash, chain combos, and climb the leaderboard in a fast neon arcade shooter.

**Description (long):**
> Loop Runner is a fast-paced reflex arcade game. Steer with your mouse (or finger), fire to
> clear waves, and chain kills to build an escalating combo multiplier. Every three minutes the
> entire world redraws into a new theme — Jurassic, Cyberpunk, Deep Sea, Underworld, Mythical,
> Cosmic, Glitch, and Steampunk — and at score milestones a boss wave spawns.
>
> Draft roguelite upgrades as you climb (Ring Burst, Piercing Rounds, Time Warp, Powerup Magnet
> and more), chase the worldwide and country leaderboards, and take on the **Daily Run** — a
> shared seed where every player faces the exact same patterns, so the board rewards skill, not
> luck. Save a clip of your best run and share it. No downloads, no account — just play.

**Category / genre:** Action · Arcade · Shooter · Skill
**Tags:** arcade, action, shooter, reflex, leaderboard, daily, boss, combo, neon, vector, html5, casual
**Controls — desktop:** Move with the mouse · Right-click to fire (3 rounds, auto-recharge) · Space to restart · P / Esc to pause
**Controls — mobile:** Drag to move · Tap to fire
**Age rating:** Everyone (no gore/violence — abstract vector shapes)

---

## Per-portal upload steps

### itch.io  (https://itch.io/game/new)  — most permissive, fastest
1. **Kind of project:** HTML.  Upload `loop-runner-itch.zip`, tick **"This file will be played in the browser."**
2. **Embed options:** set a fixed viewport — **960 × 600** is a good default — and tick
   **"Mobile friendly"**, **"Automatically start on page load"** = off (we have a Play overlay),
   **"Enable scrollbars"** = off, **"Fullscreen button"** = on.
3. Cover image: use `looprunner-preview.png` (1200×630; itch crops to its own ratio).
4. Pricing: **No payment ($0)**. Visibility: **Public** (or Draft first to preview).
5. itch allows linking back to playloop.run in the description — fine to add "More at playloop.run".

### Newgrounds  (https://www.newgrounds.com/projects/games)  — biggest built-in arcade audience
1. New Project → **Browser Game** → upload the ZIP (HTML5). Main file: `index.html`.
2. Set dimensions **960 × 600**, scaling **"Fit to screen"**.
3. Add screenshots + the preview as the icon/thumbnail. Pick genre **Action**.
4. Newgrounds requires you to set a content rating — choose **Everyone**.
5. Newgrounds discourages 3rd-party ads (we have none) — compliant.

### GameJolt  (https://gamejolt.com/dashboard)  — devlog-friendly, good for updates
1. Add Game → **Browser** build → upload ZIP, builds run in an iframe; entry `index.html`.
2. Set the viewport (**960 × 600**), enable fullscreen.
3. Fill the page: description above, tags, thumbnail (`looprunner-preview.png`).
4. Maturity: **Everyone**. Publish.

## After upload — quick smoke test on each
- Game canvas fills the embed; **Play** works.
- Open **Leaderboard** → table loads (proves Supabase reaches from the portal's iframe origin).
- Play a short run → die → **🎬 Save Clip** appears and downloads/shares a WebM.
- (Safari/iOS visitors won't see Save Clip — webm-only v1; that's expected.)
