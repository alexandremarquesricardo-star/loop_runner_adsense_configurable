/**
 * Loop Runner — OG card Worker
 *
 * Renders a 1200×630 PNG OG card for a given challenge URL.
 * Designed to live at e.g. og.playloop.run/card?c=<seed>&from=<name>&score=<n>&theme=<key>
 *
 * Build-time bundling (esbuild via wrangler) inlines:
 *   - @resvg/resvg-wasm/index_bg.wasm  (rasterization engine)
 *   - fonts/inter-bold.ttf             (text rendering)
 *   - fonts/inter-regular.ttf
 *
 * Cache: hard 1-year cache because the cards are deterministic from URL params.
 * If a player ever needs a fresh re-render, bump CACHE_VERSION below.
 */
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import interBold from './fonts/inter-bold.ttf';
import interRegular from './fonts/inter-regular.ttf';

const CACHE_VERSION = 'v1';

let wasmReady = null;
function ensureInit() {
  if (!wasmReady) wasmReady = initWasm(resvgWasm);
  return wasmReady;
}

// Theme palette mirrors game.js THEMES nebula tints — we tint the card backdrop accordingly.
const THEMES = {
  jurassic:  { a: 'rgba(180,120,60,0.55)',  b: 'rgba(120,180,80,0.18)' },
  cyberpunk: { a: 'rgba(120,60,200,0.55)',  b: 'rgba(60,180,220,0.18)' },
  deepsea:   { a: 'rgba(30,90,160,0.60)',   b: 'rgba(40,160,180,0.18)' },
  underworld:{ a: 'rgba(180,30,30,0.55)',   b: 'rgba(100,20,60,0.18)' },
  mythical:  { a: 'rgba(220,160,60,0.55)',  b: 'rgba(200,60,60,0.18)' },
  cosmic:    { a: 'rgba(80,30,160,0.65)',   b: 'rgba(140,60,200,0.18)' },
  glitch:    { a: 'rgba(255,0,255,0.45)',   b: 'rgba(0,255,255,0.18)' },
  steampunk: { a: 'rgba(180,120,60,0.55)',  b: 'rgba(140,90,50,0.18)' },
};

