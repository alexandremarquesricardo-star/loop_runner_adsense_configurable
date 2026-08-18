# Loop Runner — state of play

**Parked 2026-08-18.** The game is in good shape. The blocker is distribution, and
nothing in this file changes that. Read the "Reality check" section before deciding
to build anything.

---

## Shipped 2026-08-18 (all live on playloop.run)

| commit | what |
|---|---|
| `885fd79` | opening tempo, int32 score overflow, capture tool, store art |
| `19298cd` | service worker cache → v15 |
| `9f63ada` | chain decay + combo rebalance, season 2 leaderboard |
| `8329a18` | local personal-best season reset |
| `8963768` | enemy tint ramp, contrast, Cyberpunk grunt redraw |
| `ecb70e0` | preview clips regenerated |
| `3a895ae` | sitemap lastmod corrected from git history |

### The two real bugs found
- **`state.score | 0`** (20 sites) is ToInt32 and wrapped at 2,147,483,647, turning
  high scores negative — including the leaderboard submission payload, and it also
  blocked all later upgrade thresholds and boss spawns in that run. Now `Math.floor`.
- **The combo never expired.** `state.combo = 0` appeared once, in `startGame`, so it
  was a lifetime kill counter. Multiplied by `Math.pow(1.4, combo - 1)` a single kill
  at combo 60 paid 4,183,638,057. Both the decay window and the "combo pill dims"
  affordance were documented in `strategy.html` but never implemented.

---

## Open — feel decisions, never played by hand

Everything below was verified headless only. Nobody has played this build with a
mouse. These are single constants:

- [ ] **`COMBO_WINDOW = 2.5`** ([game.js](game.js)) — seconds before a chain expires.
      Do chains break too easily?
- [ ] **`COMBO_BASE = 1.08`** ([game.js](game.js)) — modelled to land a full run near
      33,000. Does that feel right?
- [ ] **Interceptor drone sensor ring** (`drawEnemyCyberpunk`) — counter-rotates, only
      ever seen as a still frame. If it reads busy at speed, cut the ring first.
- [ ] Untested paths generally: real mouse/touch input, the death/game-over flow, and
      live leaderboard submission.

## Open — known issues, not addressed

- [ ] **Portal builds carry stale `game.js`** (4 copies in `portal-build/`). None have
      the score fix, rebalance, or new art. Re-copy `game.js`/`styles.css` before any
      resubmission — the recipe is in `loop-runner-itch-SUBMISSION.md`.
- [ ] **Supabase caps score at 100,000,000** (`supabase.sql` check constraint). Under
      the old 1.4 curve most good runs exceeded it and were **silently rejected on
      submit**. The new curve fits far under, so it is moot — but the insert path still
      fails silently, and `how-to-play.html` has an FAQ entry about missing scores that
      does not list this as a cause.
- [ ] **The ad stack earns nothing and costs conversion.** AdSense has never been
      approved for this domain. Every page loads ad + Funding Choices CMP scripts (6–8
      refs each, 56 in `game.js`); a new player gets a consent dialog before playing and
      a shortened canvas via `H = innerHeight - adH - navH`. Removal was offered and
      declined — do not re-raise unless asked.
- [ ] Season 1 scores remain in Supabase, filtered off the board by
      `SEASON_START = '2026-08-18T00:00:00Z'`. Nothing was deleted.

## Operational risk while parked

- [ ] **The leaderboard can die silently.** Supabase free tier pauses on inactivity;
      `supabase-keepalive.yml` prevents that, but GitHub disables scheduled workflows
      in repos inactive ~60 days. Chain: repo quiet → cron disabled → keepalive stops →
      Supabase pauses → leaderboard down. If returning after a long gap, check the two
      scheduled workflows and the Supabase project state first.

---

## Reality check

- **~1 visitor/day.** 37 Daily Run submissions across 37 days, several of them the
  owner's own.
- **Portals are closed.** CrazyGames rejected 2026-05-08; the others failed too.
- **AdSense is blocked, and it is downstream.** Both `playloop.run` and
  `psysymbol.com` sit at "Low value content". Content volume is not the issue —
  ~13,500 words across seven pages. The ordering is **visitors → engagement →
  approval → ads**.
- **SEO cannot escape this loop.** The guides only rank for "Loop Runner <something>",
  which nobody searches until the game is known.
- **The share mechanic is already built and good.** `renderShareText` emits an emoji
  ladder plus a seeded challenge URL, and the `og.playloop.run` Worker renders
  personalised unfurl cards. It multiplies an audience; it cannot create one.

**The only lever not downstream of an audience is putting the game in front of people
directly:** short-form video (no gatekeeper, highest ceiling — `portal-build/store-assets/crazygames-video-portrait.mp4`
is 10s at 720×1280), Reddit (r/WebGames, r/playmygame — roughly one shot per
community), and daily-game directories, which are far more permissive than game portals.

Nothing has ever been posted to any of them. That is the experiment that has not been run.

---

## Tooling built today

`tools/capture.mjs` renders store art straight from the live game — zero npm deps,
built-in static server plus Chrome over CDP, ffmpeg for clips.

```sh
node tools/capture.mjs                          # six cover JPEGs
node tools/capture.mjs --theme cosmic           # any THEMES key
node tools/capture.mjs --video --seconds 10     # + landscape/portrait MP4
node tools/capture.mjs --skip-stills --clip portrait
```

Clips render offline (world paused, advanced exactly 1/30s per frame) because headless
software-GL only sustains ~2fps live. Driven by `window.__lrCapture`, which exists only
with `?capture=1` **and** a localhost host — it can set an arbitrary score and the
leaderboard has no server-side validation.
