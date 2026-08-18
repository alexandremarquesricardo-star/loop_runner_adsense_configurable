#!/usr/bin/env node
/**
 * Loop Runner — store-art capture.
 *
 * Poses the game at a chosen theme/score/density via the ?capture=1 hook in game.js,
 * then screenshots it at each size the portals ask for. Zero npm deps: a built-in
 * static server plus Chrome driven over CDP with Node's global WebSocket.
 *
 *   node tools/capture.mjs [--theme cyberpunk] [--out portal-build/store-assets]
 *
 * Why this exists: the covers submitted in 2026-06 were captured from a fresh run —
 * an almost-empty screen reading "WARMING UP" — which is what the portals saw first.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ') || true]));

const THEME = args.theme || 'cyberpunk';
const OUT = args.out || 'portal-build/store-assets';
const SECONDS = Number(args.seconds) || 14;
const PORT = 8731;
const CDP_PORT = 9333;

const SHOTS = [
  { name: 'crazygames-cover-1920x1080', w: 1920, h: 1080, enemies: 22 },
  { name: 'crazygames-cover-800x1200',  w: 800,  h: 1200, enemies: 20 },
  { name: 'crazygames-cover-800x800',   w: 800,  h: 800,  enemies: 18 },
  { name: 'loop-runner-1280x720',       w: 1280, h: 720,  enemies: 20 },
  { name: 'loop-runner-512x384',        w: 512,  h: 384,  enemies: 14 },
  { name: 'loop-runner-512x512',        w: 512,  h: 512,  enemies: 14 },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rq.writeHead(404); return rq.end('nope');
      }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rq);
    });
    s.listen(PORT, () => res(s));
  });
}

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find((p) => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = await serve();
  const prof = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'lr-cap-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${prof}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--mute-audio', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', 'about:blank',
  ], { stdio: 'ignore' });

  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      target = (await r.json()).find((t) => t.type === 'page');
    } catch {}
  }
  if (!target) { chrome.kill(); server.close(); throw new Error('Chrome never came up'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  const handlers = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method && handlers.has(d.method)) handlers.get(d.method)(d.params);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, (d) => d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  // The tall portrait viewport intermittently fails the first capture right after a
  // device-metrics change; one retry after a beat is enough.
  const shoot = async (opts) => {
    for (let a = 0; ; a++) {
      try { return await send('Page.captureScreenshot', opts); }
      catch (e) { if (a >= 3) throw e; await sleep(400); }
    }
  };
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  // Keep ad iframes and the consent dialog out of the frame.
  await send('Network.setBlockedURLs', { urls: ['*googlesyndication*', '*doubleclick*',
    '*googletagservices*', '*fundingchoices*', '*google-analytics*', '*plausible*'] });

  fs.mkdirSync(path.join(ROOT, OUT), { recursive: true });
  const made = [];

  for (const shot of (args['skip-stills'] ? [] : SHOTS)) {
    await send('Emulation.setDeviceMetricsOverride',
      { width: shot.w, height: shot.h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?capture=1` });
    await sleep(1800);

    // Strip the page chrome so the canvas fills the frame, then let the game re-measure.
    await evaluate(`(()=>{for(const s of ['#site-nav','#ad-top-wrapper','#ad-spacer','footer','a[href="/privacy.html"]'])
      document.querySelectorAll(s).forEach(e=>e.remove());
      document.documentElement.style.setProperty('--navH','0px');
      document.documentElement.style.setProperty('--adH','0px');
      dispatchEvent(new Event('resize'));})()`);
    await sleep(200);

    // Pose light, let the wave drift inward off the spawn edges, then top up. Posing the
    // full count at once pins every enemy to the border — which is exactly what made the
    // original covers read as an empty screen with debris around the rim.
    const posed = await evaluate(
      `window.__lrCapture.pose({theme:'${THEME}',enemies:${Math.round(shot.enemies * 0.55)}})`);
    await sleep(1500);
    await evaluate(`window.__lrCapture.spawn(${Math.round(shot.enemies * 0.5)})`);
    await sleep(800);
    await evaluate('window.__lrCapture.fire(4)');
    await sleep(150);   // let the ring spread without giving it time to farm kills
    // calm() and freeze() must land in the same evaluate: any frame between them lets
    // another kill repaint the score, refire a milestone banner, and re-tint the screen.
    await evaluate('window.__lrCapture.calm(); window.__lrCapture.freeze();');
    const stats = await evaluate('window.__lrCapture.stats()');

    const { data } = await shoot({ format: 'jpeg', quality: 90 });
    const file = path.join(ROOT, OUT, shot.name + '.jpg');
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    made.push({ file: path.relative(ROOT, file), ...stats });
    console.log(`  ${shot.name}.jpg  theme=${stats.theme} enemies=${stats.enemies} bullets=${stats.bullets} particles=${stats.particles}`);
    if (posed.enemies === 0) console.warn(`  !! ${shot.name}: posed with zero enemies`);
  }

  if (args.video) {
    const CLIPS = [
      { name: 'crazygames-video-landscape', w: 1280, h: 720 },
      { name: 'crazygames-video-portrait',  w: 720,  h: 1280 },
    ];
    for (const clip of CLIPS.filter((k) => !args.clip || k.name.includes(args.clip))) {
      await send('Emulation.setDeviceMetricsOverride',
        { width: clip.w, height: clip.h, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?capture=1` });
      await sleep(1800);
      await evaluate(`(()=>{for(const s of ['#site-nav','#ad-top-wrapper','#ad-spacer','footer','a[href="/privacy.html"]'])
        document.querySelectorAll(s).forEach(e=>e.remove());
        document.documentElement.style.setProperty('--navH','0px');
        document.documentElement.style.setProperty('--adH','0px');
        dispatchEvent(new Event('resize'));})()`);
      await evaluate(`window.__lrCapture.pose({theme:'${THEME}',enemies:16})`);
      await sleep(1200);
      await evaluate('window.__lrCapture.freeze()');

      // Render offline: advance an exact 1/FPS per frame and grab each one. Slower than
      // real time to produce, but the resulting clip is a true fixed-rate 30fps.
      const FPS = 30, total = SECONDS * FPS, frames = [];
      for (let f = 0; f < total; f++) {
        await evaluate(`window.__lrCapture.step(${1 / FPS}, ${(f / FPS).toFixed(3)})`);
        const { data } = await shoot({ format: 'jpeg', quality: 85 });
        frames.push(data);
        if (f % 60 === 0) console.log(`    ${clip.name}: ${f}/${total} frames`);
      }

      const dir = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'lr-frames-'));
      frames.forEach((d, i) =>
        fs.writeFileSync(path.join(dir, String(i).padStart(5, '0') + '.jpg'), Buffer.from(d, 'base64')));
      const fps = FPS;
      const outFile = path.join(ROOT, OUT, clip.name + '.mp4');
      await new Promise((res, rej) => {
        const ff = spawn('ffmpeg', ['-y', '-framerate', String(fps), '-i', path.join(dir, '%05d.jpg'),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '23',
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', outFile], { stdio: 'ignore' });
        ff.on('exit', (code) => code === 0 ? res() : rej(new Error('ffmpeg exit ' + code)));
        ff.on('error', rej);
      });
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`  ${clip.name}.mp4  ${frames.length} frames @ ~${fps}fps  ${(fs.statSync(outFile).size/1e6).toFixed(2)} MB`);
    }
  }

  ws.close(); chrome.kill(); server.close();
  console.log(`\n${made.length} covers written to ${OUT}/`);
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