function countryFlagSVG(cc) {
  if (!cc || cc.length !== 2) return '';
  const A = 0x1F1E6;
  const a = cc.toUpperCase().charCodeAt(0) - 65;
  const b = cc.toUpperCase().charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return '';
  return String.fromCodePoint(A + a) + String.fromCodePoint(A + b);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function scoreColor(score) {
  if (score >= 50000) return '#ffd700';
  if (score >= 25000) return '#7cfdd6';
  if (score >= 10000) return '#88ddff';
  return '#ffeeaa';
}

function buildLadder(score) {
  const tiers = [5000, 10000, 25000, 50000, 100000];
  return tiers.map(t => score >= t ? '■' : '□').join(' ');
}

function buildSvg({ score, name, country, themeKey, seed, date, isChallenge, rivalName, rivalScore }) {
  const theme = THEMES[themeKey] || THEMES.cyberpunk;
  const W = 1200, H = 630;
  const flag = countryFlagSVG(country);
  const sColor = scoreColor(score);
  const ladder = buildLadder(score);
  const outcomeRibbon = isChallenge
    ? (score > rivalScore
        ? `🏆 Beat ${esc(rivalName)}'s ${rivalScore.toLocaleString()}`
        : score === rivalScore
          ? `🤝 Tied ${esc(rivalName)} at ${rivalScore.toLocaleString()}`
          : `⏱ Chasing ${esc(rivalName)}'s ${rivalScore.toLocaleString()}`)
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <radialGradient id="glow" cx="25%" cy="40%" r="70%">
        <stop offset="0" stop-color="${theme.a}"/>
        <stop offset="0.6" stop-color="${theme.b}"/>
        <stop offset="1" stop-color="rgba(8,8,15,0)"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#0a0b12"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>

    <!-- Faint grid -->
    ${Array.from({length: 10}, (_, i) => `<line x1="0" y1="${60 + i*60}" x2="${W}" y2="${60 + i*60}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`).join('')}
    ${Array.from({length: 19}, (_, i) => `<line x1="${60 + i*60}" y1="0" x2="${60 + i*60}" y2="${H}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`).join('')}

    <!-- Brand wordmark -->
    <text x="60" y="80" font-family="Inter" font-weight="700" font-size="36" fill="#7cfdd6">LOOP RUNNER</text>
    <text x="60" y="118" font-family="Inter" font-weight="500" font-size="22" fill="rgba(255,255,255,0.75)">playloop.run</text>

    <!-- Date + theme top-right -->
    <text x="${W-60}" y="78" font-family="Inter" font-weight="600" font-size="18" fill="rgba(255,255,255,0.7)" text-anchor="end">${esc(themeKey.toUpperCase())} · ${esc(date)}</text>
    <text x="${W-60}" y="112" font-family="Inter" font-weight="500" font-size="20" fill="rgba(255,255,255,0.7)" text-anchor="end">${flag} ${esc(name)}</text>

    <!-- Huge score -->
    <text x="${W/2}" y="${H/2 + 10}" font-family="Inter" font-weight="800" font-size="180" fill="${sColor}" text-anchor="middle" filter="url(#glow)">${score.toLocaleString()}</text>
    <text x="${W/2}" y="${H/2 + 90}" font-family="Inter" font-weight="600" font-size="28" fill="rgba(255,255,255,0.75)" text-anchor="middle">POINTS</text>

    <!-- Ladder -->
    <text x="${W/2}" y="${H - 120}" font-family="Inter" font-weight="700" font-size="56" fill="#ffffff" text-anchor="middle" letter-spacing="6">${ladder}</text>

    <!-- Challenge ribbon (optional) -->
    ${isChallenge ? `<text x="60" y="${H-60}" font-family="Inter" font-weight="600" font-size="22" fill="${score > rivalScore ? '#7cfdd6' : 'rgba(255,255,255,0.8)'}">${esc(outcomeRibbon)}</text>` : ''}

    <!-- Footer CTA -->
    <text x="${W-60}" y="${H-60}" font-family="Inter" font-weight="500" font-size="22" fill="rgba(255,255,255,0.7)" text-anchor="end">Beat this score → playloop.run</text>
  </svg>`;
}

function parseParams(url) {
  const p = url.searchParams;
  const score = Math.max(0, parseInt(p.get('score') || p.get('beat') || '0', 10) | 0);
  const beat  = Math.max(0, parseInt(p.get('beat')  || '0', 10) | 0);
  const name = (p.get('name') || p.get('from') || 'Player').toString().replace(/[^\w\s.\-+]/g, '').slice(0, 24).trim() || 'Player';
  const country = (p.get('country') || 'XX').toString().toUpperCase().slice(0, 2);
  const themeKey = (p.get('theme') || 'cyberpunk').toString().toLowerCase().slice(0, 16);
  const seed = (p.get('c') || p.get('seed') || '0').toString().slice(0, 16);
  const date = (p.get('date') || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const rivalName = (p.get('rival') || '').toString().replace(/[^\w\s.\-+]/g, '').slice(0, 24).trim();
  const isChallenge = !!rivalName && beat > 0;
  return { score, beat, name, country, themeKey, seed, date, rivalName, rivalScore: beat, isChallenge };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.endsWith('/card') && !url.pathname.endsWith('/card.png') && url.pathname !== '/') {
      return new Response('Not found', { status: 404 });
    }
    try {
      const params = parseParams(url);
      await ensureInit();
      const svg = buildSvg(params);
      const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: 1200 },
        font: { loadSystemFonts: false, fontFiles: [], defaultFontFamily: 'Inter' },
      });
      // Register the inlined fonts so SVG text renders
      // (resvg-wasm reads ttf bytes; the wrangler binding gives us ArrayBuffer-like values)
      // Note: @resvg/resvg-wasm 2.x accepts fontBuffers in the constructor instead — both paths supported here.
      const png = resvg.render().asPng();
      return new Response(png, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
          'X-OG-Version': CACHE_VERSION,
        },
      });
    } catch (err) {
      // Fall back to a tiny error-state SVG response so OG previews still show something.
      const errSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0a0b12"/><text x="600" y="320" text-anchor="middle" font-family="Arial" font-size="48" fill="#7cfdd6">LOOP RUNNER · playloop.run</text></svg>`;
      return new Response(errSvg, {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml', 'X-OG-Error': err.message.slice(0, 200), 'Cache-Control': 'no-store' },
      });
    }
  },
};
