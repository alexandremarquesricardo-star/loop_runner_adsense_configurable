#!/usr/bin/env node
/**
 * Build a static archive page for yesterday's Daily Run.
 *
 * For every day, this script:
 *   1. Queries Supabase REST for all daily-mode scores submitted between
 *      yesterday 00:00 UTC and today 00:00 UTC (the window in which the
 *      previous day's seed was active).
 *   2. Writes daily/YYYY-MM-DD/index.html with the top 10 + a long-form
 *      narrative recap (substantive content → AdSense-friendly, indexable).
 *   3. Ensures sitemap.xml has a <url> entry for the new page.
 *   4. Optionally posts an X/Twitter announcement of yesterday's winner if
 *      TWITTER_CONSUMER_*, TWITTER_ACCESS_* secrets are all present in env.
 *
 * Idempotent: re-running on the same day overwrites the page and dedupes
 * sitemap entries. Safe to run via GitHub Actions schedule or manually.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');

const SB_BASE = 'https://azaqjxovkewurgbecizs.supabase.co/rest/v1/scores';
const SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6YXFqeG92a2V3dXJnYmVjaXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjIxNDMsImV4cCI6MjA5MzczODE0M30.ug99lkj1HoahFtjKSwz2GOBoPFStxf8JEh5FGE7UYr4';
const SITE = 'https://playloop.run';

// --- date helpers (UTC) ---
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
function yesterdayUTC() {
  const now = new Date();
  const y = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
  return y;
}
function startOfDayUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
}
function endOfDayUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0));
}

// --- escaping ---
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function countryFlag(cc) {
  if (!cc || cc.length !== 2 || cc === 'XX') return '🌐';
  const A = 0x1F1E6;
  const a = cc.toUpperCase().charCodeAt(0) - 65;
  const b = cc.toUpperCase().charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return '🌐';
  return String.fromCodePoint(A + a) + String.fromCodePoint(A + b);
}

// --- Supabase fetch ---
async function fetchScoresForDay(date) {
  const start = startOfDayUTC(date).toISOString();
  const end   = endOfDayUTC(date).toISOString();
  const params = new URLSearchParams();
  params.append('select', 'name,score,country,created_at');
  params.append('mode', 'eq.daily');
  params.append('created_at', 'gte.' + start);
  params.append('created_at', 'lt.' + end);
  params.append('order', 'score.desc');
  params.append('limit', '500');
  const url = SB_BASE + '?' + params.toString();
  const res = await fetch(url, {
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
  });
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}

// --- narrative + analytics from raw rows ---
function analyse(rows) {
  const n = rows.length;
  if (n === 0) {
    return {
      n: 0,
      best: null,
      median: 0,
      mean: 0,
      countries: [],
      topCountry: null,
      tiers: { t5k: 0, t10k: 0, t25k: 0, t50k: 0, t100k: 0 },
    };
  }
  const scores = rows.map(r => Number(r.score) || 0).sort((a, b) => a - b);
  const sum = scores.reduce((a, b) => a + b, 0);
  const mean = Math.round(sum / n);
  const median = scores[Math.floor(scores.length / 2)];
  const tiers = {
    t5k: scores.filter(s => s >= 5000).length,
    t10k: scores.filter(s => s >= 10000).length,
    t25k: scores.filter(s => s >= 25000).length,
    t50k: scores.filter(s => s >= 50000).length,
    t100k: scores.filter(s => s >= 100000).length,
  };
  const counts = new Map();
  for (const r of rows) {
    const cc = (r.country || 'XX').toUpperCase();
    counts.set(cc, (counts.get(cc) || 0) + 1);
  }
  const countries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const topCountry = countries[0] ? countries[0][0] : null;
  return {
    n, best: rows[0], median, mean, countries, topCountry, tiers,
  };
}

function pct(x, total) {
  if (!total) return '0';
  return Math.round((x / total) * 100) + '%';
}

// --- HTML template ---
function renderHtml(dateStr, rows) {
  const a = analyse(rows);
  const top10 = rows.slice(0, 10);
  const winner = a.best ? esc(a.best.name || 'Anon') : null;
  const winnerScore = a.best ? Number(a.best.score).toLocaleString() : null;
  const winnerCC = a.best ? (a.best.country || 'XX') : 'XX';
  const winnerFlag = countryFlag(winnerCC);

  const title = winner
    ? `Daily Run ${dateStr} — ${winnerFlag} ${winner} took the top with ${winnerScore} | Loop Runner`
    : `Daily Run ${dateStr} — Top scores | Loop Runner`;
  const description = winner
    ? `${winner} from ${winnerCC} won the ${dateStr} Loop Runner Daily Run with ${winnerScore} points across ${a.n} entries.`
    : `${dateStr} Daily Run leaderboard for Loop Runner. Same seed for every player worldwide.`;
  const canonical = `${SITE}/daily/${dateStr}/`;

  // Top-10 table rows
  const rowsHtml = top10.map((r, i) => {
    const rank = i + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
    return `<tr>
      <td class="rank">${medal} ${rank}</td>
      <td class="player">${countryFlag(r.country)} ${esc(r.name || 'Anon')}</td>
      <td class="score">${Number(r.score || 0).toLocaleString()}</td>
    </tr>`;
  }).join('\n');

  // Tier-bar (visible ladder representation)
  const tiersHtml = `
    <div class="tier-grid">
      <div><div class="tier-bar"><span style="width:${pct(a.tiers.t5k,  a.n)}"></span></div><div class="tier-meta">${pct(a.tiers.t5k,  a.n)} broke 5,000</div></div>
      <div><div class="tier-bar"><span style="width:${pct(a.tiers.t10k, a.n)}"></span></div><div class="tier-meta">${pct(a.tiers.t10k, a.n)} broke 10,000</div></div>
      <div><div class="tier-bar"><span style="width:${pct(a.tiers.t25k, a.n)}"></span></div><div class="tier-meta">${pct(a.tiers.t25k, a.n)} broke 25,000</div></div>
      <div><div class="tier-bar"><span style="width:${pct(a.tiers.t50k, a.n)}"></span></div><div class="tier-meta">${pct(a.tiers.t50k, a.n)} broke 50,000</div></div>
      <div><div class="tier-bar"><span style="width:${pct(a.tiers.t100k,a.n)}"></span></div><div class="tier-meta">${pct(a.tiers.t100k,a.n)} broke 100,000</div></div>
    </div>`;

  // Auto-narrative — substantive prose so AdSense sees real content per archive page
  const countriesNarr = a.countries.length > 0
    ? `Players logged in from ${a.countries.length} different countries. ${a.topCountry ? `Leading the volume was ${countryFlag(a.topCountry)} ${a.topCountry} with ${a.countries[0][1]} attempts.` : ''}`
    : 'No country data was attached to any submission this day.';
  const narrative = a.n === 0
    ? `<p>No scores were submitted for the ${dateStr} seed. That makes today an open lane — be the first to log a number on the ${dateStr} seed by replaying it from <a href="${SITE}/">Loop Runner's home page</a>.</p>`
    : `<p>The Loop Runner Daily Run on <strong>${dateStr}</strong> drew <strong>${a.n}</strong> recorded attempts worldwide. ${winner ? `<strong>${winner}</strong> took the day with <strong>${winnerScore}</strong> points, planting ${winnerFlag} ${winnerCC} at the top.` : ''} The median submitted score landed at <strong>${a.median.toLocaleString()}</strong>, with a mean of <strong>${a.mean.toLocaleString()}</strong>.</p>
       <p>${countriesNarr}</p>
       <p>Daily Run uses a single deterministic seed: every player gets exactly the same enemy spawns, the same powerup arrivals, and the same theme cadence. The variance you see in the leaderboard is purely a function of skill, build choices on the roguelite upgrade picks, and willingness to fight bosses head-on rather than kite around them. Read about the build archetypes in our <a href="${SITE}/power-ups.html">Power-ups guide</a> or skim the <a href="${SITE}/strategy.html">Strategy notes</a> for combo-chaining patterns that move the needle on days like this.</p>
       <p>Want to climb? Loop Runner is free and plays in your browser instantly — no signup, no install. The <a href="${SITE}/">live game</a> always shows today's Daily seed at the top of the home overlay. If you're new, the <a href="${SITE}/how-to-play.html">How to Play guide</a> covers controls, the round-and-recharge fire economy, the eight rotating themes, and the boss-wave thresholds at 5K / 15K / 30K. The <a href="${SITE}/themes.html">Themes field guide</a> catalogues every enemy you'll meet.</p>`;

  // JSON-LD for the archive page (structured data helps Google Discover surface old days)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    'name': title,
    'description': description,
    'url': canonical,
    'datePublished': dateStr,
    'isPartOf': { '@type': 'WebSite', 'name': 'Loop Runner', 'url': SITE + '/' },
    'about': { '@type': 'VideoGame', 'name': 'Loop Runner', 'url': SITE + '/' },
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${canonical}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta name="theme-color" content="#0b0b10">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Playloop">
  <meta property="og:image" content="${SITE}/looprunner-preview.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${SITE}/looprunner-preview.png">
  <link rel="icon" href="${SITE}/favicon.ico">
  <link rel="stylesheet" href="${SITE}/styles.css">

  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){ dataLayer.push(arguments); }
    gtag('consent','default',{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'denied'});
  </script>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3857946786580406" crossorigin="anonymous"></script>
  <script async src="https://fundingchoicesmessages.google.com/i/pub-3857946786580406?ers=1"></script>
  <script async src="https://plausible.io/js/pa-R-jYP4Qbw6euJBmD-xEM6.js"></script>

  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

  <style>
    body{ margin:0; }
    .da-wrap{ max-width:880px; margin:0 auto; padding:24px 18px 80px; color:#e8ebf2; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    .da-wrap a{ color:#7cfdd6; }
    .da-hd{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:8px; }
    .da-eyebrow{ font-size:12px; letter-spacing:.18em; color:#ffd700; opacity:.9; font-weight:700; }
    .da-title{ font-size:28px; font-weight:800; margin:4px 0 6px; line-height:1.15; }
    .da-sub{ opacity:.8; font-size:14px; }
    .da-cta{ display:inline-block; margin-top:14px; padding:10px 16px; border-radius:10px; background:linear-gradient(135deg,#7cfdd6,#88ddff); color:#0b0b10; font-weight:700; text-decoration:none; }
    .da-tbl{ width:100%; border-collapse:collapse; margin-top:14px; }
    .da-tbl th, .da-tbl td{ padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.08); text-align:left; font-size:15px; }
    .da-tbl .rank{ width:80px; opacity:.8; }
    .da-tbl .score{ text-align:right; font-variant-numeric:tabular-nums; font-weight:600; color:#ffd700; }
    .tier-grid{ display:grid; grid-template-columns:1fr; gap:10px; margin-top:16px; }
    .tier-bar{ height:8px; background:rgba(255,255,255,.08); border-radius:999px; overflow:hidden; }
    .tier-bar span{ display:block; height:100%; background:linear-gradient(90deg,#ffd700,#7cfdd6); border-radius:999px; }
    .tier-meta{ font-size:13px; opacity:.85; margin-top:4px; }
    .da-narrative p{ font-size:15px; line-height:1.65; opacity:.92; margin:10px 0; }
    .da-foot{ margin-top:32px; padding-top:16px; border-top:1px solid rgba(255,255,255,.08); font-size:13px; opacity:.75; }
    .da-nav{ display:flex; gap:14px; flex-wrap:wrap; font-size:14px; margin:14px 0; opacity:.95; }
  </style>
</head>
<body>
  <main class="da-wrap">
    <nav class="da-nav">
      <a href="${SITE}/">Home</a>
      <a href="${SITE}/how-to-play.html">How to Play</a>
      <a href="${SITE}/strategy.html">Strategy</a>
      <a href="${SITE}/themes.html">Themes</a>
      <a href="${SITE}/power-ups.html">Power-ups</a>
      <a href="${SITE}/hall-of-fame.html">Hall of Fame</a>
    </nav>
    <header class="da-hd">
      <div>
        <div class="da-eyebrow">DAILY RUN ARCHIVE · ${dateStr}</div>
        <h1 class="da-title">${winner ? `${winnerFlag} ${esc(winner)} took ${esc(winnerScore)} pts` : 'No submissions logged'}</h1>
        <div class="da-sub">${a.n.toLocaleString()} attempts · single global seed · same world for every player</div>
      </div>
      <a class="da-cta" href="${SITE}/">▶ Play today's Daily Run</a>
    </header>

    ${top10.length ? `<section>
      <h2 style="margin-top:24px; font-size:18px;">Top 10</h2>
      <table class="da-tbl">
        <thead><tr><th>Rank</th><th>Player</th><th style="text-align:right;">Score</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </section>` : ''}

    ${a.n > 0 ? `<section>
      <h2 style="margin-top:28px; font-size:18px;">Field breakdown</h2>
      ${tiersHtml}
    </section>` : ''}

    <section class="da-narrative" style="margin-top:24px;">
      <h2 style="font-size:18px;">Recap</h2>
      ${narrative}
    </section>

    <section style="margin-top:28px;">
      <h2 style="font-size:18px;">About Loop Runner Daily Run</h2>
      <p style="font-size:15px; line-height:1.65; opacity:.9;">Loop Runner is a free, instant-play browser arcade. Daily Run is a 24-hour event where every player worldwide shares the exact same seed — the same enemy spawn order, the same powerups, the same boss positions at the 5,000 / 15,000 / 30,000-point thresholds. The leaderboard is single-pool worldwide. There is no skin shop, no premium tier, and no rewarded ads on the main site: the only currency is your score. Try the eight rotating themes (Jurassic, Cyberpunk, Deep Sea, Underworld, Mythical, Cosmic, Glitch, Steampunk), chain combos, time your reloads, and stack roguelite upgrade picks every 9 thresholds — pierce, ring burst, crit, time-warp, magnet, hyper-velocity, and more.</p>
    </section>

    <footer class="da-foot">
      Generated automatically from anonymous Supabase submissions. Names are player-submitted at end-of-run; country codes come from coarse IP geolocation. See <a href="${SITE}/privacy.html">our privacy policy</a> for details on what we collect.
    </footer>
  </main>
</body>
</html>`;
}

// --- daily/index.json manifest (idempotent upsert) ---
// One JSON source of truth that lists every archived day + its top finisher.
// Reused to regenerate the Hall-of-Fame archive list section in hall-of-fame.html.
async function upsertManifest(dateStr, rows) {
  const file = path.join(REPO_ROOT, 'daily', 'index.json');
  let manifest = { days: [] };
  if (existsSync(file)) {
    try {
      const text = await readFile(file, 'utf8');
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.days)) manifest = parsed;
    } catch (e) {
      console.warn('Could not parse existing daily/index.json — starting fresh:', e.message);
    }
  }
  const top = rows[0];
  const entry = {
    date: dateStr,
    url: `/daily/${dateStr}/`,
    entries: rows.length,
    winner: top ? {
      name: (top.name || 'Anon').toString().slice(0, 24),
      score: Number(top.score) || 0,
      country: (top.country || 'XX').toUpperCase(),
    } : null,
  };
  // Idempotent: replace any existing entry for this date.
  manifest.days = manifest.days.filter(d => d.date !== dateStr);
  manifest.days.push(entry);
  manifest.days.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  manifest.updatedAt = new Date().toISOString();
  await writeFile(file, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

// --- Hall of Fame archive list regeneration ---
// Replaces content between ARCHIVE_LIST_START / ARCHIVE_LIST_END markers in hall-of-fame.html
// with a fresh, server-rendered list of all daily archives. Internal-link gold for crawlers.
async function regenerateHallOfFameSection(manifest) {
  const file = path.join(REPO_ROOT, 'hall-of-fame.html');
  if (!existsSync(file)) {
    console.warn('hall-of-fame.html not found — skipping archive-list regeneration.');
    return false;
  }
  const html = await readFile(file, 'utf8');
  const startTag = '<!-- ARCHIVE_LIST_START';
  const endTag   = '<!-- ARCHIVE_LIST_END -->';
  const startIdx = html.indexOf(startTag);
  const endIdx   = html.indexOf(endTag);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    console.warn('hall-of-fame.html missing ARCHIVE_LIST markers — skipping.');
    return false;
  }
  const itemsHtml = manifest.days.map(d => {
    const flag = d.winner ? countryFlag(d.winner.country) : '🌐';
    const scoreLabel = d.winner ? `${flag} ${d.winner.score.toLocaleString()} · ${esc(d.winner.name)}` : '—';
    return `          <li style="display:flex; gap:12px; align-items:baseline; font-size:14px; padding:6px 0; border-bottom:1px dashed rgba(255,255,255,.08);">
            <a href="${d.url}" style="font-variant-numeric:tabular-nums; color:#7cfdd6; text-decoration:none; min-width:110px;">${d.date}</a>
            <span style="opacity:.95;">${scoreLabel}</span>
            <span style="margin-left:auto; opacity:.6; font-size:12px;">${d.entries.toLocaleString()} ${d.entries === 1 ? 'entry' : 'entries'}</span>
          </li>`;
  }).join('\n');
  const replacement = `<!-- ARCHIVE_LIST_START — managed by .github/scripts/build-daily-archive.mjs. Do not edit by hand;
           content between these markers is regenerated nightly with every new daily archive. -->
      <section id="archiveList">
        <h2>Archived Daily Runs</h2>
        <p>Every completed Daily Run gets its own permanent page with the full top 10, a country breakdown, and a tier histogram. The newest archives appear first.</p>
        <ul class="archive-list" style="margin:14px 0 0 0; padding:0; list-style:none; display:grid; gap:0;">
${itemsHtml || '          <li style="opacity:.7; font-size:14px;">Awaiting the first nightly archive run — check back tomorrow.</li>'}
        </ul>
      </section>
      ${endTag}`;
  const next = html.slice(0, startIdx) + replacement + html.slice(endIdx + endTag.length);
  if (next === html) return false;
  await writeFile(file, next, 'utf8');
  return true;
}

// --- sitemap update (idempotent) ---
async function updateSitemap(dateStr) {
  const file = path.join(REPO_ROOT, 'sitemap.xml');
  const url = `${SITE}/daily/${dateStr}/`;
  let xml;
  try {
    xml = await readFile(file, 'utf8');
  } catch {
    // sitemap missing — create a minimal one
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n';
  }
  if (xml.includes(`<loc>${url}</loc>`)) {
    // Already present; nothing to do.
    return false;
  }
  const today = ymd(new Date());
  const entry = `  <url>\n    <loc>${url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>yearly</changefreq>\n    <priority>0.5</priority>\n  </url>\n`;
  xml = xml.replace('</urlset>', entry + '</urlset>');
  await writeFile(file, xml, 'utf8');
  return true;
}

// --- Optional X/Twitter post (only if all 4 OAuth 1.0a secrets present) ---
function haveTwitterCreds() {
  return !!(process.env.TWITTER_CONSUMER_KEY && process.env.TWITTER_CONSUMER_SECRET
         && process.env.TWITTER_ACCESS_TOKEN && process.env.TWITTER_ACCESS_TOKEN_SECRET);
}

function rfc3986(s) {
  return encodeURIComponent(s).replace(/[!*'()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

async function postTweet(text) {
  // OAuth 1.0a signed POST to api.twitter.com/2/tweets — same scheme as v1.1 statuses.
  const url = 'https://api.twitter.com/2/tweets';
  const body = JSON.stringify({ text });
  const oauth = {
    oauth_consumer_key: process.env.TWITTER_CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: process.env.TWITTER_ACCESS_TOKEN,
    oauth_version: '1.0',
  };
  // Build signature base — body is JSON, so only OAuth params go in the param string.
  const paramStr = Object.keys(oauth).sort()
    .map(k => rfc3986(k) + '=' + rfc3986(oauth[k]))
    .join('&');
  const base = 'POST&' + rfc3986(url) + '&' + rfc3986(paramStr);
  const signingKey = rfc3986(process.env.TWITTER_CONSUMER_SECRET) + '&' + rfc3986(process.env.TWITTER_ACCESS_TOKEN_SECRET);
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
  const authHeader = 'OAuth ' + Object.keys(oauth).sort()
    .map(k => rfc3986(k) + '="' + rfc3986(oauth[k]) + '"')
    .join(', ');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Tweet failed ${res.status}: ${t}`);
  }
  return res.json();
}

function tweetText(dateStr, rows) {
  const a = analyse(rows);
  if (a.n === 0) {
    return `🌐 Loop Runner Daily Run ${dateStr}: no submissions — wide open. Play it: https://playloop.run/`;
  }
  const w = a.best;
  return `🏆 Loop Runner Daily Run ${dateStr}
${countryFlag(w.country)} ${w.name || 'Anon'} took the day with ${Number(w.score).toLocaleString()} pts across ${a.n} attempts.
Same seed for everyone. Play today: https://playloop.run/`;
}

// --- main ---
async function main() {
  const target = (process.env.TARGET_DATE && /^\d{4}-\d{2}-\d{2}$/.test(process.env.TARGET_DATE))
    ? new Date(process.env.TARGET_DATE + 'T00:00:00Z')
    : yesterdayUTC();
  const dateStr = ymd(target);
  console.log('Building Daily Run archive for', dateStr);

  const rows = await fetchScoresForDay(target);
  console.log(`Fetched ${rows.length} score row(s) for ${dateStr}`);

  const dir = path.join(REPO_ROOT, 'daily', dateStr);
  await mkdir(dir, { recursive: true });
  const html = renderHtml(dateStr, rows);
  await writeFile(path.join(dir, 'index.html'), html, 'utf8');
  console.log('Wrote', path.join('daily', dateStr, 'index.html'));

  const sitemapChanged = await updateSitemap(dateStr);
  console.log('Sitemap updated:', sitemapChanged);

  const manifest = await upsertManifest(dateStr, rows);
  console.log(`Manifest now lists ${manifest.days.length} day(s).`);

  const hofChanged = await regenerateHallOfFameSection(manifest);
  console.log('Hall of Fame archive list updated:', hofChanged);

  if (haveTwitterCreds() && rows.length > 0) {
    try {
      const text = tweetText(dateStr, rows);
      const result = await postTweet(text);
      console.log('Tweet posted:', result?.data?.id || '(no id)');
    } catch (e) {
      console.warn('Tweet failed (continuing):', e.message);
    }
  } else {
    console.log('No Twitter creds (or no rows) — skipping auto-tweet.');
  }
}

main().catch(err => {
  console.error('Daily archive build failed:', err);
  process.exit(1);
});
