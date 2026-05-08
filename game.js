(() => {
  const $ = (sel) => document.querySelector(sel);
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W=0, H=0, DPR=Math.min(devicePixelRatio||1,2);

  /* ====== layout sizing (ad-aware) ====== */
  function resize(){
    const spacer = document.getElementById('ad-spacer');
    const adH = (spacer && spacer.offsetHeight) || parseInt(getComputedStyle(document.documentElement).getPropertyValue('--adH')) || 0;
    W = innerWidth|0;
    const nav = document.getElementById('site-nav');
    const navH = (nav && nav.offsetHeight) || parseInt(getComputedStyle(document.documentElement).getPropertyValue('--navH')) || 0;
    H = Math.max(0, (innerHeight|0) - adH - navH);
    canvas.width  = Math.max(1, W*DPR);
    canvas.height = Math.max(1, H*DPR);
    canvas.style.width = W+'px';
    canvas.style.height = H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  addEventListener('resize', resize);

  const topIns = document.getElementById('ad-top-unit');
  const spacer = document.getElementById('ad-spacer');
  const topWrap = document.getElementById('ad-top-wrapper');

  function tryFillTopAd(){
    if(!topIns) return;
    const w = topIns.clientWidth;
    if(w && w > 0){ (window.adsbygoogle=window.adsbygoogle||[]).push({}); return true; }
    return false;
  }
  window.addEventListener('load', ()=>{
    let ok = tryFillTopAd();
    if(!ok){ const id = setInterval(()=>{ if(tryFillTopAd()) clearInterval(id); }, 200); setTimeout(()=> clearInterval(id), 5000); }
    resize();
  });

  // Detect whether the AdSense slot actually filled. If not, collapse the wrapper
  // entirely so localhost (or any unfilled view) gets the full game canvas.
  function isAdFilled(){
    if (!topIns) return false;
    if (topIns.getAttribute('data-ad-status') === 'filled') return true;
    const iframe = topIns.querySelector('iframe');
    return !!(iframe && iframe.offsetHeight > 1);
  }
  function updateAdVars(){
    if (!topWrap || !spacer) return;
    const filled = isAdFilled();
    topWrap.classList.toggle('has-ad', filled);
    const h = filled ? topWrap.offsetHeight : 0;
    spacer.style.height = h + 'px';
    document.documentElement.style.setProperty('--adH', h + 'px');
    resize();
  }
  if('ResizeObserver' in window && topWrap){ new ResizeObserver(updateAdVars).observe(topWrap); } else { setTimeout(updateAdVars, 300); }
  // Re-check fill state for a few seconds in case the ad arrives late.
  let adChecks = 0;
  const adCheckId = setInterval(() => {
    updateAdVars();
    if (++adChecks > 25) clearInterval(adCheckId); // ~10s @ 400ms
  }, 400);

  /* ====== storage helpers ====== */
  function getLS(k, fallback){ try{ const v = localStorage.getItem(k); return v===null? fallback: v; }catch{ return fallback; } }
  function setLS(k, v){ try{ localStorage.setItem(k, v); }catch{} }

  /* ====== state ====== */
  const state = {
    running: false,
    paused: false,
    score: 0,
    combo: 0,
    time: 0,
    best: Number(getLS('lr_best', 0)),
    dailyBest: Number(getLS('lr_daily', 0)),
    spawnTimer: 0,
    spawnInterval: 1.1,
    dailyMode: false,
    fireRounds: 3,
    maxFireRounds: 3,
    rechargeTimer: 0,
    rechargeInterval: 5,
    // Roguelite-pick state — populated each run
    picksTaken: 0,
    upgrades: {},          // { upgradeKey: level }
    timeWarpTimer: 0,      // active duration of post-kill slow-mo
    magnet: false,         // powerup magnet enabled?
    // Theme cycling — visual era rotates every THEME_DURATION seconds
    themeIdx: 0,
    themeTimer: 0,
    themeCyclesCompleted: 0, // # of full revolutions through all themes
    // Game-over canvas freeze — keep rendering for ~1.5s after death so the burst finishes,
    // then stop entirely so the GPU doesn't keep redrawing under the leaderboard modal.
    deathFreezeTimer: 0,
  };

  /* ====== Theme system — visual era rotates every 3 min ====== */
  const THEME_DURATION = 180;
  const THEMES = [
    { key: 'jurassic',  name: 'JURASSIC',   nebulae: [
        { baseX: 0.22, baseY: 0.30, color: 'rgba(180,120, 60,', radius: 0.55, speed: 0.012 },
        { baseX: 0.78, baseY: 0.65, color: 'rgba(120,180, 80,', radius: 0.50, speed: 0.018 },
        { baseX: 0.55, baseY: 0.18, color: 'rgba(220,170, 90,', radius: 0.40, speed: 0.022 },
        { baseX: 0.30, baseY: 0.82, color: 'rgba( 90,140, 60,', radius: 0.42, speed: 0.015 },
    ]},
    { key: 'cyberpunk', name: 'CYBERPUNK',  nebulae: [
        { baseX: 0.22, baseY: 0.30, color: 'rgba(120, 60, 200,', radius: 0.55, speed: 0.012 },
        { baseX: 0.78, baseY: 0.65, color: 'rgba( 60,180, 220,', radius: 0.50, speed: 0.018 },
        { baseX: 0.55, baseY: 0.18, color: 'rgba(240,100, 180,', radius: 0.40, speed: 0.022 },
        { baseX: 0.30, baseY: 0.82, color: 'rgba( 80,240, 180,', radius: 0.42, speed: 0.015 },
    ]},
    { key: 'deepsea',   name: 'DEEP SEA',   nebulae: [
        { baseX: 0.22, baseY: 0.30, color: 'rgba( 30, 90,160,', radius: 0.60, speed: 0.010 },
        { baseX: 0.78, baseY: 0.65, color: 'rgba( 40,160,180,', radius: 0.55, speed: 0.014 },
        { baseX: 0.55, baseY: 0.18, color: 'rgba( 60,200,220,', radius: 0.40, speed: 0.020 },
        { baseX: 0.30, baseY: 0.82, color: 'rgba( 20, 60,120,', radius: 0.50, speed: 0.012 },
    ]},
    { key: 'underworld', name: 'UNDERWORLD', nebulae: [
        { baseX: 0.22, baseY: 0.30, color: 'rgba(180, 30, 30,', radius: 0.55, speed: 0.012 },
        { baseX: 0.78, baseY: 0.65, color: 'rgba(100, 20, 60,', radius: 0.55, speed: 0.014 },
        { baseX: 0.55, baseY: 0.18, color: 'rgba(220, 80, 30,', radius: 0.38, speed: 0.020 },
        { baseX: 0.30, baseY: 0.82, color: 'rgba( 50, 10, 30,', radius: 0.50, speed: 0.015 },
    ]},
    { key: 'mythical',  name: 'MYTHICAL',   nebulae: [
        { baseX: 0.22, baseY: 0.30, color: 'rgba(220,160, 60,', radius: 0.55, speed: 0.012 },
        { baseX: 0.78, baseY: 0.65, color: 'rgba(200, 60, 60,', radius: 0.50, speed: 0.016 },
        { baseX: 0.55, baseY: 0.18, color: 'rgba(255,210,100,', radius: 0.40, speed: 0.020 },
        { baseX: 0.30, baseY: 0.82, color: 'rgba(140, 80,180,', radius: 0.45, speed: 0.014 },
    ]},
    { key: 'cosmic',    name: 'COSMIC',     nebulae: [
        { baseX: 0.22, baseY: 0.30, color: 'rgba( 80, 30,160,', radius: 0.65, speed: 0.008 },
        { baseX: 0.78, baseY: 0.65, color: 'rgba(140, 60,200,', radius: 0.55, speed: 0.012 },
        { baseX: 0.55, baseY: 0.18, color: 'rgba(255,200,100,', radius: 0.30, speed: 0.018 },
        { baseX: 0.30, baseY: 0.82, color: 'rgba( 30, 20, 60,', radius: 0.55, speed: 0.010 },
    ]},
    { key: 'glitch',    name: 'GLITCH',     nebulae: [
        { baseX: 0.22, baseY: 0.30, color: 'rgba(255,  0,255,', radius: 0.45, speed: 0.030 },
        { baseX: 0.78, baseY: 0.65, color: 'rgba(  0,255,255,', radius: 0.45, speed: 0.028 },
        { baseX: 0.55, baseY: 0.18, color: 'rgba(255,255,  0,', radius: 0.35, speed: 0.040 },
        { baseX: 0.30, baseY: 0.82, color: 'rgba(  0,255,  0,', radius: 0.40, speed: 0.034 },
    ]},
    { key: 'steampunk', name: 'STEAMPUNK',  nebulae: [
        { baseX: 0.22, baseY: 0.30, color: 'rgba(180,120, 60,', radius: 0.55, speed: 0.010 },
        { baseX: 0.78, baseY: 0.65, color: 'rgba(140, 90, 50,', radius: 0.55, speed: 0.012 },
        { baseX: 0.55, baseY: 0.18, color: 'rgba(220,170,100,', radius: 0.40, speed: 0.018 },
        { baseX: 0.30, baseY: 0.82, color: 'rgba( 90, 60, 40,', radius: 0.50, speed: 0.013 },
    ]},
  ];
  function currentTheme() { return THEMES[state.themeIdx % THEMES.length]; }

  /* ====== effects (juice) ====== */
  const effects = {
    shake: 0,
    hitStop: 0,
    flash: 0,
    flashColor: '255,80,80',
  };
  const shockwaves = [];
  const stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 1.4 + 0.3,
      twinkle: Math.random() * 10
    });
  }

  /* ====== banner / record-popup system ====== */
  const banners = { active: null, queue: [] };
  const runFlags = {
    pbAtStart: 0,
    dailyPbAtStart: 0,
    pbCrossed: false,
    scoreMilestones: new Set(),
    rankTiersHit: new Set(),
    comboMilestones: new Set(),
    bossesSpawned: new Set(),   // score thresholds at which we already spawned a boss this run
    firedLame: new Set(),       // which lame triggers already fired this run
    topScores: [],
    firstSeen: new Set(),       // enemy types encountered this run (for one-shot banner)
  };

  /* ====== UI refs ====== */
  const ui={
    score:$('#score'), combo:$('#combo'), best:$('#best'), daily:$('#daily'),
    fireIndicator:$('#fireIndicator'),
    overlay:$('#overlay'),
    ovTitle:$('#overlayTitle'), ovBody:$('#overlayBody'),
    start:$('#start'), dailyBtn:$('#dailyBtn'),
    btnResume:$('#btnResume'), btnPlayAgain:$('#btnPlayAgain'), btnShare:$('#btnShare'),
    lbBtn:$('#lbBtn'), nameInput:$('#nameInput'),
    restartBtn:$('#restartBtn'), shareBtn:$('#shareBtn'),
    dailyBanner:$('#dailyBanner')
  };

  function updateFireIndicator() {
    if (!ui.fireIndicator) return;
    
    const dots = ui.fireIndicator.querySelectorAll('.fire-dot');
    const isEmpty = state.fireRounds === 0;
    
    ui.fireIndicator.classList.toggle('empty', isEmpty);
    
    dots.forEach((dot, i) => {
      if (i < state.fireRounds) {
        dot.classList.add('active');
        dot.classList.remove('inactive');
      } else {
        dot.classList.remove('active');
        dot.classList.add('inactive');
      }
    });
  }

  function hydrateHUD(){ 
    ui.score.textContent='Score: 0'; 
    ui.combo.textContent='Combo: 0'; 
    ui.best.textContent='Best: '+state.best; 
    ui.daily.textContent='Daily: '+state.dailyBest;
    updateFireIndicator();
    
    // Load saved name into input field
    const savedName = getLS('lr_name', '');
    if (savedName && ui.nameInput) {
      ui.nameInput.value = savedName;
    }
  }
  hydrateHUD();
  ui.dailyBanner.textContent = 'Daily Challenge: ' + new Date().toISOString().slice(0,10);

  /* ====== Pause/Resume helpers (overlay driven) ====== */
  function showOverlay(){ ui.overlay.classList.add('visible'); }
  function hideOverlay(){ ui.overlay.classList.remove('visible'); }

  function setOverlayHome(){
    ui.ovTitle.textContent = 'Loop Runner';
    ui.ovBody.innerHTML = 'Aim with your mouse or finger. <b>Right-click</b> or <b>tap</b> to fire (3 rounds, auto-recharge). Chain kills to build combo. Catch power-ups for special abilities!<br><span style="opacity:.9">Need help? Read the <a href=\'how-to-play.html\' style=\'color:#7cfdd6\'>How to Play</a> guide.</span>';
    ui.btnResume.style.display = 'none';
    ui.btnPlayAgain.style.display = 'none';
    showOverlay();
  }
  function setOverlayPaused(){
    ui.ovTitle.textContent = 'Paused';
    ui.ovBody.innerHTML = 'Press <b>P</b> or <b>Esc</b> to resume';
    ui.btnResume.style.display = '';
    ui.btnPlayAgain.style.display = '';
    showOverlay();
  }
  function setOverlayGameOver(score, best, isPB, flavor){
    ui.ovTitle.textContent = isPB ? 'New Best!' : 'Game Over';
    let body = `Score: <b>${score}</b> • Best: <b>${best}</b>${isPB?' • 🎉':''}`;
    if (flavor) {
      body += `<br><span style="opacity:.85; font-style:italic;">${flavor}</span>`;
    }
    ui.ovBody.innerHTML = body;
    ui.btnResume.style.display = 'none';
    ui.btnPlayAgain.style.display = '';
    showOverlay();
  }

  /* ====== RNG ====== */
  const todayKey=()=>new Date().toISOString().slice(0,10);
  function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}};
  let seededRand=Math.random; let usingSeed=false;
  function setDailySeed(){ usingSeed=true; seededRand=mulberry32(hashToInt('looprunner:'+todayKey())); }
  function rnd(a=0,b=1){ return (usingSeed?seededRand():Math.random())*(b-a)+a; }
  function rndi(a,b){ return Math.floor(rnd(a,b+1)); }
  function hashToInt(str){ let h=2166136261>>>0; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }

  /* ====== Audio ====== */
  let audio, master;
  function initAudio(){
    if(!audio){
      audio = new (window.AudioContext||window.webkitAudioContext)();
      master = audio.createGain();
      master.gain.value = 0.4;
      master.connect(audio.destination);
    }
    if (audio.state === 'suspended') audio.resume();
  }

  function _tone({ type='sine', freq=440, freq2=null, dur=0.15, gain=0.15, attack=0.005, delay=0 }) {
    if (!audio) return;
    const t0 = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freq2 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function _noiseBurst({ dur=0.3, gain=0.2, filterFreq=1200, delay=0 }) {
    if (!audio) return;
    const t0 = audio.currentTime + delay;
    const len = Math.floor(audio.sampleRate * dur);
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = audio.createBufferSource(); src.buffer = buf;
    const filt = audio.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = filterFreq;
    const g = audio.createGain(); g.gain.value = gain;
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t0);
  }

  const sfx = {
    fire() {
      _tone({ type:'sawtooth', freq: 520, freq2: 90, dur: 0.11, gain: 0.18 });
      _noiseBurst({ dur: 0.05, gain: 0.06, filterFreq: 2400 });
    },
    kill(combo = 0) {
      const base = 540 + Math.min(combo, 24) * 30;
      _tone({ type:'square',   freq: base,      freq2: base * 0.5, dur: 0.09, gain: 0.14 });
      _tone({ type:'triangle', freq: base * 2,  freq2: base,        dur: 0.10, gain: 0.08 });
    },
    comboHit(level = 1) {
      const notes = [523.25, 659.25, 783.99, 987.77, 1174.66, 1318.51];
      const f = notes[Math.min(level - 1, notes.length - 1)] || notes[0];
      _tone({ type:'triangle', freq: f,     dur: 0.28, gain: 0.18 });
      _tone({ type:'sine',     freq: f * 2, dur: 0.28, gain: 0.10 });
    },
    powerup(kind = 'recharge') {
      const seq = (kind === 'multiplier')
        ? [523.25, 659.25, 783.99, 1046.50]
        : [392.00, 523.25, 659.25, 783.99];
      seq.forEach((f, i) => {
        _tone({ type:'triangle', freq: f, dur: 0.18, gain: 0.16, delay: i * 0.05 });
      });
    },
    death() {
      _tone({ type:'sawtooth', freq: 220, freq2: 35, dur: 0.7, gain: 0.28 });
      _tone({ type:'square',   freq: 110, freq2: 25, dur: 0.7, gain: 0.18 });
      _noiseBurst({ dur: 0.5, gain: 0.18, filterFreq: 600 });
    },
    fanfare(level = 1) {
      // Big-deal stinger: rising arpeggio with a low pad
      const root = 392.00; // G4
      const intervals = [1, 1.25, 1.5, 2.0]; // major triad up to octave
      intervals.forEach((m, i) => {
        _tone({ type:'triangle', freq: root * m,     dur: 0.32, gain: 0.18, delay: i * 0.06 });
        _tone({ type:'sine',     freq: root * m * 2, dur: 0.32, gain: 0.10, delay: i * 0.06 });
      });
      _tone({ type:'sawtooth', freq: root / 2, dur: 0.55, gain: 0.10 });
    },
    sadTrombone() {
      // Womp-womp-womp-wommmp
      const notes = [415.30, 392.00, 369.99, 311.13];
      notes.forEach((f, i) => {
        _tone({ type:'sawtooth', freq: f, dur: 0.18, gain: 0.16, delay: i * 0.16 });
      });
    },
    chargerAim() {
      // Rising-pitch lock-on tell — short, ominous
      _tone({ type:'sawtooth', freq: 180, freq2: 520, dur: 0.55, gain: 0.10 });
    },
    chargerDash() {
      // Whoosh: quick down-sweep + filtered noise
      _tone({ type:'sawtooth', freq: 720, freq2: 110, dur: 0.18, gain: 0.14 });
      _noiseBurst({ dur: 0.14, gain: 0.08, filterFreq: 1800 });
    },
    shieldBounce() {
      // Metallic ping: high triangle + decaying square
      _tone({ type:'triangle', freq: 1760, freq2: 1320, dur: 0.10, gain: 0.10 });
      _tone({ type:'square',   freq:  880, freq2:  660, dur: 0.08, gain: 0.05 });
    },
    splitterPop() {
      // Wet pop: two-stage bass thump
      _tone({ type:'sine',     freq: 220, freq2:  80, dur: 0.16, gain: 0.18 });
      _tone({ type:'triangle', freq: 440, freq2: 220, dur: 0.10, gain: 0.10 });
    },
    enemyShoot() {
      // Sharp pew: descending square
      _tone({ type:'square', freq: 380, freq2: 180, dur: 0.10, gain: 0.12 });
    },
    enemyBulletDestroyed() {
      // Pleasing crunch when player shoots down a projectile
      _tone({ type:'triangle', freq: 1200, freq2: 600, dur: 0.08, gain: 0.10 });
      _noiseBurst({ dur: 0.05, gain: 0.05, filterFreq: 3000 });
    },
  };

  /* ====== Entities ====== */
  const player = { x: W/2, y: H/2, r: 12, vx: 0, vy: 0, maxSpeed: 400, friction: 8, angle: 0 };
  const enemies = [];
  const bullets = [];
  const particles = [];
  const shards = [];            // spinning polygon debris (death bursts)
  const flashes = [];           // momentary bright pre-burst flashes at kill points
  const powerups = [];
  const floaters = [];          // arcade-style floating "+points" texts
  const enemyBullets = [];      // projectiles fired BY enemies (orbiters)
  const MAX_ENEMIES = 80;       // hard cap to keep frame budget healthy
  const MAX_ENEMY_BULLETS = 60; // safety cap for projectile spam

  function addParticle(x, y, color = '#8fb3ff', size = 2, life = 0.4, speedMin = 40, speedMax = 240) {
    const a = rnd(0, Math.PI * 2);
    const sp = rnd(speedMin, speedMax);
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life, maxLife: life, size, color
    });
  }

  function addShockwave(x, y, color = '#ffaa55', maxR = 70, life = 0.4, lineWidth = 4) {
    shockwaves.push({ x, y, r: 0, maxR, life, maxLife: life, color, lineWidth });
  }

  // Spinning triangular debris — bigger and more impactful than circular particles for kills.
  function addShardBurst(x, y, color, count = 7, sizeBase = 5) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd(-0.3, 0.3);
      const sp = rnd(140, 320);
      shards.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        rot: rnd(0, Math.PI * 2),
        vrot: rnd(-9, 9),
        size: sizeBase + rnd(-1.5, 2.5),
        life: rnd(0.45, 0.75),
        maxLife: 0.75,
        color,
      });
    }
  }

  // Brief bright white pulse at a kill point — the AAA microbeat before debris.
  function addFlashPulse(x, y, maxR = 36, life = 0.18, color = '#ffffff') {
    flashes.push({ x, y, r: 0, maxR, life, maxLife: life, color });
  }

  function addShake(amount) {
    if (amount > effects.shake) effects.shake = amount;
  }
  function addFlash(amount, color) {
    if (amount > effects.flash) effects.flash = amount;
    if (color) effects.flashColor = color;
  }

  /* ====== banner system ====== */
  function pushBanner(text, tier = 'good', life = 2.4) {
    banners.queue.push({ text, tier, life, maxLife: life, t: 0 });
  }

  function tickBanners(dt) {
    // Promote queued banner to active when slot is free
    if (!banners.active && banners.queue.length > 0) {
      banners.active = banners.queue.shift();
      const b = banners.active;
      // Reaction effects keyed to tier
      if (b.tier === 'epic') {
        sfx.fanfare();
        addFlash(0.32, '255,215,0');
        addShake(8);
      } else if (b.tier === 'great') {
        sfx.comboHit(4);
        addFlash(0.22, '136,255,204');
        addShake(5);
      } else if (b.tier === 'good') {
        sfx.comboHit(1);
      } else if (b.tier === 'lame') {
        sfx.sadTrombone();
        addFlash(0.18, '255,80,120');
      }
    }
    if (banners.active) {
      banners.active.t += dt;
      banners.active.life -= dt;
      if (banners.active.life <= 0) banners.active = null;
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawBanner() {
    const b = banners.active;
    if (!b) return;

    const TIER_STYLE = {
      epic:  { bg: 'rgba(255,215,0,0.20)',  stroke: '#ffd700', text: '#fff8cc', size: 34 },
      great: { bg: 'rgba(124,253,214,0.18)', stroke: '#7cfdd6', text: '#dffff5', size: 30 },
      good:  { bg: 'rgba(108,170,255,0.16)', stroke: '#6caaff', text: '#dcefff', size: 26 },
      lame:  { bg: 'rgba(255,90,120,0.14)',  stroke: '#ff5a78', text: '#ffd0d8', size: 24 },
    };
    const s = TIER_STYLE[b.tier] || TIER_STYLE.good;

    // Animation: slide-in (0..0.3s), hold, slide-out (last 0.4s)
    let yOff = 0, alpha = 1, scale = 1;
    if (b.t < 0.3) {
      const k = b.t / 0.3;
      yOff = -50 * Math.pow(1 - k, 3);
      alpha = k;
      scale = 0.7 + 0.3 * (1 - Math.pow(1 - k, 2));
    } else if (b.life < 0.4) {
      const k = b.life / 0.4;
      alpha = k;
      yOff = (1 - k) * -8;
    }
    // Lame banners get a drunken wobble
    if (b.tier === 'lame') {
      yOff += Math.sin(b.t * 12) * 2;
    }

    const cx = W / 2;
    const cy = H * 0.22 + yOff;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${s.size}px system-ui, -apple-system, "Segoe UI", Roboto`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const padX = 26, padY = 14;
    const m = ctx.measureText(b.text);
    const w = (m.width + padX * 2) * scale;
    const h = (s.size + padY * 2) * scale;

    // Pill background
    ctx.fillStyle = s.bg;
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = 2;
    ctx.shadowColor = s.stroke;
    ctx.shadowBlur = b.tier === 'lame' ? 6 : 22;
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Text
    ctx.fillStyle = s.text;
    ctx.shadowColor = s.stroke;
    ctx.shadowBlur = b.tier === 'epic' ? 12 : 0;
    ctx.fillText(b.text, cx, cy);
    ctx.restore();
  }

  /* ====== record / roast triggers ====== */
  const SCORE_MILESTONES = [
    { score:   100, text: 'WARMING UP',          tier: 'good'  },
    { score:   250, text: 'GETTING THERE',       tier: 'good'  },
    { score:   500, text: 'NICE',                tier: 'good'  },
    { score:  1000, text: 'KILO CLUB',           tier: 'great' },
    { score:  2500, text: 'CRUSHING IT',         tier: 'great' },
    { score:  5000, text: 'UNSTOPPABLE',         tier: 'epic'  },
    { score: 10000, text: 'LEGEND STATUS',       tier: 'epic'  },
    { score: 25000, text: 'GOD MODE',            tier: 'epic'  },
  ];
  const RANK_TIERS = [
    { rank: 100, text: 'TOP 100',             tier: 'good'  },
    { rank:  50, text: 'TOP 50',              tier: 'great' },
    { rank:  25, text: 'TOP 25',              tier: 'great' },
    { rank:  10, text: 'TOP 10 WORLDWIDE',    tier: 'epic'  },
    { rank:   5, text: 'TOP 5',               tier: 'epic'  },
    { rank:   3, text: 'TOP 3 — PODIUM',      tier: 'epic'  },
    { rank:   1, text: '#1 WORLDWIDE',        tier: 'epic'  },
  ];

  /* ====== Boss waves ======
   * At each score threshold, spawn a single tougher enemy with multi-HP,
   * larger radius, and a dramatic intro banner. Bosses use existing enemy
   * AI (charger/shielder/orbiter) so behavior is familiar — just chunkier.
   */
  const BOSS_THRESHOLDS = [
    { score:  5000, hp:  8, name: 'BOSS' },
    { score: 15000, hp: 12, name: 'BOSS' },
    { score: 30000, hp: 18, name: 'FINAL BOSS' },
  ];
  function spawnBoss(cfg) {
    const types = ['charger', 'shielder', 'orbiter'];
    const type = types[Math.floor(Math.random() * types.length)];
    spawnSingleEnemy(type);
    const e = enemies[enemies.length - 1];
    if (!e) return;
    e.r *= 2.4;
    e.hp = cfg.hp;
    e.maxHp = cfg.hp;
    e.scoreMul = (e.scoreMul || 1) * 6;
    e.isBoss = true;
    // Slow them down a touch so they don't insta-overwhelm at 2.4x scale
    e.vx *= 0.55; e.vy *= 0.55;
    if (e.dashSpeed) e.dashSpeed *= 0.7;
    pushBanner(cfg.name + ' WAVE INCOMING', 'epic', 3.0);
    addFlash(0.4, '255,80,80');
    addShake(15);
    addShockwave(e.x, e.y, '#ff4422', 220, 0.7, 6);
  }
  function maybeSpawnBoss() {
    const score = state.score | 0;
    for (const cfg of BOSS_THRESHOLDS) {
      if (score >= cfg.score && !runFlags.bossesSpawned.has(cfg.score)) {
        runFlags.bossesSpawned.add(cfg.score);
        spawnBoss(cfg);
      }
    }
  }

  function checkRecordTriggers() {
    const score = state.score | 0;

    // Score milestones (once per run, once per threshold)
    for (const m of SCORE_MILESTONES) {
      if (score >= m.score && !runFlags.scoreMilestones.has(m.score)) {
        runFlags.scoreMilestones.add(m.score);
        pushBanner(m.text, m.tier);
      }
    }

    maybeSpawnBoss();

    // Personal best (using snapshot from run-start)
    const pbToBeat = state.dailyMode ? runFlags.dailyPbAtStart : runFlags.pbAtStart;
    if (!runFlags.pbCrossed && pbToBeat > 0 && score > pbToBeat) {
      runFlags.pbCrossed = true;
      pushBanner('NEW PERSONAL BEST!', 'epic');
    }

    // Worldwide rank tiers
    if (runFlags.topScores.length > 0) {
      for (const r of RANK_TIERS) {
        const idx = r.rank - 1;
        if (idx < runFlags.topScores.length && !runFlags.rankTiersHit.has(r.rank)) {
          if (score > runFlags.topScores[idx]) {
            runFlags.rankTiersHit.add(r.rank);
            pushBanner(r.text, r.tier);
          }
        }
      }
    }

    // Lame warnings — fire one per check, randomized from a pool of jabs.
    for (const trig of LAME_TRIGGERS) {
      if (runFlags.firedLame.has(trig.key)) continue;
      if (trig.test(state, score)) {
        runFlags.firedLame.add(trig.key);
        pushBanner(pickRoast(trig.pool), 'lame');
        break;
      }
    }

    // Roguelite upgrade pick (every threshold crossed)
    maybeShowUpgrade();
  }

  function pickRoast(pool) {
    // Always Math.random — never the seeded RNG, so daily mode roasts vary.
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Mid-run lame triggers. Conditions tuned for the post-multiplier scoring curve.
  const LAME_TRIGGERS = [
    {
      key: 'noKills12s',
      test: (s) => s.time > 12 && s.combo === 0,
      pool: [
        'Right-click to fire. Just FYI.',
        'You can shoot, you know.',
        'Try aiming. Pro tip.',
        'Buttons exist for a reason.',
      ],
    },
    {
      key: 'tryHarder20s',
      test: (s, score) => s.time > 20 && score < 250,
      pool: [
        'Are you even trying?',
        'A bot would do better.',
        'Maybe stretch first?',
        'Loading… your skill.',
      ],
    },
    {
      key: 'painful50s',
      test: (s, score) => s.time > 50 && score < 800,
      pool: [
        'My grandma plays better.',
        'Painful to watch.',
        'This is your best?',
        'A turtle would outscore you.',
      ],
    },
    {
      key: 'still90s',
      test: (s, score) => s.time > 90 && score < 2500,
      pool: [
        'Still here? Brave.',
        'Endurance > skill.',
        'A for effort. F for execution.',
        'You\'re committed. Just not good.',
      ],
    },
  ];

  function checkComboMilestone(combo) {
    if (runFlags.comboMilestones.has(combo)) return;
    let banner = null;
    if (combo === 10) banner = ['10 STREAK',           'good'];
    else if (combo === 25) banner = ['25 STREAK',      'great'];
    else if (combo === 50) banner = ['50 STREAK',      'epic'];
    else if (combo === 100) banner = ['CENTURION',     'epic'];
    if (banner) {
      runFlags.comboMilestones.add(combo);
      pushBanner(banner[0], banner[1]);
    }
  }

  const END_FLAVOR = {
    legendaryPB: ['Legendary run.', 'Hall-of-fame stuff.', 'A new bar set.', 'Untouchable.'],
    newPB:       ['New best — keep climbing.', 'Personal record. Earned it.', 'You beat yourself. Nice.'],
    speedrunDeath: [
      'Speedrun world record… at dying.',
      'Why even start?',
      'Sub-5-second hero.',
      'Blink and you missed it.',
    ],
    zeroKills: [
      'Zero kills. Bold strategy.',
      'A pacifist among warriors.',
      'Did you forget how to shoot?',
      'You spent the whole game running.',
    ],
    veryBad: [
      'Did you fall asleep?',
      'A houseplant scores higher.',
      'Did the cat hit the keyboard?',
      'Even the loading screen was harder.',
    ],
    bad: [
      'My grandma plays better.',
      'Beginner luck… missing.',
      'That was something. Not sure what.',
      'You found the floor.',
    ],
    meh: [
      'Practice. Lots of it.',
      'Could be worse. Could be better.',
      'Almost mediocre. Keep going.',
      'You\'re warming up… still.',
    ],
    almost: [
      'Decent. Almost.',
      'Close, but no cigar.',
      'Almost almost.',
      'Right idea. Wrong execution.',
    ],
    great: [
      'Solid run.',
      'Real talent here.',
      'You\'ve done this before.',
      'Cool under pressure.',
    ],
    legendary: [
      'Crushing it.',
      'Untouchable.',
      'Top-shelf play.',
      'They study film of runs like this.',
    ],
  };

  function getEndOfRunFlavor(score, combo, time, isPB) {
    if (isPB && score >= 5000) return pickRoast(END_FLAVOR.legendaryPB);
    if (isPB)                 return pickRoast(END_FLAVOR.newPB);
    if (time < 5)             return pickRoast(END_FLAVOR.speedrunDeath);
    if (combo === 0)          return pickRoast(END_FLAVOR.zeroKills);
    if (score < 50)           return pickRoast(END_FLAVOR.veryBad);
    if (score < 200)          return pickRoast(END_FLAVOR.bad);
    if (score < 500)          return pickRoast(END_FLAVOR.meh);
    if (score < 1500)         return pickRoast(END_FLAVOR.almost);
    if (score >= 5000)        return pickRoast(END_FLAVOR.legendary);
    if (score >= 2500)        return pickRoast(END_FLAVOR.great);
    return null;
  }

  /* ====== Roguelite upgrade picks ====== */
  const UPGRADE_POOL = [
    { key:'ringBurst',   maxLvl:3, name:'Ring Burst',      desc:'+2 bullets per ring shot',                 icon:'◎' },
    { key:'pierce',      maxLvl:3, name:'Piercing Rounds', desc:'+1 enemy per bullet before vanishing',     icon:'↣' },
    { key:'quickReload', maxLvl:3, name:'Quick Reload',    desc:'−1s ammo recharge time',                   icon:'⏱' },
    { key:'spareMag',    maxLvl:3, name:'Spare Magazine',  desc:'+1 max ammo round',                        icon:'+' },
    { key:'heavyCal',    maxLvl:2, name:'Heavy Caliber',   desc:'+2 bullet radius',                         icon:'●' },
    { key:'hyperVel',    maxLvl:2, name:'Hyper Velocity',  desc:'+200 px/s bullet speed',                   icon:'»' },
    { key:'critical',    maxLvl:3, name:'Critical Hit',    desc:'+20% chance for 2× score',                 icon:'✦' },
    { key:'scoreBoost',  maxLvl:3, name:'Greed',           desc:'+25% score on every kill',                 icon:'$' },
    { key:'magnet',      maxLvl:1, name:'Powerup Magnet',  desc:'Powerups drift toward you when nearby',    icon:'◉' },
    { key:'timeWarp',    maxLvl:1, name:'Time Warp',       desc:'0.15s slow-mo on every kill',              icon:'⌛' },
  ];
  const UPGRADE_THRESHOLDS = [1500, 3500, 6500, 10500, 16000, 23000, 33000, 47000, 65000];

  function maybeShowUpgrade() {
    if (!state.running) return;
    const next = UPGRADE_THRESHOLDS[state.picksTaken];
    if (next === undefined || (state.score | 0) < next) return;

    // Filter to upgrades still under their max level
    const available = UPGRADE_POOL.filter(u => (state.upgrades[u.key] || 0) < u.maxLvl);
    if (available.length === 0) {
      state.picksTaken++;
      return;
    }
    // Auto-pick a random available upgrade — no modal, cursor stays where the player wants it.
    // applyUpgrade() already pushes a celebratory banner + flash + shake so the player sees what they got.
    const pick = available[Math.floor(Math.random() * available.length)];
    applyUpgrade(pick.key);
    state.picksTaken++;
    // Brief grace period before the next spawn so the player can register the buff
    state.spawnTimer = Math.max(state.spawnTimer, 0.9);
  }

  function applyUpgrade(key) {
    const def = UPGRADE_POOL.find(u => u.key === key);
    if (!def) return;
    state.upgrades[key] = (state.upgrades[key] || 0) + 1;
    const lvl = state.upgrades[key];

    // Immediate effects (delta-style upgrades that change persistent state)
    if (key === 'quickReload') {
      state.rechargeInterval = Math.max(1.5, 5 - lvl);
    } else if (key === 'spareMag') {
      state.maxFireRounds = 3 + lvl;
      state.fireRounds = state.maxFireRounds;
      updateFireIndicator();
    } else if (key === 'magnet') {
      state.magnet = true;
    }
    // ringBurst, pierce, heavyCal, hyperVel, critical, scoreBoost, timeWarp
    // are read at use-time from state.upgrades — nothing to do here.

    // Celebration
    pushBanner(`+ ${def.name.toUpperCase()}`, 'great');
    addFlash(0.28, '124,253,214');
    addShake(7);
    sfx.fanfare();
  }

  async function fetchTopScoresForFlags() {
    runFlags.topScores = [];
    try {
      const params = new URLSearchParams();
      params.append('select', 'score');
      params.append('order', 'score.desc');
      params.append('limit', '100');
      // Filter by mode for fairer comparison
      params.append('mode', `eq.${state.dailyMode ? 'daily' : 'normal'}`);
      const r = await fetchWithTimeout(`${SB_URL}?${params.toString()}`, { headers: SB_HEADERS }, 5000);
      if (r.ok) {
        const rows = await r.json();
        runFlags.topScores = rows.map(x => x.score | 0).filter(s => s > 0);
      }
    } catch { /* offline — rank-tier banners just won't fire */ }
  }

  /* ====== Enemy types ======
   * Each archetype unlocks at a wave-time threshold and is sampled by weight.
   * Score multiplier (scoreMul) tunes risk/reward at kill time.
   */
  const ENEMY_TYPES = {
    grunt:    { unlockAt:   0, weight: 12, scoreMul: 1.0 },
    swarmer:  { unlockAt:  10, weight:  4, scoreMul: 0.6 },
    splitter: { unlockAt:  25, weight:  3, scoreMul: 1.8 },
    charger:  { unlockAt:  45, weight:  3, scoreMul: 2.5 },
    shielder: { unlockAt:  70, weight:  3, scoreMul: 2.2 },
    orbiter:  { unlockAt: 100, weight:  2, scoreMul: 2.8 },
  };
  const FIRST_SEEN_BANNER = {
    swarmer:  ['SWARM INCOMING',        'good'],
    splitter: ['SPLITTERS',             'good'],
    charger:  ['CHARGERS — DODGE!',     'great'],
    shielder: ['SHIELDERS — FLANK!',    'great'],
    orbiter:  ['ORBITERS — SHOOT BACK!','epic'],
  };

  function pickEnemyType(time) {
    const pool = Object.entries(ENEMY_TYPES).filter(([, cfg]) => time >= cfg.unlockAt);
    const total = pool.reduce((s, [, cfg]) => s + cfg.weight, 0);
    let r = rnd(0, total);
    for (const [name, cfg] of pool) {
      r -= cfg.weight;
      if (r <= 0) return name;
    }
    return 'grunt';
  }

  function pickEdgeSpawn() {
    // Returns {x, y} just outside the canvas, plus the side index for cluster reuse.
    const m = 28;
    const side = rndi(0, 3);
    let x, y;
    if (side === 0)      { x = rnd(-m, W + m); y = -m; }
    else if (side === 1) { x = W + m;          y = rnd(-m, H + m); }
    else if (side === 2) { x = rnd(-m, W + m); y = H + m; }
    else                 { x = -m;             y = rnd(-m, H + m); }
    return { x, y, side };
  }

  function announceFirstSeen(type) {
    if (!FIRST_SEEN_BANNER[type] || runFlags.firstSeen.has(type)) return;
    runFlags.firstSeen.add(type);
    const [text, tier] = FIRST_SEEN_BANNER[type];
    pushBanner(text, tier);
  }

  // Difficulty scalar: 0 at start, ramps to 1 over ~120s, capped.
  function difficulty01() { return clamp01(state.time / 120); }

  function spawnEnemy() {
    if (enemies.length >= MAX_ENEMIES) return;
    const type = pickEnemyType(state.time);
    if (type === 'swarmer') {
      announceFirstSeen('swarmer');
      spawnSwarm();
      return;
    }
    announceFirstSeen(type);
    spawnSingleEnemy(type);
  }

  function spawnSwarm() {
    const { x: bx, y: by } = pickEdgeSpawn();
    const count = rndi(5, 7);
    const baseSpeed = 90 + difficulty01() * 90;
    for (let i = 0; i < count; i++) {
      if (enemies.length >= MAX_ENEMIES) break;
      const x = bx + rnd(-36, 36);
      const y = by + rnd(-36, 36);
      const r = 8;
      const speed = baseSpeed + rnd(-15, 25);
      const ang = Math.atan2(player.y - y, player.x - x) + rnd(-0.35, 0.35);
      enemies.push({
        type: 'swarmer',
        x, y, r,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        speed, ang, hp: 1, age: 0,
        scoreMul: ENEMY_TYPES.swarmer.scoreMul,
      });
    }
  }

  function spawnSingleEnemy(type) {
    const { x, y } = pickEdgeSpawn();
    const cfg = ENEMY_TYPES[type] || ENEMY_TYPES.grunt;
    const d = difficulty01();
    let r, speed, extra = {};

    if (type === 'splitter') {
      r = rnd(22, 28);
      speed = rnd(40, 70) + d * 60;
    } else if (type === 'charger') {
      r = rnd(16, 22);
      speed = rnd(20, 40);  // slow wander; dash speed is separate
      extra = {
        chargeState: 'wander',
        chargeTimer: rnd(1.4, 2.6),
        aimAng: 0,
        dashSpeed: 720 + d * 180,
      };
    } else if (type === 'shielder') {
      r = rnd(18, 24);
      speed = rnd(30, 55) + d * 45;
      // Shield faces toward the player at spawn — player must work to flank it.
      const a = Math.atan2(player.y - y, player.x - x);
      extra = {
        shieldArc: a,
        shieldHalfWidth: 1.2,           // ≈ 138° coverage
        shieldTrackSpeed: 0.9 + d * 0.4 // rad/s lazy tracking
      };
    } else if (type === 'orbiter') {
      r = rnd(16, 20);
      speed = rnd(90, 140);  // approach speed; halts to a fixed orbit afterward
      extra = {
        orbitState: 'approach',
        orbitR: rnd(260, 380),
        orbitDir: Math.random() < 0.5 ? -1 : 1,
        orbitAng: 0,
        fireTimer: rnd(1.5, 2.5),
        fireInterval: 1.8,            // base; modulated by difficulty later
        barrelAng: 0,
      };
    } else {
      // grunt
      r = rnd(14, 22);
      speed = rnd(40, 90) + Math.min(state.time * 4, 220);
    }

    const ang = Math.atan2(player.y - y, player.x - x) + rnd(-0.5, 0.5);
    enemies.push({
      type, x, y, r,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      speed, ang, hp: 1, age: 0,
      scoreMul: cfg.scoreMul,
      ...extra,
    });
  }

  function spawnSplitterChildren(parent) {
    // Two mini-grunts flying outward; they're regular grunts (no extra credit).
    for (let k = 0; k < 2; k++) {
      if (enemies.length >= MAX_ENEMIES) break;
      const ang = rnd(0, Math.PI * 2);
      const sp  = rnd(120, 180);
      enemies.push({
        type: 'grunt',
        x: parent.x, y: parent.y,
        r: 10,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        speed: sp, ang, hp: 1, age: 0,
        scoreMul: 0.5,        // mini = half credit
        isMini: true,
      });
    }
  }

  function addFloater(x, y, text, color = '#ffeeaa') {
    floaters.push({ x, y, text, color, life: 0.95, maxLife: 0.95, vy: -55 });
  }

  function fireEnemyBullet(e) {
    if (enemyBullets.length >= MAX_ENEMY_BULLETS) return;
    const sp = 240 + difficulty01() * 60;
    const ang = Math.atan2(player.y - e.y, player.x - e.x);
    enemyBullets.push({
      x: e.x + Math.cos(ang) * (e.r + 8),
      y: e.y + Math.sin(ang) * (e.r + 8),
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      r: 5,
      life: 4.5,
    });
    // Tiny muzzle flash from the orbiter's barrel
    for (let k = 0; k < 4; k++) {
      addParticle(e.x + Math.cos(ang) * (e.r + 8), e.y + Math.sin(ang) * (e.r + 8),
                  '#ff7799', rnd(1.5, 2.5), 0.2, 30, 120);
    }
    sfx.enemyShoot();
  }

  function spawnPowerup() {
    if (powerups.length > 0) return; // Only one at a time
    
    const margin = 50;
    const x = rnd(margin, W - margin);
    const y = rnd(margin, H - margin);
    
    const types = ['recharge', 'multiplier'];
    const type = types[rndi(0, types.length - 1)];
    
    powerups.push({
      x, y, r: 16,
      type,
      life: 10, // 10 seconds to collect
      maxLife: 10,
      pulsePhase: 0
    });
  }

  /* ====== Input ====== */
  let mouse = { x: W/2, y: H/2 };
  
  function screenToWorld(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left), y: (e.clientY - rect.top) };
  }

  function fireBullet() {
    if (state.fireRounds <= 0) return;
    const fx = player.x;
    const fy = player.y;

    state.fireRounds--;
    updateFireIndicator();

    const ringLvl  = state.upgrades.ringBurst || 0;
    const velLvl   = state.upgrades.hyperVel  || 0;
    const calLvl   = state.upgrades.heavyCal  || 0;
    const pierce   = state.upgrades.pierce    || 0;
    const bulletCount = 8 + ringLvl * 2;
    const speed       = 600 + velLvl * 200;
    const radius      = 4   + calLvl * 2;

    for (let i = 0; i < bulletCount; i++) {
      const angle = (i / bulletCount) * Math.PI * 2;
      bullets.push({
        x: fx,
        y: fy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: radius,
        life: 2,
        pierce,
      });
    }

    for (let i = 0; i < 18; i++) {
      addParticle(fx, fy, '#ffcc66', rnd(2, 4), rnd(0.2, 0.4), 80, 320);
    }
    addShockwave(fx, fy, '#ffaa00', 38, 0.25, 3);
    addShake(2.5);
    sfx.fire();
  }

  canvas.addEventListener('mousemove', (e) => {
    const p = screenToWorld(e);
    mouse.x = p.x;
    mouse.y = p.y;
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (state.running && !state.paused) {
      initAudio();
      fireBullet();
    }
  });

  canvas.addEventListener('click', (e) => {
    if (!state.running) {
      initAudio();
    }
  });

  /* ====== Touch input ======
   * Two-finger model:
   *   • First finger down  = move finger (player follows it).
   *   • Lift the move finger as a quick stationary tap → fires at release point.
   *   • Any additional finger touchstart → fires at THAT finger's location
   *     (immediate, no release wait), letting you dodge with finger 1 + spam
   *     fire with finger 2.
   * If the move finger lifts but other fingers are still down, one of them
   * is promoted to the new move finger so movement stays continuous.
   */
  const touchState = { moveId: null, startTime: 0, startX: 0, startY: 0, didDrag: false };
  const TAP_MS = 240, TAP_PX = 14;

  function touchToWorld(t) {
    const rect = canvas.getBoundingClientRect();
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    initAudio();
    for (const t of e.changedTouches) {
      const p = touchToWorld(t);
      if (touchState.moveId === null) {
        touchState.moveId    = t.identifier;
        touchState.startTime = performance.now();
        touchState.startX    = p.x;
        touchState.startY    = p.y;
        touchState.didDrag   = false;
        mouse.x = p.x; mouse.y = p.y;
      } else if (t.identifier !== touchState.moveId) {
        // Second-finger tap-fire (burst spawns at the player ball)
        if (state.running && !state.paused) fireBullet();
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === touchState.moveId) {
        const p = touchToWorld(t);
        mouse.x = p.x; mouse.y = p.y;
        if (Math.hypot(p.x - touchState.startX, p.y - touchState.startY) > TAP_PX) {
          touchState.didDrag = true;
        }
      }
    }
  }, { passive: false });

  function endTouch(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === touchState.moveId) {
        // Quick stationary release on the move finger = single-finger tap-fire
        const dur = performance.now() - touchState.startTime;
        if (dur < TAP_MS && !touchState.didDrag && state.running && !state.paused) {
          fireBullet();
        }
        touchState.moveId = null;
      }
    }
    // Promote a remaining finger to move-finger if any still down
    if (touchState.moveId === null && e.touches.length > 0) {
      const t = e.touches[0];
      const p = touchToWorld(t);
      touchState.moveId    = t.identifier;
      touchState.startTime = performance.now();
      touchState.startX    = p.x;
      touchState.startY    = p.y;
      touchState.didDrag   = false;
      mouse.x = p.x; mouse.y = p.y;
    }
  }
  canvas.addEventListener('touchend',    endTouch, { passive: false });
  canvas.addEventListener('touchcancel', endTouch, { passive: false });

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    
    // Don't handle game keys if user is typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    
    if (e.code === 'Space') {
      if (!state.running) {
        e.preventDefault();
        startGame(state.dailyMode);
        return;
      }
    }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault();
      if (state.running) {
        if (!state.paused) pauseGameUI();
        else resumeGameUI();
      }
      return;
    }
  });

  addEventListener('blur', () => {
    if (state.running && !state.paused) pauseGameUI();
  });

  /* ====== Leaderboard ====== */
  const lb = {
    modal: $('#lbModal'),
    close: $('#lbClose'),
    modeSel: $('#lbMode'),
    scopeSel: $('#lbScope'),
    info: $('#lbInfo'),
    table: $('#lbTable').querySelector('tbody'),
    userBest: $('#lbUserBest'),
    userScore: $('#lbUserScore'),
    userRank: $('#lbUserRank')
  };

  function loadLB(key) {
    try {
      return JSON.parse(getLS(key, '[]'));
    } catch {
      return [];
    }
  }

  function saveLB(key, arr) {
    setLS(key, JSON.stringify(arr));
  }

  const SB_URL = 'https://azaqjxovkewurgbecizs.supabase.co/rest/v1/scores';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6YXFqeG92a2V3dXJnYmVjaXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjIxNDMsImV4cCI6MjA5MzczODE0M30.ug99lkj1HoahFtjKSwz2GOBoPFStxf8JEh5FGE7UYr4';
  const SB_HEADERS = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json'
  };

  function showLeaderboard(mode) {
    lb.modal.classList.add('show');
    lb.modeSel.value = mode || (state.dailyMode ? 'daily' : 'normal');
    renderLeaderboard();
    maybeFillModalAd();
  }

  function hideLeaderboard() {
    lb.modal.classList.remove('show');
  }

  function renderLeaderboard() {
    const mode = lb.modeSel.value;
    const scope = lb.scopeSel ? lb.scopeSel.value : 'world';
    // Country scope is meaningless if we never resolved a country code → fall back to worldwide.
    const useCountry = scope === 'country' && userCountry && userCountry !== 'XX';
    const userBestVal = mode === 'daily'
      ? Number(getLS('lr_daily', 0))
      : Number(getLS('lr_best', 0));

    if (userBestVal > 0) {
      lb.userBest.style.display = 'block';
      lb.userScore.textContent = userBestVal.toLocaleString();
      lb.userRank.textContent = '';
    } else {
      lb.userBest.style.display = 'none';
    }

    const params = new URLSearchParams();
    params.append('select', 'name,score,country');
    params.append('order', 'score.desc');
    params.append('limit', '10');
    if (useCountry) params.append('country', `eq.${userCountry}`);

    lb.table.innerHTML = '<tr><td colspan="5" style="opacity:.5; text-align:center; padding:18px;">Loading…</td></tr>';
    if (useCountry)             lb.info.textContent = `Top 10 in ${userCountry}`;
    else if (scope === 'country') lb.info.textContent = 'Worldwide Top 10 (country unknown — showing world)';
    else                         lb.info.textContent = 'Worldwide Top 10';

    fetchWithTimeout(`${SB_URL}?${params.toString()}`, { headers: SB_HEADERS }, 5000)
      .then(res => {
        if (!res.ok) throw new Error('REST ' + res.status);
        return res.json();
      })
      .then(rows => {
        lb.table.innerHTML = '';
        rows.slice(0, 10).forEach((e, i) => {
          const tr = document.createElement('tr');
          const status = getMotivationalStatus(e.score);
          const statusColor = (e.score >= 1000) ? '#88ffcc' : '#ff6b6b';
          const location = e.country && e.country !== 'XX' ? e.country : 'Unknown';
          tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(e.name || 'anon')}</td><td>${e.score}</td><td style="color:${statusColor}; font-weight:bold;">${status}</td><td>${location}</td>`;
          lb.table.appendChild(tr);
        });
        if (rows.length === 0) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="5" style="opacity:.7;">No scores yet. Be the first!</td>';
          lb.table.appendChild(tr);
        }
      })
      .catch((err) => {
        console.error('Leaderboard fetch failed:', err);
        const key = mode === 'daily' ? ('lr_lb_daily_' + todayKey()) : 'lr_lb_normal';
        const arr = loadLB(key);
        lb.info.textContent += ' • offline';
        lb.table.innerHTML = '';
        arr.slice(0, 10).forEach((e, i) => {
          const tr = document.createElement('tr');
          const status = getMotivationalStatus(e.score);
          const statusColor = (e.score >= 1000) ? '#88ffcc' : '#ff6b6b';
          const location = 'Local';
          tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(e.name || 'anon')}</td><td>${e.score}</td><td style="color:${statusColor}; font-weight:bold;">${status}</td><td>${location}</td>`;
          lb.table.appendChild(tr);
        });
        if (arr.length === 0) {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td colspan="5" style="opacity:.7;">${userBestVal > 0 ? 'Top 10 unavailable offline.' : 'No scores yet. Be the first!'}</td>`;
          lb.table.appendChild(tr);
        }
      });

    if (userBestVal > 0) {
      const rankParams = new URLSearchParams();
      rankParams.append('select', 'id');
      rankParams.append('score', `gt.${userBestVal}`);
      if (useCountry) rankParams.append('country', `eq.${userCountry}`);
      fetchWithTimeout(`${SB_URL}?${rankParams.toString()}`, {
        method: 'HEAD',
        headers: { ...SB_HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' }
      }, 5000)
        .then(r => {
          const range = r.headers.get('content-range');
          if (!range) return;
          const total = parseInt(range.split('/')[1], 10);
          if (!isNaN(total)) {
            const suffix = useCountry ? ` in ${userCountry}` : '';
            lb.userRank.textContent = `· Rank #${total + 1}${suffix}`;
          }
        })
        .catch(() => { /* silent */ });
    }
  }
  function getMotivationalStatus(score) {
    if (score >= 1000) {
      // 🏆 Epic high score words
      const epicWords = ['LEGEND!', 'CHAMPION!', 'MASTER!', 'HERO!', 'WARRIOR!', 'ELITE!', 'CRUSHER!', 'BEAST!', 'DOMINATOR!', 'UNSTOPPABLE!'];
      return epicWords[Math.floor(Math.random() * epicWords.length)];
    } else {
      // 📈 Encouraging progression words
      const encouragingWords = ['Trying', 'Learning', 'Rookie', 'Beginner', 'Starter', 'Newbie', 'Amateur', 'Casual', 'Practice', 'Getting There'];
      return encouragingWords[Math.floor(Math.random() * encouragingWords.length)];
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  }

  lb.close.addEventListener('click', hideLeaderboard);
  lb.modeSel.addEventListener('change', renderLeaderboard);
  if (lb.scopeSel) lb.scopeSel.addEventListener('change', renderLeaderboard);
  ui.lbBtn.addEventListener('click', () => showLeaderboard());

  let modalAdFilled = false;
  function maybeFillModalAd() {
    if (modalAdFilled) return;
    const ins = document.getElementById('ad-modal-unit');
    if (!ins) return;
    const w = ins.clientWidth;
    if (w && w > 0) {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      modalAdFilled = true;
    } else {
      setTimeout(maybeFillModalAd, 200);
    }
  }

  /* ====== Share (overlay + quickbar) ====== */
  async function doShare() {
    const url = location.href;
    const text = `I just played Loop Runner and scored ${state.score | 0}!`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Loop Runner', text, url });
      } else {
        await navigator.clipboard.writeText(url);
        alert('Link copied to clipboard!');
      }
    } catch (e) {
      /* user cancelled */
    }
  }

  /* ====== Network helper ======
   * fetch() with a hard timeout via AbortController. Without this, a fetch can hang
   * indefinitely if the host blocks the request silently (no error, just no response) —
   * which makes the game look broken to portal reviewers on QA networks.
   */
  function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
  }

  /* ====== Geolocation via IP ====== */
  let userCountry = 'XX'; // Default fallback

  async function detectUserLocation() {
    try {
      // Try ipapi.co first (free, no key required) — short timeout so a blocked host
      // doesn't leave userCountry stuck on 'XX' for the whole session via a hung fetch.
      const response = await fetchWithTimeout('https://ipapi.co/json/', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }, 3000);

      if (response.ok) {
        const data = await response.json();
        if (data.country_code && data.country_code.length === 2) {
          userCountry = data.country_code.toUpperCase();
          return;
        }
      }
    } catch (e) {
      // Fallback to ipinfo.io
      try {
        const response = await fetchWithTimeout('https://ipinfo.io/json', {}, 3000);
        if (response.ok) {
          const data = await response.json();
          if (data.country && data.country.length === 2) {
            userCountry = data.country.toUpperCase();
            return;
          }
        }
      } catch (e2) {
        // Final fallback - keep default 'XX'
      }
    }
  }
  
  // Detect location on page load
  detectUserLocation();
  /* ====== Game control ====== */
  function startGame(daily = false) {
    state.running = true;
    state.paused = false;
    state.time = 0;
    state.score = 0;
    state.combo = 0;
    state.spawnTimer = 0;
    state.spawnInterval = 1.1;
    state.fireRounds = state.maxFireRounds;
    state.rechargeTimer = 0;
    
    enemies.length = 0;
    bullets.length = 0;
    particles.length = 0;
    shards.length = 0;
    flashes.length = 0;
    powerups.length = 0;
    shockwaves.length = 0;
    floaters.length = 0;
    enemyBullets.length = 0;
    effects.shake = 0;
    effects.flash = 0;
    effects.hitStop = 0;

    // Reset record/popup flags for the new run
    banners.active = null;
    banners.queue.length = 0;
    runFlags.pbAtStart = state.best;
    runFlags.dailyPbAtStart = state.dailyBest;
    runFlags.pbCrossed = false;
    runFlags.scoreMilestones.clear();
    runFlags.rankTiersHit.clear();
    runFlags.comboMilestones.clear();
    runFlags.bossesSpawned.clear();
    runFlags.firstSeen.clear();
    runFlags.firedLame.clear();
    fetchTopScoresForFlags();

    // Reset upgrades for the new run
    state.picksTaken = 0;
    state.upgrades = {};
    state.timeWarpTimer = 0;
    state.magnet = false;
    state.rechargeInterval = 5;
    state.maxFireRounds = 3;
    state.fireRounds = state.maxFireRounds;
    state.themeIdx = 0;
    state.themeTimer = 0;
    state.themeCyclesCompleted = 0;
    state.deathFreezeTimer = 0;

    player.x = W / 2;
    player.y = H / 2;
    player.vx = 0;
    player.vy = 0;
    
    hydrateHUD();
    state.dailyMode = daily;
    usingSeed = false;
    if (daily) setDailySeed();
    hideOverlay();
    document.body.classList.add('playing');
  }

  function gameOver() {
    state.running = false;
    state.paused = false;
    state.deathFreezeTimer = 1.5; // play out the burst, then freeze the canvas
    document.body.classList.remove('playing');
    const score = state.score | 0;
    let isPB = false;
    
    if (state.dailyMode) {
      if (score > state.dailyBest) {
        state.dailyBest = score;
        setLS('lr_daily', state.dailyBest);
        isPB = true;
      }
    } else {
      if (score > state.best) {
        state.best = score;
        setLS('lr_best', state.best);
        isPB = true;
      }
    }
    
    hydrateHUD();
    const flavor = getEndOfRunFlavor(score, state.combo, state.time, isPB);
    setOverlayGameOver(score, state.dailyMode ? state.dailyBest : state.best, isPB, flavor);
    incrementRunsCompleted();
    submitScore();
    showLeaderboard(state.dailyMode ? 'daily' : 'normal');
  }

  function pauseGameUI() {
    if (!state.running || state.paused) return;
    state.paused = true;
    setOverlayPaused();
  }

  function resumeGameUI() {
    if (!state.paused) return;
    state.paused = false;
    hideOverlay();
  }

  async function submitScore() {
    const name = (ui.nameInput.value || getLS('lr_name', 'Player')).trim() || 'Player';
    setLS('lr_name', name);
    
    try {
      const body = {
        name: name.slice(0, 20),
        score: state.score | 0,
        mode: (state.dailyMode ? 'daily' : 'normal'),
        country: userCountry
      };
      
      fetch(SB_URL, {
        method: 'POST',
        headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify(body)
      })
        .then(async r => {
          if (!r.ok) {
            let txt = '';
            try {
              txt = await r.text();
            } catch {}
            console.error('Supabase insert failed', r.status, txt);
          }
        })
        .catch(err => console.error('Supabase insert network error', err));
    } catch (err) {
      console.error('submitScore exception', err);
    }
  }

  /* ====== Between-runs interstitial (AdSense) ======
   * Triggers on Play Again only — never on first Play / Daily Run start.
   * Conditions: ≥2 runs completed, ≥150s since last interstitial, every 3rd run.
   * 5s countdown gates Continue button so the ad has time to fill + view.
   */
  const INTERSTITIAL_MIN_INTERVAL_MS = 150000;
  const INTERSTITIAL_COUNTDOWN_S = 5;
  const interstitialEl = document.getElementById('interstitial');
  const interstitialContinueBtn = document.getElementById('interstitialContinue');

  function incrementRunsCompleted() {
    const n = (Number(getLS('lr_runs_completed', 0)) || 0) + 1;
    setLS('lr_runs_completed', n);
  }

  function shouldShowInterstitial() {
    if (!interstitialEl || !interstitialContinueBtn) return false;
    const runs = Number(getLS('lr_runs_completed', 0)) || 0;
    const lastTs = Number(getLS('lr_last_interstitial', 0)) || 0;
    return runs >= 2 && (Date.now() - lastTs) >= INTERSTITIAL_MIN_INTERVAL_MS && runs % 3 === 0;
  }

  function showInterstitial(onClose) {
    let remaining = INTERSTITIAL_COUNTDOWN_S;
    interstitialContinueBtn.disabled = true;
    interstitialContinueBtn.textContent = `Continue (${remaining})`;
    interstitialEl.classList.add('show');
    interstitialEl.setAttribute('aria-hidden', 'false');
    setLS('lr_last_interstitial', Date.now());

    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}

    const tickId = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        interstitialContinueBtn.textContent = `Continue (${remaining})`;
      } else {
        clearInterval(tickId);
        interstitialContinueBtn.disabled = false;
        interstitialContinueBtn.textContent = 'Continue';
      }
    }, 1000);

    const handleContinue = () => {
      if (interstitialContinueBtn.disabled) return;
      clearInterval(tickId);
      interstitialEl.classList.remove('show');
      interstitialEl.setAttribute('aria-hidden', 'true');
      interstitialContinueBtn.removeEventListener('click', handleContinue);
      onClose();
    };
    interstitialContinueBtn.addEventListener('click', handleContinue);
  }

  ui.start.addEventListener('click', () => {
    initAudio();
    startGame(false);
  });
  ui.dailyBtn.addEventListener('click', () => {
    initAudio();
    startGame(true);
  });
  ui.btnResume.addEventListener('click', resumeGameUI);
  ui.btnPlayAgain.addEventListener('click', () => {
    if (shouldShowInterstitial()) {
      showInterstitial(() => startGame(state.dailyMode));
    } else {
      startGame(state.dailyMode);
    }
  });
  ui.btnShare.addEventListener('click', doShare);
  ui.shareBtn.addEventListener('click', doShare);

  /* ====== Loop ====== */
  let last = performance.now();
  let powerupSpawnTimer = 0;

  function loop() {
    requestAnimationFrame(loop);
    const t = performance.now();
    let dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    // Game-over freeze: let the death VFX finish for ~1.5s, then stop redrawing
    // entirely. The canvas keeps the last frame statically (browsers don't auto-clear),
    // so the GPU goes idle under the leaderboard modal instead of redrawing 60fps.
    if (!state.running) {
      if (state.deathFreezeTimer > 0) {
        state.deathFreezeTimer = Math.max(0, state.deathFreezeTimer - dt);
        // Keep updating particles/shards/flashes/shockwaves so the death burst plays out
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98; p.vy *= 0.98;
          if (p.life <= 0) { particles.splice(i, 1); i--; }
        }
        for (let i = 0; i < shards.length; i++) {
          const s = shards[i];
          s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.96; s.vy *= 0.96; s.rot += s.vrot * dt;
          if (s.life <= 0) { shards.splice(i, 1); i--; }
        }
        for (let i = 0; i < flashes.length; i++) {
          const f = flashes[i];
          f.life -= dt; f.r = f.maxR * (1 - f.life / f.maxLife);
          if (f.life <= 0) { flashes.splice(i, 1); i--; }
        }
        for (let i = 0; i < shockwaves.length; i++) {
          const s = shockwaves[i];
          s.life -= dt; s.r += (s.maxR - s.r) * 6 * dt;
          if (s.life <= 0) { shockwaves.splice(i, 1); i--; }
        }
        if (effects.shake > 0) effects.shake = Math.max(0, effects.shake - effects.shake * 8 * dt - 0.05);
        if (effects.flash > 0) effects.flash = Math.max(0, effects.flash - effects.flash * 6 * dt - 0.01);
        render();
      }
      // After freeze window expires we skip render entirely — the canvas holds its last frame
      // and the leaderboard modal sits cleanly on top with no GPU churn underneath.
      return;
    }
    if (state.paused) {
      render();
      return;
    }

    // Hit-stop: skip simulation, keep rendering for shake/flash decay
    if (effects.hitStop > 0) {
      effects.hitStop -= dt;
      // Decay shake/flash even during hit-stop so they feel snappy
      if (effects.shake > 0) effects.shake = Math.max(0, effects.shake - effects.shake * 8 * dt - 0.05);
      if (effects.flash > 0) effects.flash = Math.max(0, effects.flash - effects.flash * 6 * dt - 0.01);
      render();
      return;
    }

    // Time-warp slow-mo on kill (Time Warp upgrade)
    if (state.timeWarpTimer > 0) {
      state.timeWarpTimer = Math.max(0, state.timeWarpTimer - dt);
      dt *= 0.4;
    }

    state.time += dt;
    state.score += dt * 10;

    // Theme cycle — every THEME_DURATION seconds, advance to the next era
    state.themeTimer += dt;
    if (state.themeTimer >= THEME_DURATION) {
      state.themeTimer -= THEME_DURATION;
      state.themeIdx = (state.themeIdx + 1) % THEMES.length;
      const justWrapped = state.themeIdx === 0;
      if (justWrapped) {
        state.themeCyclesCompleted++;
        pushBanner('YOU\'VE CIRCLED ALL THEMES', 'epic', 3.2);
      }
      pushBanner('NEXT ERA: ' + currentTheme().name, 'great', 2.6);
      addFlash(0.45, '255,255,255');
      addShake(10);
    }

    if (((state.score | 0) % 10) === 0) {
      ui.score.textContent = `Score: ${state.score | 0}`;
    }

    update(dt);
    render();
  }

  function update(dt) {
    // Auto-recharge fire rounds
    if (state.fireRounds < state.maxFireRounds) {
      state.rechargeTimer += dt;
      if (state.rechargeTimer >= state.rechargeInterval) {
        state.fireRounds++;
        state.rechargeTimer = 0;
        updateFireIndicator();
      }
    }

    // Spawn enemies — interval shortens as difficulty rises (1.1s → ~0.42s by t=120)
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnEnemy();
      const d = difficulty01();
      state.spawnInterval = lerp(1.1, 0.42, d);
      // Past 60s, sometimes burst-spawn a second enemy at the same beat
      if (state.time > 60 && Math.random() < 0.15 + d * 0.15) spawnEnemy();
      state.spawnTimer = state.spawnInterval;
    }

    // Spawn power-ups
    powerupSpawnTimer += dt;
    if (powerupSpawnTimer >= 25 && powerups.length === 0) { // Every 25 seconds
      spawnPowerup();
      powerupSpawnTimer = 0;
    }

    // Update player (follows mouse)
    const dx = mouse.x - player.x;
    const dy = mouse.y - player.y;
    const len = Math.hypot(dx, dy);
    
    if (len > 5) {
      const ux = dx / len;
      const uy = dy / len;
      const speed = Math.min(len * 8, player.maxSpeed);
      player.vx = ux * speed;
      player.vy = uy * speed;
    } else {
      player.vx *= 0.9;
      player.vy *= 0.9;
    }

    const f = Math.exp(-player.friction * dt);
    player.vx *= f;
    player.vy *= f;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    
    // Keep player in bounds
    player.x = Math.max(player.r, Math.min(W - player.r, player.x));
    player.y = Math.max(player.r, Math.min(H - player.r, player.y));

    // Update bullets (with trails)
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      // Trail particle
      if (Math.random() < 0.85) {
        particles.push({
          x: b.x, y: b.y,
          vx: -b.vx * 0.05 + rnd(-20, 20),
          vy: -b.vy * 0.05 + rnd(-20, 20),
          life: 0.18, maxLife: 0.18, size: rnd(1.5, 2.8), color: '#ffcc66'
        });
      }

      if (b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H) {
        bullets.splice(i, 1);
        i--;
      }
    }

    // Update shockwaves
    for (let i = 0; i < shockwaves.length; i++) {
      const s = shockwaves[i];
      s.life -= dt;
      const t = 1 - (s.life / s.maxLife);
      s.r = s.maxR * (1 - Math.pow(1 - t, 2));
      if (s.life <= 0) { shockwaves.splice(i, 1); i--; }
    }

    // Tick effect decays
    if (effects.shake > 0) effects.shake = Math.max(0, effects.shake - effects.shake * 8 * dt - 0.05);
    if (effects.flash > 0) effects.flash = Math.max(0, effects.flash - effects.flash * 6 * dt - 0.01);

    // Record/roast triggers + banner pump
    checkRecordTriggers();
    tickBanners(dt);

    // Update enemies
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      e.age += dt;
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);

      // ── Per-type movement ────────────────────────────────────────────────
      if (e.type === 'charger') {
        e.chargeTimer -= dt;
        if (e.chargeState === 'wander') {
          // Slow drift toward player
          const ang = Math.atan2(player.y - e.y, player.x - e.x);
          e.vx = Math.cos(ang) * e.speed;
          e.vy = Math.sin(ang) * e.speed;
          if (e.chargeTimer <= 0) {
            e.chargeState = 'aim';
            e.chargeTimer = 0.7;
            e.aimAng = Math.atan2(player.y - e.y, player.x - e.x);
            e.vx = e.vy = 0;
            sfx.chargerAim();
          }
        } else if (e.chargeState === 'aim') {
          e.vx = e.vy = 0;
          if (e.chargeTimer <= 0) {
            e.chargeState = 'dash';
            e.chargeTimer = 0.45;
            e.vx = Math.cos(e.aimAng) * e.dashSpeed;
            e.vy = Math.sin(e.aimAng) * e.dashSpeed;
            sfx.chargerDash();
            // Dash motion-blur trail seed
            for (let k = 0; k < 6; k++) {
              addParticle(e.x, e.y, '#ff8866', rnd(2, 4), 0.25, 20, 60);
            }
          }
        } else if (e.chargeState === 'dash') {
          // Trail particles while dashing
          if (Math.random() < 0.9) {
            particles.push({
              x: e.x, y: e.y,
              vx: rnd(-30, 30), vy: rnd(-30, 30),
              life: 0.22, maxLife: 0.22,
              size: rnd(2, 4),
              color: '#ff5533'
            });
          }
          if (e.chargeTimer <= 0) {
            e.chargeState = 'cooldown';
            e.chargeTimer = 0.55;
          }
        } else { // cooldown
          e.vx *= Math.pow(0.05, dt);
          e.vy *= Math.pow(0.05, dt);
          if (e.chargeTimer <= 0) {
            e.chargeState = 'wander';
            e.chargeTimer = rnd(1.4, 2.6);
          }
        }
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      } else if (e.type === 'shielder') {
        // Slow homing
        const ang = Math.atan2(player.y - e.y, player.x - e.x);
        e.vx = Math.cos(ang) * e.speed;
        e.vy = Math.sin(ang) * e.speed;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        // Shield lazily tracks toward the player so flanking is rewarded
        const targetAng = Math.atan2(player.y - e.y, player.x - e.x);
        let diff = targetAng - e.shieldArc;
        while (diff >  Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const step = e.shieldTrackSpeed * dt;
        e.shieldArc += Math.max(-step, Math.min(step, diff));
      } else if (e.type === 'orbiter') {
        if (e.orbitState === 'approach') {
          // Move straight toward the player until close enough to lock orbit
          const ang = Math.atan2(player.y - e.y, player.x - e.x);
          e.vx = Math.cos(ang) * e.speed;
          e.vy = Math.sin(ang) * e.speed;
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          if (Math.hypot(e.x - player.x, e.y - player.y) < e.orbitR + 30) {
            e.orbitState = 'orbit';
            e.orbitAng = Math.atan2(e.y - player.y, e.x - player.x);
          }
        } else {
          // Lock to a fixed-radius orbit around the player
          e.orbitAng += e.orbitDir * 0.7 * dt;
          e.x = player.x + Math.cos(e.orbitAng) * e.orbitR;
          e.y = player.y + Math.sin(e.orbitAng) * e.orbitR;
          // Visual heading = orbital tangent
          e.vx = -Math.sin(e.orbitAng) * 100 * e.orbitDir;
          e.vy =  Math.cos(e.orbitAng) * 100 * e.orbitDir;
        }
        // Barrel always tracks the player
        e.barrelAng = Math.atan2(player.y - e.y, player.x - e.x);
        // Fire on a periodic timer (only once orbiting)
        e.fireTimer -= dt;
        if (e.orbitState === 'orbit' && e.fireTimer <= 0) {
          e.fireTimer = rnd(1.4, 2.2) - difficulty01() * 0.4; // faster shots later
          fireEnemyBullet(e);
        }
      } else {
        // grunt, swarmer, splitter — straight homing
        const ang = Math.atan2(player.y - e.y, player.x - e.x);
        e.vx = Math.cos(ang) * e.speed;
        e.vy = Math.sin(ang) * e.speed;
        e.ang = Math.atan2(e.vy, e.vx);
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      }

      // ── Player collision ────────────────────────────────────────────────
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < e.r + player.r) {
        // Death blast
        for (let k = 0; k < 60; k++) {
          addParticle(player.x, player.y, k % 3 === 0 ? '#ffffff' : '#ff5555', rnd(2, 5), rnd(0.5, 1.0), 80, 480);
        }
        addShockwave(player.x, player.y, '#ff4444', 180, 0.7, 5);
        addShockwave(player.x, player.y, '#ffffff', 100, 0.5, 3);
        addShake(22);
        addFlash(0.7, '255,60,60');
        effects.hitStop = Math.max(effects.hitStop, 0.18);
        sfx.death();
        gameOver();
        break;
      }

      // ── Bullet collisions ───────────────────────────────────────────────
      let killed = false;
      for (let j = 0; j < bullets.length; j++) {
        const b = bullets[j];
        const bd = Math.hypot(b.x - e.x, b.y - e.y);
        if (bd >= b.r + e.r) continue;

        // Shielder: bullet from inside the shield arc bounces off harmlessly.
        if (e.type === 'shielder') {
          const angToBullet = Math.atan2(b.y - e.y, b.x - e.x);
          let diff = angToBullet - e.shieldArc;
          while (diff >  Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          if (Math.abs(diff) < e.shieldHalfWidth) {
            // Sparks + ping; bullet is consumed but enemy survives.
            bullets.splice(j, 1); j--;
            for (let k = 0; k < 8; k++) {
              addParticle(b.x, b.y, '#88ddff', rnd(1, 2.5), rnd(0.2, 0.35), 60, 220);
            }
            addShockwave(b.x, b.y, '#88ddff', 16, 0.18, 2);
            sfx.shieldBounce();
            continue;
          }
        }

        // Hit lands. Pierce keeps the bullet alive for additional kills.
        if (b.pierce && b.pierce > 0) {
          b.pierce--;
        } else {
          bullets.splice(j, 1);
          j--;
        }

        // Damage layer: most enemies are 1-HP so this branches the same as before.
        // Bosses spawn with hp > 1 and survive multiple hits with feedback VFX.
        e.hp = (e.hp || 1) - 1;
        if (e.hp > 0) {
          // Non-lethal hit — sparkle, brief tint flash, knockback nudge.
          e.hitFlash = 0.12;
          for (let k = 0; k < 6; k++) {
            addParticle(b.x, b.y, '#ffffff', rnd(1, 2.2), rnd(0.15, 0.30), 80, 220);
          }
          addShockwave(b.x, b.y, '#ffeeaa', 14, 0.16, 2);
          // Tiny knockback in the bullet's travel direction
          const sp = Math.hypot(b.vx, b.vy) || 1;
          e.vx = (e.vx || 0) + (b.vx / sp) * 30;
          e.vy = (e.vy || 0) + (b.vy / sp) * 30;
          addShake(1.5);
          if (sfx.shieldBounce) sfx.shieldBounce(); // reuse the "ping" sound for hits
          continue;
        }

        enemies.splice(i, 1);
        i--;
        killed = true;

        state.combo += 1;

        // Score = base × type-mul × greed × combo-curve, with optional crit doubling
        let mult = e.scoreMul || 1;
        const greedLvl = state.upgrades.scoreBoost || 0;
        if (greedLvl > 0) mult *= (1 + greedLvl * 0.25);
        const critLvl = state.upgrades.critical || 0;
        const isCrit = critLvl > 0 && Math.random() < critLvl * 0.2;
        if (isCrit) mult *= 2;
        const add = Math.floor(10 * mult * Math.pow(1.4, state.combo - 1));
        state.score += add;
        ui.combo.textContent = `Combo: ${state.combo}`;
        ui.score.textContent = `Score: ${state.score | 0}`;
        const floatColor = isCrit
          ? '#ff6688'
          : (mult >= 2 ? '#ffd700' : (mult >= 1.5 ? '#88ffcc' : '#ffeeaa'));
        addFloater(e.x, e.y - e.r - 6, isCrit ? `CRIT +${add}` : `+${add}`, floatColor);

        // Time-warp upgrade: brief slow-mo on every kill
        if (state.upgrades.timeWarp) {
          state.timeWarpTimer = Math.max(state.timeWarpTimer || 0, 0.15);
        }

        // Type-specific death visuals
        let coreColor = '#ff7755';
        if (e.type === 'shielder')      coreColor = '#88ddff';
        else if (e.type === 'splitter') coreColor = '#d28cff';
        else if (e.type === 'charger')  coreColor = '#ff5533';
        else if (e.type === 'swarmer')  coreColor = '#caff8c';
        else                            coreColor = speedToColor(e.speed);

        for (let k = 0; k < 22; k++) {
          addParticle(e.x, e.y, coreColor, rnd(1.5, 4), rnd(0.3, 0.7), 60, 360);
        }
        for (let k = 0; k < 8; k++) {
          addParticle(e.x, e.y, '#ffeeaa', rnd(1, 2.5), rnd(0.2, 0.45), 30, 180);
        }
        addFlashPulse(e.x, e.y, e.r * 2.6, 0.18);
        addShardBurst(e.x, e.y, coreColor, e.type === 'splitter' ? 9 : 7, e.r * 0.42);
        addShockwave(e.x, e.y, coreColor, e.type === 'splitter' ? 70 : 50, 0.35, 3);

        // Splitter spawns mini-grunts on death
        if (e.type === 'splitter') {
          spawnSplitterChildren(e);
          sfx.splitterPop();
        } else {
          sfx.kill(state.combo);
        }

        // Hit-stop + shake scaling
        effects.hitStop = Math.max(effects.hitStop, 0.035);
        addShake(3 + Math.min(state.combo * 0.15, 4));

        // Combo milestone fanfare every 5
        if (state.combo > 0 && state.combo % 5 === 0) {
          addShockwave(player.x, player.y, '#88ffcc', 120, 0.55, 4);
          addShake(7);
          addFlash(0.22, '136,255,204');
          sfx.comboHit(state.combo / 5);
        }
        checkComboMilestone(state.combo);
        break;
      }
      if (killed) continue;

      // Remove enemies that drift far off-screen (chargers can overshoot)
      if (e.x < -200 || e.x > W + 200 || e.y < -200 || e.y > H + 200) {
        enemies.splice(i, 1);
        i--;
      }
    }

    // Update enemy bullets (orbiter projectiles)
    for (let i = 0; i < enemyBullets.length; i++) {
      const eb = enemyBullets[i];
      eb.x += eb.vx * dt;
      eb.y += eb.vy * dt;
      eb.life -= dt;

      // Trail
      if (Math.random() < 0.6) {
        particles.push({
          x: eb.x, y: eb.y,
          vx: rnd(-20, 20), vy: rnd(-20, 20),
          life: 0.18, maxLife: 0.18, size: rnd(1.5, 2.5),
          color: '#ff6688',
        });
      }

      // Hit player → game over
      if (Math.hypot(eb.x - player.x, eb.y - player.y) < eb.r + player.r) {
        enemyBullets.splice(i, 1); i--;
        for (let k = 0; k < 60; k++) {
          addParticle(player.x, player.y, k % 3 === 0 ? '#ffffff' : '#ff5555', rnd(2, 5), rnd(0.5, 1.0), 80, 480);
        }
        addShockwave(player.x, player.y, '#ff4444', 180, 0.7, 5);
        addShockwave(player.x, player.y, '#ffffff', 100, 0.5, 3);
        addShake(22);
        addFlash(0.7, '255,60,60');
        effects.hitStop = Math.max(effects.hitStop, 0.18);
        sfx.death();
        gameOver();
        return; // stop the rest of update — game is over
      }

      // Player can shoot down enemy projectiles for skill points
      let shotDown = false;
      for (let j = 0; j < bullets.length; j++) {
        const pb = bullets[j];
        if (Math.hypot(pb.x - eb.x, pb.y - eb.y) < pb.r + eb.r) {
          bullets.splice(j, 1);
          enemyBullets.splice(i, 1); i--;
          shotDown = true;
          state.score += 5;
          ui.score.textContent = `Score: ${state.score | 0}`;
          addFloater(eb.x, eb.y - 6, '+5', '#ff6688');
          for (let k = 0; k < 8; k++) {
            addParticle(eb.x, eb.y, '#ff6688', rnd(1, 2.5), 0.22, 60, 220);
          }
          addShardBurst(eb.x, eb.y, '#ff6688', 4, 3.5);
          addShockwave(eb.x, eb.y, '#ff6688', 16, 0.18, 2);
          sfx.enemyBulletDestroyed();
          break;
        }
      }
      if (shotDown) continue;

      // Expire / off-screen
      if (eb.life <= 0 || eb.x < -50 || eb.x > W + 50 || eb.y < -50 || eb.y > H + 50) {
        enemyBullets.splice(i, 1); i--;
      }
    }

    // Update score floaters
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      f.life -= dt;
      f.y += f.vy * dt;
      f.vy *= Math.pow(0.4, dt); // ease-out vertical drift
      if (f.life <= 0) { floaters.splice(i, 1); i--; }
    }

    // Update power-ups
    for (let i = 0; i < powerups.length; i++) {
      const p = powerups[i];
      p.life -= dt;
      p.pulsePhase += dt * 4;

      if (p.life <= 0) {
        powerups.splice(i, 1);
        i--;
        continue;
      }

      // Magnet upgrade: drift toward player when nearby
      if (state.magnet) {
        const md = Math.hypot(p.x - player.x, p.y - player.y);
        if (md > 0 && md < 220) {
          const pull = 140 * (1 - md / 220);
          p.x += ((player.x - p.x) / md) * pull * dt;
          p.y += ((player.y - p.y) / md) * pull * dt;
        }
      }

      // Check collision with player
      const d = Math.hypot(p.x - player.x, p.y - player.y);
      if (d < p.r + player.r) {
        // Collected!
        if (p.type === 'recharge') {
          state.fireRounds = state.maxFireRounds;
          state.rechargeTimer = 0;
          updateFireIndicator();

          for (let k = 0; k < 28; k++) {
            addParticle(p.x, p.y, '#88ffcc', rnd(1.5, 4.5), rnd(0.4, 0.9), 60, 320);
          }
          addShockwave(p.x, p.y, '#88ffcc', 100, 0.5, 4);
          addFlash(0.28, '136,255,204');
        } else if (p.type === 'multiplier') {
          state.score *= 3;
          ui.score.textContent = `Score: ${state.score | 0}`;

          for (let k = 0; k < 28; k++) {
            addParticle(p.x, p.y, '#ffd700', rnd(1.5, 4.5), rnd(0.4, 0.9), 60, 320);
          }
          addShockwave(p.x, p.y, '#ffd700', 110, 0.55, 4);
          addFlash(0.32, '255,215,0');
        }
        addShake(6);
        effects.hitStop = Math.max(effects.hitStop, 0.05);
        sfx.powerup(p.type);

        powerups.splice(i, 1);
        i--;
      }
    }

    // Update particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;

      if (p.life <= 0) {
        particles.splice(i, 1);
        i--;
      }
    }

    // Shards — same drag as particles but with rotation
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.96;
      s.vy *= 0.96;
      s.rot += s.vrot * dt;
      if (s.life <= 0) { shards.splice(i, 1); i--; }
    }

    // Flash pulses — expand outward, life ticks down
    for (let i = 0; i < flashes.length; i++) {
      const f = flashes[i];
      f.life -= dt;
      f.r = f.maxR * (1 - f.life / f.maxLife);
      if (f.life <= 0) { flashes.splice(i, 1); i--; }
    }
  }

  /* ====== Visuals ====== */
  function clamp01(t) {
    return Math.max(0, Math.min(1, t));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpColor(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t))
    ];
  }

  const COL_BLUE = [88, 166, 255];
  const COL_YELLOW = [255, 210, 119];
  const COL_RED = [255, 95, 95];

  function speedToColor(speed) {
    const t = clamp01((speed - 40) / 270);
    if (t < 0.5) {
      const u = t / 0.5;
      const c = lerpColor(COL_BLUE, COL_YELLOW, u);
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    } else {
      const u = (t - 0.5) / 0.5;
      const c = lerpColor(COL_YELLOW, COL_RED, u);
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }

  function drawDot(e) {
    const fill = speedToColor(e.speed);
    ctx.save();
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.shadowColor = fill;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();
    ctx.restore();
  }

  /* ====== Shared gameplay tells (used across all themes) ====== */
  function drawChargerAimLine(e) {
    if (e.chargeState !== 'aim' || e.aimAng === undefined) return;
    ctx.save();
    const flicker = 0.45 + 0.35 * Math.abs(Math.sin(e.age * 30));
    ctx.strokeStyle = `rgba(255, 70, 50, ${flicker})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.x + Math.cos(e.aimAng) * 1200, e.y + Math.sin(e.aimAng) * 1200);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  function drawShielderArc(e, r, color = '#7af0ff') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r + 6, e.shieldArc - e.shieldHalfWidth, e.shieldArc + e.shieldHalfWidth);
    ctx.stroke();
    ctx.restore();
  }
  function drawOrbiterBarrel(e, r, color = '#ff6688') {
    const ba = e.barrelAng || 0;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(e.x + Math.cos(ba) * (r * 0.5), e.y + Math.sin(ba) * (r * 0.5));
    ctx.lineTo(e.x + Math.cos(ba) * (r + 9),    e.y + Math.sin(ba) * (r + 9));
    ctx.stroke();
    ctx.restore();
  }

  function drawEnemy(e) {
    const popScale = e.age < 0.18 ? 0.5 + 0.5 * (e.age / 0.18) : 1;
    const r = e.r * popScale;
    const key = currentTheme().key;
    switch (key) {
      case 'jurassic':   drawEnemyJurassic(e, r); break;
      case 'cyberpunk':  drawEnemyCyberpunk(e, r); break;
      case 'deepsea':    drawEnemyDeepSea(e, r); break;
      case 'underworld': drawEnemyUnderworld(e, r); break;
      case 'mythical':   drawEnemyMythical(e, r); break;
      case 'cosmic':     drawEnemyCosmic(e, r); break;
      case 'glitch':     drawEnemyGlitch(e, r); break;
      case 'steampunk':  drawEnemySteampunk(e, r); break;
      default:           drawEnemyJurassic(e, r);
    }
  }

  /* ====== CYBERPUNK theme — abstract sci-fi vector designs ====== */
  function drawEnemyCyberpunk(e, r) {
    if (e.type === 'splitter') {
      // Pulsing alien cell with bright nucleus + 4 division marks
      const pulse = 0.85 + 0.15 * Math.sin(e.age * 6);
      const rr = r * pulse;
      ctx.save();
      ctx.shadowColor = '#e090ff'; ctx.shadowBlur = 22 * pulse;
      ctx.fillStyle = 'rgba(170,80,210,0.45)';
      ctx.beginPath(); ctx.arc(e.x, e.y, rr * 1.18, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#a44ec0'; ctx.strokeStyle = '#e090ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff80ff'; ctx.shadowColor = '#ff80ff'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(e.x, e.y, rr * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + e.age * 0.4;
        ctx.moveTo(e.x + Math.cos(a) * rr * 0.55, e.y + Math.sin(a) * rr * 0.55);
        ctx.lineTo(e.x + Math.cos(a) * rr * 0.88, e.y + Math.sin(a) * rr * 0.88);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (e.type === 'charger') {
      drawChargerAimLine(e);
      let bodyFill = '#2c333d', edge = '#9aa0a6', glow = '#cccccc', glowBlur = 10;
      if (e.chargeState === 'aim')       { bodyFill = '#5c2e22'; edge = '#ff8866'; glow = '#ff8866'; glowBlur = 22; }
      else if (e.chargeState === 'dash') { bodyFill = '#7c1a05'; edge = '#ff3300'; glow = '#ff3300'; glowBlur = 28; }
      const heading = (e.chargeState === 'aim' || e.chargeState === 'dash') ? e.aimAng : Math.atan2(e.vy, e.vx);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = glow; ctx.shadowBlur = glowBlur;
      ctx.fillStyle = bodyFill; ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo( r * 1.45,  0);
      ctx.lineTo( r * 0.20,  r * 0.50);
      ctx.lineTo(-r * 0.70,  r * 0.95);
      ctx.lineTo(-r * 0.40,  r * 0.25);
      ctx.lineTo(-r * 0.75,  0);
      ctx.lineTo(-r * 0.40, -r * 0.25);
      ctx.lineTo(-r * 0.70, -r * 0.95);
      ctx.lineTo( r * 0.20, -r * 0.50);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(r * 0.75, 0, r * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0612';
      ctx.beginPath(); ctx.arc(r * 0.78, 0, r * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }

    if (e.type === 'shielder') {
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(e.age * 0.4);
      ctx.shadowColor = '#9aaab8'; ctx.shadowBlur = 10;
      ctx.fillStyle = '#2a3038'; ctx.strokeStyle = '#7af0ff'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(122,240,255,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#7af0ff'; ctx.shadowColor = '#7af0ff'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawShielderArc(e, r, '#7af0ff');
      return;
    }

    if (e.type === 'swarmer') {
      const flap = Math.sin(e.age * 14);
      const heading = Math.atan2(e.vy || 0.001, e.vx || 0.001);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = '#caff8c'; ctx.shadowBlur = 10;
      const wingY = r * (0.55 + flap * 0.30);
      ctx.fillStyle = 'rgba(180,255,140,0.55)'; ctx.strokeStyle = '#caff8c'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-r * 0.45,  wingY); ctx.lineTo(-r * 0.85,  wingY * 0.45); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-r * 0.45, -wingY); ctx.lineTo(-r * 0.85, -wingY * 0.45); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7fdc55';
      ctx.beginPath(); ctx.moveTo( r * 1.0, 0); ctx.lineTo(0, r * 0.50); ctx.lineTo(-r * 0.55, 0); ctx.lineTo(0, -r * 0.50); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = '#e8ffaa';
      ctx.beginPath(); ctx.arc(r * 0.30, 0, r * 0.20, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }

    if (e.type === 'orbiter') {
      const fireUrgency = e.orbitState === 'orbit' ? Math.max(0, 1 - (e.fireTimer || 0)) : 0;
      const eyePulse = 0.7 + 0.3 * Math.abs(Math.sin(e.age * (4 + fireUrgency * 8)));
      const ba = e.barrelAng || 0;
      ctx.save();
      ctx.shadowColor = '#88a0ff'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#1f2d52'; ctx.strokeStyle = '#88a0ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const lookOff = r * 0.20;
      const irisX = e.x + Math.cos(ba) * lookOff, irisY = e.y + Math.sin(ba) * lookOff;
      ctx.shadowColor = '#ff6688'; ctx.shadowBlur = 10 * eyePulse;
      ctx.fillStyle = '#ff6688';
      ctx.beginPath(); ctx.arc(irisX, irisY, r * 0.55 * eyePulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = '#0a0612';
      ctx.beginPath(); ctx.arc(irisX, irisY, r * 0.25 * eyePulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(irisX - r * 0.08, irisY - r * 0.10, r * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawOrbiterBarrel(e, r, '#ff6688');
      return;
    }

    // Grunt — 8-pointed star, slow spin, speed-tinted
    const fill = speedToColor(e.speed);
    ctx.save();
    ctx.translate(e.x, e.y); ctx.rotate(e.age * 0.8);
    ctx.shadowColor = fill; ctx.shadowBlur = 12;
    ctx.fillStyle = fill; ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath();
    const pts = 8;
    for (let i = 0; i < pts * 2; i++) {
      const a = i * Math.PI / pts;
      const rr = (i % 2 === 0) ? r * 1.15 : r * 0.6;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else         ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawEnemyJurassic(e, r) {
    if (e.type === 'splitter') {
      // Triceratops — front-facing with three horns, frill, four legs
      const pulse = 0.85 + 0.15 * Math.sin(e.age * 6);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#a07040'; ctx.shadowBlur = 12 * pulse;
      // Frill — large fan behind the head
      ctx.fillStyle = '#c08850'; ctx.strokeStyle = '#7a4a20'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.6,  r * 0.0);
      ctx.lineTo(-r * 1.0, -r * 0.85);
      ctx.lineTo( r * 0.4, -r * 1.05);
      ctx.lineTo( r * 0.9, -r * 0.5);
      ctx.lineTo( r * 0.9,  r * 0.5);
      ctx.lineTo( r * 0.4,  r * 1.05);
      ctx.lineTo(-r * 1.0,  r * 0.85);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Frill spikes (small triangle bumps along the edge)
      ctx.fillStyle = '#7a4a20';
      const spikes = [[-1.0, -0.85], [-0.3, -1.10], [0.4, -1.20], [0.8, -0.85], [0.4, 1.20], [-0.3, 1.10], [-1.0, 0.85]];
      for (const [sx, sy] of spikes) {
        ctx.beginPath();
        ctx.arc(r * sx, r * sy, r * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
      // Head body
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#8a5a2a';
      ctx.beginPath();
      ctx.ellipse(r * 0.15, 0, r * 0.7, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Three horns (one nose, two over eyes)
      ctx.fillStyle = '#ddc080'; ctx.strokeStyle = '#7a4a20'; ctx.lineWidth = 1.2;
      // Nose horn
      ctx.beginPath();
      ctx.moveTo(r * 0.65,  0);
      ctx.lineTo(r * 1.1,  -r * 0.10);
      ctx.lineTo(r * 0.65, -r * 0.18);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Upper-left horn
      ctx.beginPath();
      ctx.moveTo(r * 0.30, -r * 0.30);
      ctx.lineTo(r * 0.95, -r * 0.55);
      ctx.lineTo(r * 0.40, -r * 0.45);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Upper-right horn
      ctx.beginPath();
      ctx.moveTo(r * 0.30,  r * 0.30);
      ctx.lineTo(r * 0.95,  r * 0.55);
      ctx.lineTo(r * 0.40,  r * 0.45);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Eyes
      ctx.fillStyle = '#e8f0aa';
      ctx.beginPath(); ctx.arc(r * 0.30, -r * 0.10, r * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.30,  r * 0.10, r * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0408';
      ctx.beginPath(); ctx.arc(r * 0.32, -r * 0.10, r * 0.025, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.32,  r * 0.10, r * 0.025, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }

    if (e.type === 'charger') {
      // Telegraph aim line — keep gameplay tell
      if (e.chargeState === 'aim' && e.aimAng !== undefined) {
        ctx.save();
        const flicker = 0.45 + 0.35 * Math.abs(Math.sin(e.age * 30));
        ctx.strokeStyle = `rgba(255, 70, 50, ${flicker})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(e.aimAng) * 1200, e.y + Math.sin(e.aimAng) * 1200);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // T-Rex! Color states drive scale-skin tone.
      let skin = '#3d4a32', belly = '#9aaf6c', edge = '#7a8a5c', glow = '#9aaa66', glowBlur = 8;
      if (e.chargeState === 'aim')       { skin = '#7a3a22'; belly = '#d28a5a'; edge = '#ff8866'; glow = '#ff8866'; glowBlur = 22; }
      else if (e.chargeState === 'dash') { skin = '#9a1c05'; belly = '#e04a22'; edge = '#ff3300'; glow = '#ff3300'; glowBlur = 28; }

      const heading = (e.chargeState === 'aim' || e.chargeState === 'dash')
        ? e.aimAng
        : Math.atan2(e.vy, e.vx);
      // Subtle gait bob — vertical bounce while running
      const bob = Math.sin(e.age * 8) * r * 0.04;

      ctx.save();
      ctx.translate(e.x, e.y + bob);
      ctx.rotate(heading);
      ctx.shadowColor = glow;
      ctx.shadowBlur = glowBlur;

      // Tail + body + head silhouette in one closed path. +X = forward (snout).
      ctx.fillStyle = skin;
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo( r * 1.55,  r * 0.05);   // snout tip
      ctx.lineTo( r * 1.40, -r * 0.20);   // upper jaw line
      ctx.lineTo( r * 0.95, -r * 0.45);   // forehead
      ctx.lineTo( r * 0.30, -r * 0.65);   // back of skull/neck
      ctx.lineTo(-r * 0.10, -r * 0.55);   // shoulder hump
      ctx.lineTo(-r * 0.55, -r * 0.40);   // back arch
      ctx.lineTo(-r * 1.00, -r * 0.20);   // tail upper curve
      ctx.lineTo(-r * 1.55,  r * 0.05);   // tail tip
      ctx.lineTo(-r * 1.05,  r * 0.20);   // tail underside
      ctx.lineTo(-r * 0.55,  r * 0.30);   // belly rear
      ctx.lineTo( r * 0.20,  r * 0.45);   // belly mid
      ctx.lineTo( r * 0.70,  r * 0.30);   // throat
      ctx.lineTo( r * 1.15,  r * 0.25);   // lower jaw
      ctx.lineTo( r * 1.40,  r * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Belly highlight — lighter underbelly stripe
      ctx.shadowBlur = 0;
      ctx.fillStyle = belly;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(-r * 0.50,  r * 0.30);
      ctx.lineTo( r * 0.20,  r * 0.42);
      ctx.lineTo( r * 0.70,  r * 0.28);
      ctx.lineTo( r * 0.20,  r * 0.20);
      ctx.lineTo(-r * 0.50,  r * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Two legs — running pose, alternating with gait
      const stride = Math.sin(e.age * 8);
      ctx.fillStyle = skin;
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1.2;
      // Rear leg
      ctx.beginPath();
      ctx.moveTo(-r * 0.30,  r * 0.30);
      ctx.lineTo(-r * 0.45,  r * 0.40);
      ctx.lineTo(-r * 0.20 + stride * r * 0.15, r * 0.95);
      ctx.lineTo(-r * 0.05 + stride * r * 0.15, r * 0.95);
      ctx.lineTo(-r * 0.10,  r * 0.40);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // Front leg
      ctx.beginPath();
      ctx.moveTo( r * 0.20,  r * 0.40);
      ctx.lineTo( r * 0.05,  r * 0.50);
      ctx.lineTo( r * 0.20 - stride * r * 0.15, r * 0.95);
      ctx.lineTo( r * 0.40 - stride * r * 0.15, r * 0.95);
      ctx.lineTo( r * 0.40,  r * 0.45);
      ctx.closePath();
      ctx.fill(); ctx.stroke();

      // Tiny arm — the iconic stubby T-rex appendage
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo( r * 0.55,  r * 0.10);
      ctx.lineTo( r * 0.75,  r * 0.22);
      ctx.lineTo( r * 0.78,  r * 0.30);
      ctx.stroke();
      ctx.lineCap = 'butt';

      // Open jaw — dark slit between upper and lower jaws (drawn as a thin filled triangle)
      ctx.fillStyle = '#1a0808';
      ctx.beginPath();
      ctx.moveTo( r * 1.45,  r * 0.00);
      ctx.lineTo( r * 1.10, -r * 0.05);
      ctx.lineTo( r * 1.05,  r * 0.20);
      ctx.lineTo( r * 1.40,  r * 0.18);
      ctx.closePath();
      ctx.fill();

      // Teeth — three little white triangles inside the mouth
      ctx.fillStyle = '#fff8e0';
      const teeth = [[1.40, -0.02], [1.28, 0.03], [1.16, 0.02]];
      for (const [tx, ty] of teeth) {
        ctx.beginPath();
        ctx.moveTo(r * tx,        r * ty);
        ctx.lineTo(r * (tx-0.03), r * (ty + 0.10));
        ctx.lineTo(r * (tx+0.03), r * (ty + 0.10));
        ctx.closePath();
        ctx.fill();
      }
      // Bottom row teeth
      const lowerTeeth = [[1.35, 0.18], [1.22, 0.20], [1.10, 0.20]];
      for (const [tx, ty] of lowerTeeth) {
        ctx.beginPath();
        ctx.moveTo(r * tx,        r * ty);
        ctx.lineTo(r * (tx-0.03), r * (ty - 0.10));
        ctx.lineTo(r * (tx+0.03), r * (ty - 0.10));
        ctx.closePath();
        ctx.fill();
      }

      // Eye — glowing red/orange when angry, otherwise yellow predator slit
      ctx.shadowColor = glow;
      ctx.shadowBlur = e.chargeState === 'aim' || e.chargeState === 'dash' ? 8 : 4;
      ctx.fillStyle = e.chargeState === 'dash' ? '#ffeb88' : (e.chargeState === 'aim' ? '#ffcc66' : '#e8f0aa');
      ctx.beginPath();
      ctx.arc(r * 1.05, -r * 0.30, r * 0.10, 0, Math.PI * 2);
      ctx.fill();
      // Slit pupil — vertical for predator menace
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0a0408';
      ctx.beginPath();
      ctx.ellipse(r * 1.05, -r * 0.30, r * 0.025, r * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      return;
    }

    if (e.type === 'shielder') {
      // Ankylosaurus — armored back with bony spikes, club tail
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.age * 0.2);
      ctx.shadowColor = '#7a8a4a'; ctx.shadowBlur = 8;
      // Body — low oval shell
      ctx.fillStyle = '#5a6a30'; ctx.strokeStyle = '#3a4520'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.05, r * 0.75, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Head bump (front-right)
      ctx.fillStyle = '#7a8a4a';
      ctx.beginPath();
      ctx.ellipse(r * 0.85, r * 0.15, r * 0.30, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Tail club extending back-left
      ctx.beginPath();
      ctx.moveTo(-r * 0.85,  r * 0.05);
      ctx.lineTo(-r * 1.20, -r * 0.05);
      ctx.lineTo(-r * 1.40,  r * 0.10);
      ctx.lineTo(-r * 1.20,  r * 0.25);
      ctx.lineTo(-r * 0.85,  r * 0.20);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Bony armor plates on the back (rows of small triangles)
      ctx.fillStyle = '#a0b070';
      const plates = [[-0.6, -0.55], [-0.2, -0.65], [0.2, -0.55], [0.55, -0.40]];
      for (const [px, py] of plates) {
        ctx.beginPath();
        ctx.moveTo(r * px,        r * py);
        ctx.lineTo(r * (px-0.1),  r * (py + 0.18));
        ctx.lineTo(r * (px+0.1),  r * (py + 0.18));
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      // Eye on the head
      ctx.fillStyle = '#0a0408';
      ctx.beginPath(); ctx.arc(r * 0.95, r * 0.10, r * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Shield arc preserved — gameplay tell. Tinted amber to match dino palette.
      drawShielderArc(e, r, '#ffcc66');
      return;
    }

    if (e.type === 'swarmer') {
      // Pterosaur! Membrane wings flap, long beak, head crest. Oriented to velocity.
      const flap = Math.sin(e.age * 12);
      const heading = Math.atan2(e.vy || 0.001, e.vx || 0.001);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(heading);
      ctx.shadowColor = '#caff8c';
      ctx.shadowBlur = 8;

      // Wings — large membrane panels, top wing draws first then bottom (each with finger bone)
      const wingY = r * (0.85 + flap * 0.45);          // upper wing tip y (negative offset)
      const wingTipX = -r * 0.30 + flap * r * 0.12;    // wing tip pulls back on downstroke

      const drawWing = (sign) => {
        // Membrane fill — slightly translucent
        ctx.fillStyle = 'rgba(180,255,140,0.50)';
        ctx.strokeStyle = '#caff8c';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo( r * 0.10,            sign * r * 0.05);   // shoulder
        ctx.lineTo( wingTipX,            sign * wingY);       // wing tip
        ctx.quadraticCurveTo(             // membrane back-edge curves inward (typical pterosaur)
          -r * 0.55,                     sign * wingY * 0.65,
          -r * 0.50,                     sign * r * 0.20
        );
        ctx.lineTo(-r * 0.10,            sign * r * 0.10);   // wing root rear
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Finger bone — characteristic pterosaur wing-finger spar
        ctx.strokeStyle = '#9ade5e';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(r * 0.10, sign * r * 0.05);
        ctx.lineTo(wingTipX, sign * wingY);
        ctx.stroke();
      };
      drawWing(-1);  // upper wing
      drawWing( 1);  // lower wing

      // Body — slim elongated capsule
      ctx.fillStyle = '#7fdc55';
      ctx.strokeStyle = '#caff8c';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo( r * 0.55,  0);
      ctx.lineTo( r * 0.30,  r * 0.18);
      ctx.lineTo(-r * 0.30,  r * 0.15);
      ctx.lineTo(-r * 0.55,  0);
      ctx.lineTo(-r * 0.30, -r * 0.15);
      ctx.lineTo( r * 0.30, -r * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Long beak — narrow forward triangle
      ctx.fillStyle = '#a8e87a';
      ctx.beginPath();
      ctx.moveTo( r * 1.15,  0);             // beak tip
      ctx.lineTo( r * 0.55,  r * 0.08);
      ctx.lineTo( r * 0.55, -r * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Head crest — backward-pointing triangle on top of the head (signature pteranodon look)
      ctx.fillStyle = '#9ade5e';
      ctx.beginPath();
      ctx.moveTo( r * 0.45, -r * 0.18);
      ctx.lineTo(-r * 0.10, -r * 0.45);
      ctx.lineTo( r * 0.10, -r * 0.20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Eye — small dark dot near the beak base
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0a1404';
      ctx.beginPath();
      ctx.arc(r * 0.40, -r * 0.05, r * 0.06, 0, Math.PI * 2);
      ctx.fill();
      // Eye highlight
      ctx.fillStyle = '#e8ffaa';
      ctx.beginPath();
      ctx.arc(r * 0.42, -r * 0.07, r * 0.025, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      return;
    }

    if (e.type === 'orbiter') {
      // Dilophosaurus — bipedal predator with neck frill (the "spitter")
      const ba = e.barrelAng || 0;
      const fireUrgency = e.orbitState === 'orbit' ? Math.max(0, 1 - (e.fireTimer || 0)) : 0;
      const frillPulse = 0.8 + 0.2 * Math.abs(Math.sin(e.age * (3 + fireUrgency * 5)));
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(ba); // body faces where it spits
      ctx.shadowColor = '#a06030'; ctx.shadowBlur = 10;
      // Body
      ctx.fillStyle = '#7a4520'; ctx.strokeStyle = '#3e2210'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.85, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Neck/head extends toward barrel direction (forward in local frame)
      ctx.beginPath();
      ctx.moveTo( r * 0.4, -r * 0.2);
      ctx.lineTo( r * 1.0, -r * 0.10);
      ctx.lineTo( r * 1.05, r * 0.10);
      ctx.lineTo( r * 0.4,  r * 0.2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Frill around the neck — characteristic of dilophosaurus, expands when about to spit
      ctx.fillStyle = 'rgba(220,90,40,0.65)'; ctx.strokeStyle = '#ff8855'; ctx.lineWidth = 1.2;
      const frillR = r * 0.55 * frillPulse;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const a = -Math.PI * 0.6 + t * Math.PI * 1.2;
        const rad = frillR * (0.7 + 0.3 * Math.sin(t * Math.PI));
        const px = r * 0.55 + Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineTo(r * 0.55, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Eye
      ctx.fillStyle = '#ffcc66';
      ctx.beginPath(); ctx.arc(r * 0.85, -r * 0.05, r * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0408';
      ctx.beginPath(); ctx.ellipse(r * 0.87, -r * 0.05, r * 0.02, r * 0.05, 0, 0, Math.PI * 2); ctx.fill();
      // Tiny teeth at jaw line
      ctx.fillStyle = '#fff8e0';
      ctx.beginPath(); ctx.moveTo(r * 1.05, -r * 0.02); ctx.lineTo(r * 1.0, r * 0.04); ctx.lineTo(r * 0.95, -r * 0.02); ctx.closePath(); ctx.fill();
      ctx.restore();
      drawOrbiterBarrel(e, r, '#ff8855');
      return;
    }

    // Grunt — Velociraptor (running side-view, bipedal predator with sickle claw)
    const heading = Math.atan2(e.vy || 0.001, e.vx || 0.001);
    const stride = Math.sin(e.age * 12);
    const fill = speedToColor(e.speed);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(heading);
    ctx.shadowColor = fill; ctx.shadowBlur = 10;
    // Body — slim arched back
    ctx.fillStyle = '#604528'; ctx.strokeStyle = '#3a2510'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo( r * 0.40, -r * 0.40);
    ctx.lineTo(-r * 0.30, -r * 0.55);
    ctx.lineTo(-r * 0.95, -r * 0.20);
    ctx.lineTo(-r * 1.30,  r * 0.05);  // tail tip
    ctx.lineTo(-r * 0.85,  r * 0.20);
    ctx.lineTo(-r * 0.20,  r * 0.30);
    ctx.lineTo( r * 0.50,  r * 0.20);
    ctx.lineTo( r * 0.85,  r * 0.0);
    ctx.lineTo( r * 1.10, -r * 0.10);  // snout
    ctx.lineTo( r * 0.95, -r * 0.30);
    ctx.lineTo( r * 0.50, -r * 0.40);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Underbelly highlight
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(180,140,90,0.6)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.05, r * 0.18, r * 0.55, r * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
    // Two legs with running stride
    ctx.fillStyle = '#604528'; ctx.strokeStyle = '#3a2510'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo( r * 0.10, r * 0.25);
    ctx.lineTo( r * 0.0 + stride * r * 0.18, r * 0.85);
    ctx.lineTo( r * 0.20 + stride * r * 0.18, r * 0.85);
    ctx.lineTo( r * 0.30, r * 0.30);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Sickle claw — iconic raptor weapon
    ctx.fillStyle = '#fff8e0';
    ctx.beginPath();
    ctx.moveTo( r * 0.10 + stride * r * 0.18, r * 0.85);
    ctx.lineTo( r * 0.20 + stride * r * 0.18, r * 0.95);
    ctx.lineTo(-r * 0.05 + stride * r * 0.18, r * 0.85);
    ctx.closePath(); ctx.fill();
    // Eye
    ctx.fillStyle = '#ffcc44';
    ctx.beginPath(); ctx.arc(r * 0.85, -r * 0.20, r * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0a0408';
    ctx.beginPath(); ctx.ellipse(r * 0.87, -r * 0.20, r * 0.018, r * 0.04, 0, 0, Math.PI * 2); ctx.fill();
    // Teeth at jaw
    ctx.fillStyle = '#fff8e0';
    ctx.beginPath(); ctx.moveTo(r * 1.05, -r * 0.05); ctx.lineTo(r * 1.0, r * 0.0); ctx.lineTo(r * 0.92, -r * 0.05); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ====== DEEP SEA theme ====== */
  function drawEnemyDeepSea(e, r) {
    if (e.type === 'splitter') {
      // Pufferfish — round body covered in spikes
      const pulse = 0.85 + 0.15 * Math.sin(e.age * 4);
      const rr = r * pulse;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#ffcc55'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#dda033'; ctx.strokeStyle = '#7a5010'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Spikes radiating outward
      ctx.shadowBlur = 0; ctx.fillStyle = '#7a5010';
      const spikeCount = 12;
      for (let i = 0; i < spikeCount; i++) {
        const a = (i / spikeCount) * Math.PI * 2 + e.age * 0.5;
        const inR = rr * 0.95, outR = rr * 1.30 * pulse;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.06) * inR, Math.sin(a - 0.06) * inR);
        ctx.lineTo(Math.cos(a) * outR, Math.sin(a) * outR);
        ctx.lineTo(Math.cos(a + 0.06) * inR, Math.sin(a + 0.06) * inR);
        ctx.closePath(); ctx.fill();
      }
      // Big puffer eyes
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-rr * 0.30, -rr * 0.15, rr * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( rr * 0.30, -rr * 0.15, rr * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0408';
      ctx.beginPath(); ctx.arc(-rr * 0.28, -rr * 0.14, rr * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( rr * 0.32, -rr * 0.14, rr * 0.08, 0, Math.PI * 2); ctx.fill();
      // Tiny pursed mouth
      ctx.strokeStyle = '#7a5010'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, rr * 0.20, rr * 0.10, 0, Math.PI); ctx.stroke();
      ctx.restore();
      return;
    }
    if (e.type === 'charger') {
      drawChargerAimLine(e);
      let body = '#3060a0', belly = '#88c8e0', edge = '#88aacc', glow = '#88aacc', glowBlur = 8;
      if (e.chargeState === 'aim')       { body = '#7a3a22'; edge = '#ff8866'; glow = '#ff8866'; glowBlur = 22; }
      else if (e.chargeState === 'dash') { body = '#9a1c05'; edge = '#ff3300'; glow = '#ff3300'; glowBlur = 28; }
      const heading = (e.chargeState === 'aim' || e.chargeState === 'dash') ? e.aimAng : Math.atan2(e.vy, e.vx);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = glow; ctx.shadowBlur = glowBlur;
      // Shark body — long teardrop
      ctx.fillStyle = body; ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo( r * 1.45,  0);
      ctx.quadraticCurveTo( r * 0.5, -r * 0.45,  -r * 0.4, -r * 0.30);
      ctx.lineTo(-r * 1.05,  0);
      ctx.quadraticCurveTo(-r * 0.4,  r * 0.30,   r * 0.5,  r * 0.45);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Belly stripe (lighter)
      ctx.fillStyle = belly; ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.ellipse(0, r * 0.18, r * 0.85, r * 0.18, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.globalAlpha = 1;
      // Dorsal fin (top)
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-r * 0.10, -r * 0.30);
      ctx.lineTo( r * 0.20, -r * 0.75);
      ctx.lineTo( r * 0.30, -r * 0.30);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Tail fin (back)
      ctx.beginPath();
      ctx.moveTo(-r * 1.05,  0);
      ctx.lineTo(-r * 1.40, -r * 0.40);
      ctx.lineTo(-r * 1.20,  0);
      ctx.lineTo(-r * 1.40,  r * 0.40);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Pectoral fin (bottom)
      ctx.beginPath();
      ctx.moveTo( r * 0.10,  r * 0.30);
      ctx.lineTo( r * 0.40,  r * 0.65);
      ctx.lineTo( r * 0.45,  r * 0.30);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Eye
      ctx.shadowBlur = 0; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(r * 1.0, -r * 0.10, r * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0408';
      ctx.beginPath(); ctx.arc(r * 1.02, -r * 0.10, r * 0.035, 0, Math.PI * 2); ctx.fill();
      // Toothy grin
      ctx.fillStyle = '#fff8e0';
      const teeth = [[1.30, 0.06], [1.20, 0.10], [1.10, 0.12]];
      for (const [tx, ty] of teeth) {
        ctx.beginPath();
        ctx.moveTo(r * tx, r * ty);
        ctx.lineTo(r * (tx-0.04), r * (ty + 0.10));
        ctx.lineTo(r * (tx+0.04), r * (ty + 0.10));
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      return;
    }
    if (e.type === 'shielder') {
      // Hermit crab — round shell with claws and eyestalks poking out
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#cc7733'; ctx.shadowBlur = 8;
      // Shell — spiral pattern (concentric arcs)
      ctx.fillStyle = '#a86040'; ctx.strokeStyle = '#5a2a18'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7a3a20'; ctx.lineWidth = 1.2;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(-r * 0.05, -r * 0.05, r * (0.85 - i * 0.20), -Math.PI * 0.3, Math.PI * 1.4);
        ctx.stroke();
      }
      // Claws (front-left and front-right)
      ctx.fillStyle = '#cc7755'; ctx.strokeStyle = '#5a2a18'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo( r * 0.55,  r * 0.85);
      ctx.lineTo( r * 0.95,  r * 1.10);
      ctx.lineTo( r * 1.10,  r * 0.95);
      ctx.lineTo( r * 0.95,  r * 0.85);
      ctx.lineTo( r * 0.85,  r * 0.95);
      ctx.lineTo( r * 0.70,  r * 0.75);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.55,  r * 0.85);
      ctx.lineTo(-r * 0.95,  r * 1.10);
      ctx.lineTo(-r * 1.10,  r * 0.95);
      ctx.lineTo(-r * 0.95,  r * 0.85);
      ctx.lineTo(-r * 0.85,  r * 0.95);
      ctx.lineTo(-r * 0.70,  r * 0.75);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Eyestalks
      ctx.strokeStyle = '#5a2a18'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-r * 0.20,  r * 0.5); ctx.lineTo(-r * 0.30,  r * 1.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo( r * 0.20,  r * 0.5); ctx.lineTo( r * 0.30,  r * 1.05); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-r * 0.30, r * 1.10, r * 0.10, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( r * 0.30, r * 1.10, r * 0.10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0408';
      ctx.beginPath(); ctx.arc(-r * 0.30, r * 1.10, r * 0.04, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( r * 0.30, r * 1.10, r * 0.04, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawShielderArc(e, r, '#88e0ff');
      return;
    }
    if (e.type === 'swarmer') {
      // Piranha — small toothy fish
      const flap = Math.sin(e.age * 18);
      const heading = Math.atan2(e.vy || 0.001, e.vx || 0.001);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = '#88c8e0'; ctx.shadowBlur = 8;
      // Body — fish silhouette
      ctx.fillStyle = '#3a6a90'; ctx.strokeStyle = '#1a3050'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo( r * 1.0,  0);
      ctx.quadraticCurveTo( r * 0.3, -r * 0.5, -r * 0.3, -r * 0.40);
      ctx.lineTo(-r * 0.6, -r * 0.20);
      ctx.lineTo(-r * 0.95 + flap * r * 0.15, -r * 0.55);
      ctx.lineTo(-r * 0.85 + flap * r * 0.15,  0);
      ctx.lineTo(-r * 0.95 + flap * r * 0.15,  r * 0.55);
      ctx.lineTo(-r * 0.6,  r * 0.20);
      ctx.lineTo(-r * 0.3,  r * 0.40);
      ctx.quadraticCurveTo( r * 0.3,  r * 0.5,  r * 1.0,  0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Belly orange (piranha telltale)
      ctx.fillStyle = '#ff7a30'; ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.ellipse(r * 0.10, r * 0.25, r * 0.55, r * 0.10, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.globalAlpha = 1;
      // Eye
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(r * 0.65, -r * 0.10, r * 0.10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0408';
      ctx.beginPath(); ctx.arc(r * 0.68, -r * 0.10, r * 0.04, 0, Math.PI * 2); ctx.fill();
      // Toothy underbite
      ctx.fillStyle = '#fff8e0';
      ctx.beginPath(); ctx.moveTo(r * 0.95, r * 0.05); ctx.lineTo(r * 0.85, r * 0.18); ctx.lineTo(r * 0.75, r * 0.05); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r * 0.85, r * 0.05); ctx.lineTo(r * 0.75, r * 0.18); ctx.lineTo(r * 0.65, r * 0.05); ctx.closePath(); ctx.fill();
      ctx.restore();
      return;
    }
    if (e.type === 'orbiter') {
      // Anglerfish — round body with dangling lure
      const fireUrgency = e.orbitState === 'orbit' ? Math.max(0, 1 - (e.fireTimer || 0)) : 0;
      const lureGlow = 0.7 + 0.3 * Math.abs(Math.sin(e.age * (4 + fireUrgency * 8)));
      const ba = e.barrelAng || 0;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#1a3a5a'; ctx.shadowBlur = 12;
      // Body
      ctx.fillStyle = '#1f3050'; ctx.strokeStyle = '#0a1830'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Big jaw underbite — bottom half darker
      ctx.fillStyle = '#0a1830';
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, 0);
      ctx.quadraticCurveTo(0, r * 0.7, r * 0.85, r * 0.05);
      ctx.lineTo(r * 0.85, r * 0.20);
      ctx.quadraticCurveTo(0, r * 0.85, -r * 0.85, r * 0.20);
      ctx.closePath(); ctx.fill();
      // Sharp teeth (jagged white triangles)
      ctx.fillStyle = '#fff8e0';
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.18, r * 0.0);
        ctx.lineTo(i * r * 0.18 + r * 0.04, r * 0.18);
        ctx.lineTo(i * r * 0.18 - r * 0.04, r * 0.18);
        ctx.closePath(); ctx.fill();
      }
      // Lure stem (curving up + forward)
      ctx.strokeStyle = '#88c8e0'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      const lureX = Math.cos(ba) * r * 0.8;
      const lureY = -r * 1.2 + Math.sin(e.age * 2) * r * 0.05;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.7);
      ctx.quadraticCurveTo(lureX * 0.4, -r * 1.0, lureX, lureY);
      ctx.stroke();
      ctx.lineCap = 'butt';
      // Glowing lure orb
      ctx.shadowColor = '#fff8aa'; ctx.shadowBlur = 14 * lureGlow;
      ctx.fillStyle = '#fff8aa';
      ctx.beginPath(); ctx.arc(lureX, lureY, r * 0.16 * lureGlow, 0, Math.PI * 2); ctx.fill();
      // Eye
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(r * 0.30, -r * 0.20, r * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0408';
      ctx.beginPath(); ctx.arc(r * 0.32, -r * 0.20, r * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawOrbiterBarrel(e, r, '#fff8aa');
      return;
    }
    // Grunt — Jellyfish (dome + dangling tentacles)
    const fill = speedToColor(e.speed);
    ctx.save();
    ctx.translate(e.x, e.y);
    const sway = Math.sin(e.age * 3) * 0.15;
    ctx.shadowColor = fill; ctx.shadowBlur = 14;
    // Dome (bell)
    ctx.fillStyle = fill; ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, Math.PI * 2);
    ctx.lineTo( r,  r * 0.10);
    ctx.lineTo(-r,  r * 0.10);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, Math.PI * 2); ctx.stroke();
    // Inner dome ring (highlight)
    ctx.beginPath(); ctx.arc(0, 0, r * 0.65, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    // Tentacles (5 wavy lines)
    ctx.shadowBlur = 0; ctx.strokeStyle = fill; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const t = (i - 2) * 0.18;
      const baseX = t * r;
      ctx.beginPath();
      ctx.moveTo(baseX, r * 0.08);
      ctx.quadraticCurveTo(baseX + sway * r, r * 0.55, baseX + sway * r * 1.5 + i * 0.5, r * 1.10);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  /* ====== UNDERWORLD theme ====== */
  function drawEnemyUnderworld(e, r) {
    if (e.type === 'splitter') {
      // Witch's cauldron — pot with bubbling top, splits into ghosts
      const bubble = Math.sin(e.age * 6);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#aa30ff'; ctx.shadowBlur = 14;
      // Cauldron body
      ctx.fillStyle = '#1a1015'; ctx.strokeStyle = '#5a3055'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.85,  r * 0.0);
      ctx.quadraticCurveTo(-r * 0.95, r * 0.7, -r * 0.4,  r * 0.85);
      ctx.lineTo( r * 0.4,  r * 0.85);
      ctx.quadraticCurveTo( r * 0.95, r * 0.7,  r * 0.85,  r * 0.0);
      ctx.lineTo( r * 1.0, -r * 0.10);
      ctx.lineTo(-r * 1.0, -r * 0.10);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Bubbling green liquid surface
      ctx.fillStyle = '#5acc4a'; ctx.shadowColor = '#5acc4a'; ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.05, r * 0.95, r * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      // Bubbles rising (small green orbs above the surface)
      ctx.shadowBlur = 6;
      const bubbles = [[-0.4, -0.30, 0.10], [0.0, -0.45, 0.13], [0.3, -0.30, 0.09], [-0.15, -0.55, 0.07]];
      for (const [bx, by, br] of bubbles) {
        ctx.beginPath();
        ctx.arc(r * bx, r * (by + 0.05 * bubble), r * br, 0, Math.PI * 2);
        ctx.fill();
      }
      // Three legs / supports (front)
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0a0408'; ctx.strokeStyle = '#5a3055';
      ctx.beginPath(); ctx.rect(-r * 0.55, r * 0.80, r * 0.20, r * 0.20); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect(-r * 0.10, r * 0.80, r * 0.20, r * 0.20); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect( r * 0.35, r * 0.80, r * 0.20, r * 0.20); ctx.fill(); ctx.stroke();
      ctx.restore();
      return;
    }
    if (e.type === 'charger') {
      drawChargerAimLine(e);
      let body = '#3a0a14', edge = '#aa3344', glow = '#aa3344', glowBlur = 10;
      if (e.chargeState === 'aim')       { body = '#7a1a05'; edge = '#ff8866'; glow = '#ff8866'; glowBlur = 22; }
      else if (e.chargeState === 'dash') { body = '#bb1500'; edge = '#ff3300'; glow = '#ff3300'; glowBlur = 28; }
      const heading = (e.chargeState === 'aim' || e.chargeState === 'dash') ? e.aimAng : Math.atan2(e.vy, e.vx);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = glow; ctx.shadowBlur = glowBlur;
      // Demon body — beefy hunched silhouette
      ctx.fillStyle = body; ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo( r * 1.20, -r * 0.10);
      ctx.lineTo( r * 0.95, -r * 0.55);  // shoulder
      ctx.lineTo( r * 0.20, -r * 0.65);  // back
      ctx.lineTo(-r * 0.40, -r * 0.40);
      ctx.lineTo(-r * 0.85, -r * 0.10);  // tail back
      ctx.lineTo(-r * 1.20,  r * 0.10);  // tail tip
      ctx.lineTo(-r * 0.85,  r * 0.30);
      ctx.lineTo(-r * 0.30,  r * 0.55);
      ctx.lineTo( r * 0.40,  r * 0.55);
      ctx.lineTo( r * 1.10,  r * 0.30);
      ctx.lineTo( r * 1.30,  r * 0.10);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Two horns
      ctx.fillStyle = '#ddc080'; ctx.strokeStyle = '#5a3010'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo( r * 1.05, -r * 0.55); ctx.lineTo( r * 1.40, -r * 0.95); ctx.lineTo( r * 1.15, -r * 0.45);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo( r * 0.75, -r * 0.65); ctx.lineTo( r * 0.95, -r * 1.10); ctx.lineTo( r * 0.85, -r * 0.55);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Glowing eyes (red)
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff2200';
      ctx.beginPath(); ctx.arc(r * 1.05, -r * 0.30, r * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.85, -r * 0.30, r * 0.08, 0, Math.PI * 2); ctx.fill();
      // Fanged mouth
      ctx.fillStyle = '#0a0408';
      ctx.beginPath();
      ctx.moveTo(r * 1.20, -r * 0.05); ctx.lineTo(r * 0.95, r * 0.10); ctx.lineTo(r * 1.20, r * 0.20);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 3; i++) {
        const tx = 1.20 - i * 0.08;
        ctx.beginPath();
        ctx.moveTo(r * tx, r * 0.0);
        ctx.lineTo(r * (tx - 0.02), r * 0.10);
        ctx.lineTo(r * (tx + 0.02), r * 0.10);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      return;
    }
    if (e.type === 'shielder') {
      // Tombstone — stone slab with rune cross
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#888888'; ctx.shadowBlur = 6;
      // Slab body — round-top rectangle
      ctx.fillStyle = '#3a3a40'; ctx.strokeStyle = '#1a1a20'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.75,  r * 1.0);
      ctx.lineTo(-r * 0.75, -r * 0.30);
      ctx.quadraticCurveTo(-r * 0.75, -r * 1.0, 0, -r * 1.0);
      ctx.quadraticCurveTo( r * 0.75, -r * 1.0, r * 0.75, -r * 0.30);
      ctx.lineTo( r * 0.75,  r * 1.0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Engraved cross
      ctx.strokeStyle = '#666'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.7); ctx.lineTo(0, r * 0.40);
      ctx.moveTo(-r * 0.30, -r * 0.20); ctx.lineTo(r * 0.30, -r * 0.20);
      ctx.stroke();
      // RIP text suggestion (small dashes)
      ctx.strokeStyle = '#444'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.30, r * 0.65); ctx.lineTo(r * 0.30, r * 0.65);
      ctx.stroke();
      ctx.restore();
      drawShielderArc(e, r, '#bb88ff');
      return;
    }
    if (e.type === 'swarmer') {
      // Bat — simpler 4-vertex wings, single shadow pass (spawns in waves so per-bat cost matters)
      const flap = Math.sin(e.age * 18);
      const heading = Math.atan2(e.vy || 0.001, e.vx || 0.001);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = '#aa3366'; ctx.shadowBlur = 5;
      ctx.fillStyle = '#2a0a1a'; ctx.strokeStyle = '#aa3366'; ctx.lineWidth = 1.2;
      const wingY = r * (0.55 + flap * 0.40);
      // Top wing
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-r * 0.30,  wingY);
      ctx.lineTo(-r * 0.85,  wingY * 0.30);
      ctx.lineTo(-r * 0.30,  r * 0.05);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Bottom wing
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-r * 0.30, -wingY);
      ctx.lineTo(-r * 0.85, -wingY * 0.30);
      ctx.lineTo(-r * 0.30, -r * 0.05);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Body
      ctx.fillStyle = '#3a0a14';
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.45, r * 0.30, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Two ears in one path (less state churn)
      ctx.beginPath();
      ctx.moveTo( r * 0.35, -r * 0.20); ctx.lineTo( r * 0.30, -r * 0.50); ctx.lineTo( r * 0.20, -r * 0.20);
      ctx.moveTo( r * 0.35,  r * 0.20); ctx.lineTo( r * 0.30,  r * 0.50); ctx.lineTo( r * 0.20,  r * 0.20);
      ctx.fill(); ctx.stroke();
      // Eyes — solid red dots, no extra shadow pass
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff4422';
      ctx.beginPath();
      ctx.arc(r * 0.30, -r * 0.10, r * 0.05, 0, Math.PI * 2);
      ctx.arc(r * 0.30,  r * 0.10, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    if (e.type === 'orbiter') {
      // Ghost — translucent floating spirit with sad face
      const fireUrgency = e.orbitState === 'orbit' ? Math.max(0, 1 - (e.fireTimer || 0)) : 0;
      const wobble = Math.sin(e.age * 2.5) * 0.08;
      const ba = e.barrelAng || 0;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#ddccff'; ctx.shadowBlur = 14;
      // Body — top dome, wavy bottom (translucent ghost outline)
      ctx.fillStyle = 'rgba(220,200,255,0.55)'; ctx.strokeStyle = '#ddccff'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, -r * 0.10, r, Math.PI, 0);
      ctx.lineTo( r,  r * 0.50);
      // wavy bottom edge
      ctx.lineTo( r * 0.55,  r * 0.85);
      ctx.lineTo( r * 0.20,  r * 0.60);
      ctx.lineTo(-r * 0.20,  r * 0.85);
      ctx.lineTo(-r * 0.55,  r * 0.60);
      ctx.lineTo(-r,        r * 0.85);
      ctx.lineTo(-r,        r * 0.50);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Hollow eyes — looking toward barrel
      const lookX = Math.cos(ba) * r * 0.10;
      const lookY = Math.sin(ba) * r * 0.10;
      ctx.fillStyle = '#0a0612';
      ctx.beginPath(); ctx.arc(-r * 0.30 + lookX, -r * 0.20 + lookY, r * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( r * 0.30 + lookX, -r * 0.20 + lookY, r * 0.15, 0, Math.PI * 2); ctx.fill();
      // Tiny mouth
      ctx.strokeStyle = '#0a0612'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, r * 0.10 + wobble * r, r * 0.10, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
      ctx.restore();
      drawOrbiterBarrel(e, r, '#ddccff');
      return;
    }
    // Grunt — Skull. One shadow pass total. Most-spawned enemy, every cycle counts.
    const fill = speedToColor(e.speed);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.age * 0.5);
    ctx.shadowColor = fill; ctx.shadowBlur = 6;
    // Cranium
    ctx.fillStyle = '#e8e0d4'; ctx.strokeStyle = '#3a3028'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, -r * 0.10, r * 0.95, Math.PI, 0);
    ctx.lineTo( r * 0.65, r * 0.50);
    ctx.lineTo( r * 0.40, r * 0.55);
    ctx.lineTo( r * 0.25, r * 0.85);
    ctx.lineTo(-r * 0.25, r * 0.85);
    ctx.lineTo(-r * 0.40, r * 0.55);
    ctx.lineTo(-r * 0.65, r * 0.50);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Drop shadow blur for the rest — cheap interior details
    ctx.shadowBlur = 0;
    // Eye sockets (no glow pass — just dark holes with bright pupil)
    ctx.fillStyle = '#1a1410';
    ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.15, r * 0.20, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( r * 0.35, -r * 0.15, r * 0.20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.15, r * 0.10, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( r * 0.35, -r * 0.15, r * 0.10, 0, Math.PI * 2); ctx.fill();
    // Nose triangle
    ctx.fillStyle = '#3a3028';
    ctx.beginPath();
    ctx.moveTo(0, r * 0.10);
    ctx.lineTo(-r * 0.08, r * 0.30);
    ctx.lineTo( r * 0.08, r * 0.30);
    ctx.closePath(); ctx.fill();
    // Teeth — single path with all 5 strokes (one beginPath/stroke instead of 5)
    ctx.strokeStyle = '#3a3028'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      ctx.moveTo(i * r * 0.13, r * 0.55);
      ctx.lineTo(i * r * 0.13, r * 0.85);
    }
    ctx.stroke();
    ctx.restore();
  }
  /* ====== MYTHICAL theme ====== */
  function drawEnemyMythical(e, r) {
    if (e.type === 'splitter') {
      // Hydra head — single dragon head, splits into more
      const pulse = 0.85 + 0.15 * Math.sin(e.age * 5);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#ddaa44'; ctx.shadowBlur = 14 * pulse;
      // Scaly body — overlapping arc segments
      ctx.fillStyle = '#7a4a18'; ctx.strokeStyle = '#3a2010'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Scales pattern
      ctx.fillStyle = '#aa6a30';
      for (let row = -1; row <= 1; row++) {
        for (let col = -2; col <= 2; col++) {
          const cx = col * r * 0.32 + (row & 1) * r * 0.16;
          const cy = row * r * 0.30;
          if (Math.hypot(cx, cy) > r * 0.85) continue;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.14, Math.PI, 0);
          ctx.fill();
        }
      }
      // Glowing eye
      ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffcc44';
      ctx.beginPath(); ctx.arc(0, -r * 0.20, r * 0.18 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = '#0a0408';
      ctx.beginPath(); ctx.ellipse(0, -r * 0.20, r * 0.04, r * 0.10, 0, 0, Math.PI * 2); ctx.fill();
      // Fanged jaw at the bottom
      ctx.fillStyle = '#0a0408';
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, r * 0.35);
      ctx.lineTo( r * 0.55, r * 0.35);
      ctx.lineTo( r * 0.30, r * 0.75);
      ctx.lineTo(-r * 0.30, r * 0.75);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff8e0';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.16, r * 0.35);
        ctx.lineTo(i * r * 0.16 - r * 0.04, r * 0.55);
        ctx.lineTo(i * r * 0.16 + r * 0.04, r * 0.55);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      return;
    }
    if (e.type === 'charger') {
      drawChargerAimLine(e);
      let body = '#5a4a8a', edge = '#aaaadd', glow = '#cccccc', glowBlur = 10;
      if (e.chargeState === 'aim')       { body = '#8a4a3a'; edge = '#ffcc66'; glow = '#ff8866'; glowBlur = 22; }
      else if (e.chargeState === 'dash') { body = '#aa2a1a'; edge = '#ffaa44'; glow = '#ff3300'; glowBlur = 28; }
      const heading = (e.chargeState === 'aim' || e.chargeState === 'dash') ? e.aimAng : Math.atan2(e.vy, e.vx);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = glow; ctx.shadowBlur = glowBlur;
      // Horse body (lower)
      ctx.fillStyle = '#5a3018'; ctx.strokeStyle = '#2a1808'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(-r * 0.20, r * 0.30, r * 0.95, r * 0.40, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Horse head extending forward
      ctx.beginPath();
      ctx.moveTo( r * 0.50,  r * 0.10);
      ctx.lineTo( r * 1.05, -r * 0.05);
      ctx.lineTo( r * 1.10,  r * 0.30);
      ctx.lineTo( r * 0.55,  r * 0.40);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Horse legs (4 quick lines)
      ctx.strokeStyle = '#2a1808'; ctx.lineWidth = 3;
      for (const lx of [-0.85, -0.40, 0.10, 0.40]) {
        ctx.beginPath();
        ctx.moveTo(r * lx, r * 0.55);
        ctx.lineTo(r * (lx - 0.05), r * 0.95);
        ctx.stroke();
      }
      // Knight body on top
      ctx.fillStyle = body; ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.25, -r * 0.10);
      ctx.lineTo(-r * 0.35, -r * 0.50);
      ctx.lineTo( r * 0.10, -r * 0.65);
      ctx.lineTo( r * 0.30, -r * 0.40);
      ctx.lineTo( r * 0.20, -r * 0.05);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Helmet visor slit
      ctx.strokeStyle = glow; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-r * 0.10, -r * 0.40); ctx.lineTo( r * 0.20, -r * 0.40); ctx.stroke();
      // Lance (long pole forward)
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#aa8030'; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo( r * 0.20, -r * 0.10);
      ctx.lineTo( r * 1.55, -r * 0.30);
      ctx.stroke();
      // Lance tip
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.moveTo( r * 1.55, -r * 0.30);
      ctx.lineTo( r * 1.75, -r * 0.40);
      ctx.lineTo( r * 1.55, -r * 0.45);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      return;
    }
    if (e.type === 'shielder') {
      // Tower shield knight — heavy plate with big rectangular shield
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.age * 0.15);
      ctx.shadowColor = '#aaaaaa'; ctx.shadowBlur = 8;
      // Torso (round plate)
      ctx.fillStyle = '#5a5a6a'; ctx.strokeStyle = '#1a1a2a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Plate detail (cross emblem)
      ctx.strokeStyle = '#ddaa44'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.6); ctx.lineTo(0, r * 0.6);
      ctx.moveTo(-r * 0.5, 0); ctx.lineTo( r * 0.5, 0);
      ctx.stroke();
      // Helmet on top (small dome)
      ctx.fillStyle = '#7a7a8a';
      ctx.beginPath();
      ctx.arc(0, -r * 0.85, r * 0.35, Math.PI, 0);
      ctx.lineTo( r * 0.35, -r * 0.55);
      ctx.lineTo(-r * 0.35, -r * 0.55);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Visor slit
      ctx.strokeStyle = '#ffaa44'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.18, -r * 0.80); ctx.lineTo(r * 0.18, -r * 0.80);
      ctx.stroke();
      ctx.restore();
      drawShielderArc(e, r, '#ffd944');
      return;
    }
    if (e.type === 'swarmer') {
      // Fairy — winged sprite with tiny wand
      const flap = Math.sin(e.age * 22);
      const heading = Math.atan2(e.vy || 0.001, e.vx || 0.001);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = '#ffccff'; ctx.shadowBlur = 12;
      // Wings (translucent sparkly)
      const wingY = r * (0.55 + flap * 0.30);
      ctx.fillStyle = 'rgba(220,180,255,0.55)'; ctx.strokeStyle = '#ffccff'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-r * 0.6, wingY * 0.55, -r * 0.95, wingY);
      ctx.quadraticCurveTo(-r * 0.6, wingY * 0.20, -r * 0.10, r * 0.05);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-r * 0.6, -wingY * 0.55, -r * 0.95, -wingY);
      ctx.quadraticCurveTo(-r * 0.6, -wingY * 0.20, -r * 0.10, -r * 0.05);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Body — small humanoid (head + torso)
      ctx.fillStyle = '#ffe0aa';
      ctx.beginPath(); ctx.arc(r * 0.15, -r * 0.20, r * 0.20, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#cc44aa';
      ctx.beginPath();
      ctx.moveTo(r * 0.0,  r * 0.0);
      ctx.lineTo(r * 0.30, r * 0.0);
      ctx.lineTo(r * 0.20, r * 0.45);
      ctx.lineTo(r * 0.10, r * 0.45);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Tiny wand forward
      ctx.strokeStyle = '#aa7733'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(r * 0.30, r * 0.10);
      ctx.lineTo(r * 0.75, r * 0.0);
      ctx.stroke();
      // Star tip
      ctx.shadowColor = '#ffff66'; ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffff66';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = i * Math.PI / 5 - Math.PI / 2;
        const rr = (i % 2 === 0) ? r * 0.16 : r * 0.07;
        const px = r * 0.78 + Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
      return;
    }
    if (e.type === 'orbiter') {
      // Wizard's eye — floating arcane orb
      const fireUrgency = e.orbitState === 'orbit' ? Math.max(0, 1 - (e.fireTimer || 0)) : 0;
      const orbPulse = 0.7 + 0.3 * Math.abs(Math.sin(e.age * (4 + fireUrgency * 8)));
      const ba = e.barrelAng || 0;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#bb88ff'; ctx.shadowBlur = 14;
      // Arcane runes ring (rotating)
      ctx.strokeStyle = 'rgba(200,160,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2); ctx.stroke();
      ctx.save();
      ctx.rotate(e.age * 0.6);
      ctx.fillStyle = '#ddaaff';
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05);
        ctx.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15);
        ctx.stroke();
      }
      ctx.restore();
      // Orb body
      ctx.fillStyle = '#5a3088'; ctx.strokeStyle = '#bb88ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Inner eye
      const lookOff = r * 0.20;
      const lx = Math.cos(ba) * lookOff, ly = Math.sin(ba) * lookOff;
      ctx.fillStyle = '#ffcc66';
      ctx.shadowColor = '#ffcc66'; ctx.shadowBlur = 12 * orbPulse;
      ctx.beginPath(); ctx.arc(lx, ly, r * 0.50 * orbPulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = '#0a0408';
      ctx.beginPath(); ctx.ellipse(lx, ly, r * 0.10, r * 0.20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(lx - r * 0.05, ly - r * 0.06, r * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawOrbiterBarrel(e, r, '#ffcc66');
      return;
    }
    // Grunt — Goblin (small humanoid with weapon)
    const heading = Math.atan2(e.vy || 0.001, e.vx || 0.001);
    const stride = Math.sin(e.age * 14);
    const fill = speedToColor(e.speed);
    ctx.save();
    ctx.translate(e.x, e.y); ctx.rotate(heading);
    ctx.shadowColor = '#88cc44'; ctx.shadowBlur = 10;
    // Torso
    ctx.fillStyle = '#5a8a30'; ctx.strokeStyle = '#1a3a08'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.55, r * 0.40, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Head
    ctx.beginPath(); ctx.arc(r * 0.55, -r * 0.05, r * 0.30, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Pointy ears
    ctx.beginPath();
    ctx.moveTo(r * 0.65, -r * 0.30); ctx.lineTo(r * 0.95, -r * 0.50); ctx.lineTo(r * 0.75, -r * 0.10);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Glowing red eye
    ctx.fillStyle = '#ff3300';
    ctx.beginPath(); ctx.arc(r * 0.70, -r * 0.05, r * 0.06, 0, Math.PI * 2); ctx.fill();
    // Snaggletooth
    ctx.fillStyle = '#fff8e0';
    ctx.beginPath();
    ctx.moveTo(r * 0.80, r * 0.05); ctx.lineTo(r * 0.78, r * 0.18); ctx.lineTo(r * 0.74, r * 0.05);
    ctx.closePath(); ctx.fill();
    // Legs (running)
    ctx.fillStyle = '#5a8a30';
    ctx.beginPath(); ctx.rect(-r * 0.30 + stride * r * 0.15, r * 0.30, r * 0.18, r * 0.55); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect( r * 0.10 - stride * r * 0.15, r * 0.30, r * 0.18, r * 0.55); ctx.fill(); ctx.stroke();
    // Crooked club weapon
    ctx.strokeStyle = '#7a4a18'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.40, -r * 0.15); ctx.lineTo(-r * 0.85, -r * 0.55);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#7a4a18';
    ctx.beginPath(); ctx.arc(-r * 0.85, -r * 0.55, r * 0.18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  /* ====== COSMIC theme ====== */
  function drawEnemyCosmic(e, r) {
    if (e.type === 'splitter') {
      // Black hole — accretion disk + event horizon
      const spin = e.age * 1.5;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(spin);
      ctx.shadowColor = '#aa44ff'; ctx.shadowBlur = 16;
      // Outer accretion disk (rotating bright ring)
      ctx.strokeStyle = '#dd66ff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.20, r * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffaaff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.10, r * 0.50, 0, 0, Math.PI * 2); ctx.stroke();
      // Inner ring (yellower, hotter)
      ctx.strokeStyle = '#ffcc66'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
      // Event horizon (pure black with subtle ring)
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#000'; ctx.strokeStyle = '#aa44ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      return;
    }
    if (e.type === 'charger') {
      drawChargerAimLine(e);
      let head = '#ffcc44', edge = '#ffe066', glow = '#ffcc44', glowBlur = 8;
      if (e.chargeState === 'aim')       { head = '#ff8866'; edge = '#ffaa66'; glow = '#ff8866'; glowBlur = 16; }
      else if (e.chargeState === 'dash') { head = '#ff3300'; edge = '#ffaa44'; glow = '#ff3300'; glowBlur = 22; }
      const heading = (e.chargeState === 'aim' || e.chargeState === 'dash') ? e.aimAng : Math.atan2(e.vy, e.vx);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      // Comet tail — solid additive triangle (no per-frame gradient alloc)
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,200,80,0.45)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.30);
      ctx.lineTo(-r * 2.5, 0);
      ctx.lineTo(0,  r * 0.30);
      ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // Comet head — bright core
      ctx.shadowColor = glow; ctx.shadowBlur = glowBlur;
      ctx.fillStyle = head; ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (e.type === 'shielder') {
      // Planet with ring — round body + tilted ellipse ring
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.age * 0.2);
      ctx.shadowColor = '#88aaff'; ctx.shadowBlur = 10;
      // Ring (back half)
      ctx.strokeStyle = '#aaccff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.50, r * 0.45, -0.3, Math.PI, 0); ctx.stroke();
      // Planet body
      ctx.fillStyle = '#3a6aaa'; ctx.strokeStyle = '#1a3a6a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Surface detail — bands
      ctx.strokeStyle = '#5a8aca'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -r * 0.25, r * 0.85, r * 0.10, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0,  r * 0.10, r * 0.95, r * 0.12, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0,  r * 0.45, r * 0.75, r * 0.08, 0, 0, Math.PI * 2); ctx.stroke();
      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(-r * 0.30, -r * 0.30, r * 0.40, 0, Math.PI * 2); ctx.fill();
      // Ring (front half — drawn over the planet)
      ctx.strokeStyle = '#aaccff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.50, r * 0.45, -0.3, 0, Math.PI); ctx.stroke();
      ctx.restore();
      drawShielderArc(e, r, '#aaccff');
      return;
    }
    if (e.type === 'swarmer') {
      // Meteor — small rock with fiery trail (solid additive triangle, no per-frame gradient)
      const heading = Math.atan2(e.vy || 0.001, e.vx || 0.001);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      // Trail
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,180,70,0.55)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.40);
      ctx.lineTo(-r * 1.5, 0);
      ctx.lineTo(0, r * 0.40);
      ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // Rocky body
      ctx.shadowColor = '#ff8844'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#5a4030'; ctx.strokeStyle = '#2a1810'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      const pts = [[0.5, -0.3], [0.3, -0.5], [-0.2, -0.4], [-0.4, -0.1], [-0.3, 0.3], [0.1, 0.5], [0.45, 0.25], [0.55, -0.05]];
      pts.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(r * px, r * py); else ctx.lineTo(r * px, r * py);
      });
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#3a2820';
      ctx.beginPath(); ctx.arc(r * 0.10, r * 0.05, r * 0.10, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-r * 0.15, -r * 0.20, r * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (e.type === 'orbiter') {
      // Satellite — boxy body with solar panels and dish
      const ba = e.barrelAng || 0;
      const fireUrgency = e.orbitState === 'orbit' ? Math.max(0, 1 - (e.fireTimer || 0)) : 0;
      const blink = (Math.sin(e.age * (3 + fireUrgency * 8)) > 0) ? 1 : 0.4;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#aaccff'; ctx.shadowBlur = 10;
      // Solar panels (left and right)
      ctx.fillStyle = '#1a3a6a'; ctx.strokeStyle = '#5a8aca'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.rect(-r * 1.3, -r * 0.30, r * 0.55, r * 0.60); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect( r * 0.75, -r * 0.30, r * 0.55, r * 0.60); ctx.fill(); ctx.stroke();
      // Cell grid lines
      ctx.strokeStyle = '#3a5a8a'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-r * 1.3 + i * r * 0.14, -r * 0.30);
        ctx.lineTo(-r * 1.3 + i * r * 0.14,  r * 0.30);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo( r * 0.75 + i * r * 0.14, -r * 0.30);
        ctx.lineTo( r * 0.75 + i * r * 0.14,  r * 0.30);
        ctx.stroke();
      }
      // Body (central box)
      ctx.fillStyle = '#7a8aaa'; ctx.strokeStyle = '#2a3a4a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(-r * 0.55, -r * 0.45, r * 1.10, r * 0.90); ctx.fill(); ctx.stroke();
      // Dish antenna pointing toward target
      ctx.save();
      ctx.rotate(ba);
      ctx.fillStyle = '#ddccaa'; ctx.strokeStyle = '#5a4a30'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(r * 0.70, 0, r * 0.30, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(r * 0.55, r * 0.05);
      ctx.lineTo(r * 0.55, -r * 0.05);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Dish stem
      ctx.strokeStyle = '#5a4a30'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(r * 0.10, 0); ctx.lineTo(r * 0.55, 0); ctx.stroke();
      ctx.restore();
      // Blinking status light
      ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 6;
      ctx.fillStyle = `rgba(255, 50, 50, ${blink})`;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.10, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawOrbiterBarrel(e, r, '#ddccaa');
      return;
    }
    // Grunt — Asteroid (irregular polygon with craters). Lower blur — this is the most-spawned enemy.
    const fill = speedToColor(e.speed);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.age * 0.4);
    ctx.shadowColor = fill; ctx.shadowBlur = 6;
    ctx.fillStyle = '#5a4a3a'; ctx.strokeStyle = fill; ctx.lineWidth = 1.4;
    ctx.beginPath();
    const pts = [[1.0, -0.2], [0.7, -0.7], [0.0, -0.95], [-0.7, -0.65], [-1.05, -0.05], [-0.85, 0.55], [-0.30, 1.0], [0.45, 0.85], [0.95, 0.40]];
    pts.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(r * px, r * py); else ctx.lineTo(r * px, r * py);
    });
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Craters (no blur)
    ctx.shadowBlur = 0; ctx.fillStyle = '#3a2820';
    ctx.beginPath(); ctx.arc( r * 0.10, -r * 0.15, r * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-r * 0.40,  r * 0.30, r * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  /* ====== GLITCH theme — datamoshed shapes with RGB shifts ====== */
  function drawEnemyGlitch(e, r) {
    // RGB shift offset — common to all glitch enemies
    const shift = 2 + Math.sin(e.age * 6) * 1.5;
    const flicker = Math.random() < 0.04;
    if (e.type === 'splitter') {
      // Pixel fragment — broken sprite block with RGB-split copies
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(Math.floor(e.age * 4) * 0.05);
      const draw = (offX, offY, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(-r + offX, -r + offY, r * 0.7, r * 0.7);
        ctx.fillRect( r * 0.0 + offX, -r + offY, r * 0.5, r * 0.5);
        ctx.fillRect(-r + offX,  r * 0.0 + offY, r * 0.5, r * 0.5);
        ctx.fillRect( r * 0.2 + offX,  r * 0.2 + offY, r * 0.6, r * 0.6);
      };
      ctx.globalCompositeOperation = 'lighter';
      draw(-shift, 0, 'rgba(255,0,0,0.7)');
      draw(0, 0, 'rgba(0,255,255,0.7)');
      draw(shift, 0, 'rgba(255,0,255,0.7)');
      ctx.globalCompositeOperation = 'source-over';
      if (flicker) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-r * 0.5, -r * 0.5, r, r * 0.15);
      }
      ctx.restore();
      return;
    }
    if (e.type === 'charger') {
      drawChargerAimLine(e);
      const heading = (e.chargeState === 'aim' || e.chargeState === 'dash') ? e.aimAng : Math.atan2(e.vy, e.vx);
      let glow = '#00ffff', glowBlur = 14;
      if (e.chargeState === 'aim') { glow = '#ffff00'; glowBlur = 22; }
      else if (e.chargeState === 'dash') { glow = '#ff00ff'; glowBlur = 28; }
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = glow; ctx.shadowBlur = glowBlur;
      // Glitched cursor — arrow shape with RGB split
      const arrow = () => {
        ctx.beginPath();
        ctx.moveTo(r * 1.40,  0);
        ctx.lineTo(-r * 0.30, -r * 0.65);
        ctx.lineTo(-r * 0.10, -r * 0.20);
        ctx.lineTo(-r * 0.85, -r * 0.20);
        ctx.lineTo(-r * 0.85,  r * 0.20);
        ctx.lineTo(-r * 0.10,  r * 0.20);
        ctx.lineTo(-r * 0.30,  r * 0.65);
        ctx.closePath();
      };
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,0,0,0.7)';
      ctx.save(); ctx.translate(-shift, 0); arrow(); ctx.fill(); ctx.restore();
      ctx.fillStyle = 'rgba(0,255,255,0.7)';
      arrow(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,0,0.6)';
      ctx.save(); ctx.translate(shift, 0); arrow(); ctx.fill(); ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      // Solid white outline on top
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      arrow(); ctx.stroke();
      ctx.restore();
      return;
    }
    if (e.type === 'shielder') {
      // Encrypted cube — 3D-ish wireframe cube with hex digits
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.age * 0.5);
      ctx.shadowColor = '#00ff88'; ctx.shadowBlur = 10;
      // Cube body
      ctx.fillStyle = '#001a10'; ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
      ctx.fill(); ctx.stroke();
      // 3D effect — top + right edge
      ctx.beginPath();
      ctx.moveTo(-r * 0.85, -r * 0.85); ctx.lineTo(-r * 0.55, -r * 1.10);
      ctx.lineTo( r * 1.10, -r * 1.10); ctx.lineTo( r * 0.85, -r * 0.85);
      ctx.closePath(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo( r * 0.85, -r * 0.85); ctx.lineTo( r * 1.10, -r * 1.10);
      ctx.lineTo( r * 1.10,  r * 0.55); ctx.lineTo( r * 0.85,  r * 0.85);
      ctx.closePath(); ctx.stroke();
      // Hex digit glitch grid inside
      ctx.fillStyle = '#00ff88';
      ctx.font = `bold ${Math.round(r * 0.30)}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const hexFrame = Math.floor(e.age * 6);
      const digits = '0123456789ABCDEF';
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const idx = (hexFrame + row * 3 + col) % digits.length;
          ctx.fillText(digits[idx], (col - 1) * r * 0.5, (row - 1) * r * 0.5);
        }
      }
      ctx.restore();
      drawShielderArc(e, r, '#00ff88');
      return;
    }
    if (e.type === 'swarmer') {
      // 8-bit pixel sprite (small blocky alien)
      const heading = Math.atan2(e.vy || 0.001, e.vx || 0.001);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = '#ff00ff'; ctx.shadowBlur = 8;
      const px = r * 0.20; // pixel size
      // Body grid (filled cells)
      const cells = [
        [-1,-1], [0,-1], [1,-1],
        [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0],
        [-2, 1], [0, 1], [2, 1],
        [-1, 2], [1, 2],
      ];
      ctx.globalCompositeOperation = 'lighter';
      const drawCells = (oxOff, oyOff, color) => {
        ctx.fillStyle = color;
        for (const [cx, cy] of cells) {
          ctx.fillRect(cx * px - px / 2 + oxOff, cy * px - px / 2 + oyOff, px, px);
        }
      };
      drawCells(-shift * 0.5, 0, 'rgba(255,0,80,0.85)');
      drawCells(0, 0, 'rgba(0,255,180,0.85)');
      drawCells(shift * 0.5, 0, 'rgba(255,255,0,0.7)');
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
      return;
    }
    if (e.type === 'orbiter') {
      // Surveillance camera — boxy with single lens
      const ba = e.barrelAng || 0;
      const recBlink = (Math.sin(e.age * 4) > 0) ? 1 : 0.3;
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(ba);
      ctx.shadowColor = '#ff0044'; ctx.shadowBlur = 12;
      // Camera body
      ctx.fillStyle = '#1a1a1a'; ctx.strokeStyle = '#ff0044'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(-r * 0.65, -r * 0.5, r * 1.3, r);
      ctx.fill(); ctx.stroke();
      // Lens hood (forward)
      ctx.beginPath();
      ctx.rect(r * 0.65, -r * 0.30, r * 0.40, r * 0.60);
      ctx.fill(); ctx.stroke();
      // Lens
      ctx.fillStyle = '#000'; ctx.strokeStyle = '#ff0044';
      ctx.beginPath(); ctx.arc(r * 0.85, 0, r * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff2244';
      ctx.beginPath(); ctx.arc(r * 0.85, 0, r * 0.10, 0, Math.PI * 2); ctx.fill();
      // Mount stem
      ctx.strokeStyle = '#666'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-r * 0.30, r * 0.5); ctx.lineTo(-r * 0.30, r * 0.85); ctx.stroke();
      // Recording light (blinks)
      ctx.shadowColor = '#ff0044'; ctx.shadowBlur = 8;
      ctx.fillStyle = `rgba(255, 0, 60, ${recBlink})`;
      ctx.beginPath(); ctx.arc(r * 0.40, -r * 0.30, r * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawOrbiterBarrel(e, r, '#ff0044');
      return;
    }
    // Grunt — RGB-split square
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(Math.floor(e.age * 5) * 0.1);
    const fill = speedToColor(e.speed);
    ctx.shadowColor = fill; ctx.shadowBlur = 10;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,0,80,0.8)';
    ctx.fillRect(-r + -shift, -r, r * 2, r * 2);
    ctx.fillStyle = 'rgba(0,255,180,0.8)';
    ctx.fillRect(-r,           -r, r * 2, r * 2);
    ctx.fillStyle = 'rgba(255,255,0,0.7)';
    ctx.fillRect(-r + shift,   -r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
    if (flicker) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-r, -r * 0.05 + Math.sin(e.age * 30) * r * 0.4, r * 2, r * 0.10);
    }
    ctx.restore();
  }
  /* ====== STEAMPUNK theme — brass cogs and riveted iron ====== */
  function drawEnemySteampunk(e, r) {
    if (e.type === 'splitter') {
      // Clockwork bomb — round with timer face that ticks
      const tickAng = Math.floor(e.age * 4) * (Math.PI / 6); // ticks like a clock
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#cc8833'; ctx.shadowBlur = 12;
      // Brass shell
      ctx.fillStyle = '#7a4a18'; ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Inner clock face
      ctx.fillStyle = '#dda855'; ctx.strokeStyle = '#3a2008';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Hour ticks
      ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.65, Math.sin(a) * r * 0.65);
        ctx.lineTo(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75);
        ctx.stroke();
      }
      // Hour hand (ticking)
      ctx.strokeStyle = '#1a0a04'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(tickAng - Math.PI / 2) * r * 0.50, Math.sin(tickAng - Math.PI / 2) * r * 0.50);
      ctx.stroke();
      // Minute hand
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(e.age * 4 - Math.PI / 2) * r * 0.65, Math.sin(e.age * 4 - Math.PI / 2) * r * 0.65);
      ctx.stroke();
      ctx.lineCap = 'butt';
      // Center pin
      ctx.shadowBlur = 0; ctx.fillStyle = '#1a0a04';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2); ctx.fill();
      // Fuse on top
      ctx.strokeStyle = '#5a3010'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.20, -r * 1.20, r * 0.10, -r * 1.40);
      ctx.stroke();
      // Fuse spark
      ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#ffaa00';
      ctx.beginPath(); ctx.arc(r * 0.10, -r * 1.40, r * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (e.type === 'charger') {
      drawChargerAimLine(e);
      let body = '#5a3a1a', edge = '#cc8833', glow = '#cc8833', glowBlur = 10;
      if (e.chargeState === 'aim')       { body = '#7a3a1a'; edge = '#ffaa55'; glow = '#ff8866'; glowBlur = 22; }
      else if (e.chargeState === 'dash') { body = '#aa1a05'; edge = '#ffaa55'; glow = '#ff3300'; glowBlur = 28; }
      const heading = (e.chargeState === 'aim' || e.chargeState === 'dash') ? e.aimAng : Math.atan2(e.vy, e.vx);
      const wheelAng = e.age * 14; // wheels spin fast when running
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = glow; ctx.shadowBlur = glowBlur;
      // Locomotive body — boxy with rounded front
      ctx.fillStyle = body; ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo( r * 1.30,  0);
      ctx.lineTo( r * 1.10, -r * 0.55);
      ctx.lineTo(-r * 0.85, -r * 0.55);
      ctx.lineTo(-r * 1.05, -r * 0.30);
      ctx.lineTo(-r * 1.05,  r * 0.55);
      ctx.lineTo( r * 0.95,  r * 0.55);
      ctx.lineTo( r * 1.30,  r * 0.20);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Smokestack
      ctx.fillStyle = '#3a2008';
      ctx.beginPath(); ctx.rect( r * 0.20, -r * 0.95, r * 0.40, r * 0.45); ctx.fill(); ctx.stroke();
      // Smoke puffs above stack
      ctx.shadowColor = 'rgba(180,180,180,0.7)'; ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(220,220,220,0.7)';
      ctx.beginPath(); ctx.arc(r * 0.35, -r * 1.10, r * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.50, -r * 1.30, r * 0.14, 0, Math.PI * 2); ctx.fill();
      // Boiler band detail
      ctx.shadowBlur = 0; ctx.strokeStyle = '#cc8833'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(r * 0.10, -r * 0.55); ctx.lineTo(r * 0.10, r * 0.55); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.30, -r * 0.55); ctx.lineTo(-r * 0.30, r * 0.55); ctx.stroke();
      // Front headlight (glowing)
      ctx.shadowColor = '#ffeeaa'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffeeaa';
      ctx.beginPath(); ctx.arc(r * 1.20, 0, r * 0.12, 0, Math.PI * 2); ctx.fill();
      // Wheels (front + back, spinning)
      ctx.shadowBlur = 0;
      const drawWheel = (wx, wy, wr) => {
        ctx.fillStyle = '#1a1008'; ctx.strokeStyle = '#cc8833'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(wx, wy, wr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // Spokes (rotating)
        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(wheelAng);
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 4);
          ctx.beginPath(); ctx.moveTo(-wr * 0.85, 0); ctx.lineTo(wr * 0.85, 0); ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = '#cc8833';
        ctx.beginPath(); ctx.arc(wx, wy, wr * 0.18, 0, Math.PI * 2); ctx.fill();
      };
      drawWheel( r * 0.60, r * 0.65, r * 0.32);
      drawWheel(-r * 0.50, r * 0.65, r * 0.32);
      ctx.restore();
      return;
    }
    if (e.type === 'shielder') {
      // Iron clad cube — riveted armor with bolts
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.age * 0.25);
      ctx.shadowColor = '#cc8833'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#3a2818'; ctx.strokeStyle = '#cc8833'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
      ctx.fill(); ctx.stroke();
      // Inner panel detail (X cross)
      ctx.strokeStyle = '#5a4028'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.85, -r * 0.85); ctx.lineTo(r * 0.85, r * 0.85);
      ctx.moveTo(-r * 0.85,  r * 0.85); ctx.lineTo(r * 0.85, -r * 0.85);
      ctx.stroke();
      // Rivets at corners
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#dda855';
      const rivets = [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7], [0, 0]];
      for (const [rx, ry] of rivets) {
        ctx.beginPath(); ctx.arc(r * rx, r * ry, r * 0.10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#7a5018';
        ctx.beginPath(); ctx.arc(r * rx, r * ry, r * 0.04, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#dda855';
      }
      ctx.restore();
      drawShielderArc(e, r, '#ffcc66');
      return;
    }
    if (e.type === 'swarmer') {
      // Brass dirigible — small steam-flier with propeller
      const propAng = e.age * 35; // propeller spins fast
      const heading = Math.atan2(e.vy || 0.001, e.vx || 0.001);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(heading);
      ctx.shadowColor = '#cc8833'; ctx.shadowBlur = 8;
      // Balloon — elongated oval
      ctx.fillStyle = '#a87830'; ctx.strokeStyle = '#5a3010'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.0, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Stripe band
      ctx.strokeStyle = '#5a3010'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-r * 0.85, -r * 0.18); ctx.lineTo(r * 0.85, -r * 0.18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.85,  r * 0.18); ctx.lineTo(r * 0.85,  r * 0.18); ctx.stroke();
      // Gondola (small box hanging below)
      ctx.fillStyle = '#3a2008'; ctx.strokeStyle = '#cc8833';
      ctx.beginPath(); ctx.rect(-r * 0.30, r * 0.40, r * 0.60, r * 0.30); ctx.fill(); ctx.stroke();
      // Propeller at the back
      ctx.save();
      ctx.translate(-r * 1.0, 0);
      ctx.rotate(propAng);
      ctx.fillStyle = '#cc8833'; ctx.strokeStyle = '#5a3010';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.30, r * 0.05, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.05, r * 0.30, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#dda855';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Steam puff trailing behind
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(220,220,220,0.45)';
      ctx.beginPath(); ctx.arc(-r * 1.30 + Math.sin(e.age * 8) * r * 0.05, r * 0.10, r * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (e.type === 'orbiter') {
      // Brass mechanical eye — ornate eye with iris aperture
      const fireUrgency = e.orbitState === 'orbit' ? Math.max(0, 1 - (e.fireTimer || 0)) : 0;
      const aperture = 0.75 + 0.25 * Math.abs(Math.sin(e.age * (3 + fireUrgency * 6)));
      const ba = e.barrelAng || 0;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = '#cc8833'; ctx.shadowBlur = 12;
      // Outer brass casing
      ctx.fillStyle = '#7a4a18'; ctx.strokeStyle = '#cc8833'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Bolts around the rim
      ctx.fillStyle = '#dda855';
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + e.age * 0.2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, r * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
      // Iris aperture (gold petals)
      ctx.fillStyle = '#3a2008'; ctx.strokeStyle = '#cc8833';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Aperture blades — 6 triangle petals tracking the barrel
      ctx.save();
      ctx.rotate(ba);
      ctx.fillStyle = '#cc8833'; ctx.strokeStyle = '#7a4a18'; ctx.lineWidth = 1;
      const inner = r * 0.18 * aperture;
      const outer = r * 0.62;
      for (let i = 0; i < 6; i++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath();
        ctx.moveTo(inner, 0);
        ctx.lineTo(outer, -outer * 0.30);
        ctx.lineTo(outer * 0.85, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
      // Pupil — bright glowing center
      ctx.shadowColor = '#ffaa44'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#ffaa44';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.18 * aperture, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#1a0a00';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.10 * aperture, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawOrbiterBarrel(e, r, '#ffaa44');
      return;
    }
    // Grunt — Cogwheel (gear with teeth, slowly spinning)
    const fill = speedToColor(e.speed);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.age * 0.6);
    ctx.shadowColor = fill; ctx.shadowBlur = 10;
    ctx.fillStyle = '#7a5018'; ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 1.5;
    // Draw cog teeth + body as a single path
    const teeth = 10;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = i * Math.PI / teeth;
      const rr = (i % 2 === 0) ? r * 1.05 : r * 0.85;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else         ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Inner hub
    ctx.fillStyle = '#dda855';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Center hole
    ctx.shadowBlur = 0; ctx.fillStyle = '#1a0a00';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.20, 0, Math.PI * 2); ctx.fill();
    // Spokes
    ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.20, Math.sin(a) * r * 0.20);
      ctx.lineTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFloaters() {
    if (floaters.length === 0) return;
    ctx.save();
    ctx.font = 'bold 14px system-ui, -apple-system, "Segoe UI", Roboto';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      const a = Math.max(0, Math.min(1, f.life / f.maxLife));
      // Pop-in scale: spawns small, overshoots to 1.3, settles to 1.0 over the first ~25% of life
      const ageRatio = 1 - a;
      let popScale;
      if (ageRatio < 0.10)      popScale = 0.5 + (ageRatio / 0.10) * 0.8;        // 0.5 → 1.3
      else if (ageRatio < 0.25) popScale = 1.3 - ((ageRatio - 0.10) / 0.15) * 0.3; // 1.3 → 1.0
      else                       popScale = 1.0;

      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.scale(popScale, popScale);
      ctx.globalAlpha = a;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawAmmoHUD() {
    if (!state.running) return;
    const pad  = 14;
    const dotR = 6;
    const gap  = 8;
    const total  = state.maxFireRounds;
    const filled = state.fireRounds;

    ctx.save();
    for (let i = 0; i < total; i++) {
      // Right-anchored: i=0 is rightmost dot
      const x = W - pad - dotR - i * (dotR * 2 + gap);
      const y = pad + dotR;

      if (i < filled) {
        // Available round
        ctx.fillStyle = '#ffcc66';
        ctx.shadowColor = '#ffcc66';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (i === filled) {
        // Recharging round — empty ring + arc showing progress
        ctx.strokeStyle = 'rgba(255,204,102,0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.stroke();

        const progress = state.rechargeInterval > 0
          ? Math.min(1, state.rechargeTimer / state.rechargeInterval)
          : 0;
        if (progress > 0) {
          ctx.strokeStyle = '#ffcc66';
          ctx.lineWidth = 2;
          ctx.shadowColor = '#ffcc66';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, dotR, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      } else {
        // Empty slot
        ctx.strokeStyle = 'rgba(255,204,102,0.20)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Comet streak — elongated capsule oriented along velocity, glow halo + bright core + motion tail.
  // Used for both player and enemy projectiles so they share visual language but differ in palette.
  function drawComet(x, y, vx, vy, r, glow, core) {
    const speed = Math.hypot(vx, vy) || 1;
    const ang = Math.atan2(vy, vx);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);

    // Trailing tail — fades behind the head, length scales with speed
    const tailLen = Math.min(speed * 0.022, r * 6);
    const tail = ctx.createLinearGradient(-tailLen, 0, r, 0);
    tail.addColorStop(0, 'rgba(0,0,0,0)');
    tail.addColorStop(1, glow);
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(-tailLen, 0);
    ctx.lineTo(0, -r * 0.7);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r * 0.7);
    ctx.closePath();
    ctx.fill();

    // Outer glow head
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Hot core
    ctx.shadowBlur = 0;
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawEnemyBullets() {
    if (enemyBullets.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const eb of enemyBullets) {
      drawComet(eb.x, eb.y, eb.vx || 0, eb.vy || 0, eb.r, '#ff5577', '#ffccdd');
    }
    ctx.restore();
  }

  function drawBackground() {
    // Solid base
    ctx.fillStyle = '#070710';
    ctx.fillRect(0, 0, W, H);

    const comboPulse = Math.min(state.combo / 30, 1);

    // Drifting nebula clouds — palette pulled from the active theme
    const NEBULAE = currentTheme().nebulae;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const n of NEBULAE) {
      // Slow orbit so the clouds drift over time without distracting motion
      const driftX = Math.cos(state.time * n.speed) * 0.04;
      const driftY = Math.sin(state.time * n.speed * 0.7) * 0.03;
      const cx = (n.baseX + driftX) * W;
      const cy = (n.baseY + driftY) * H;
      const radius = n.radius * Math.max(W, H);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, n.color + '0.18)');
      grad.addColorStop(0.5, n.color + '0.06)');
      grad.addColorStop(1, n.color + '0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    // Drifting grid
    const gs = 64;
    const ox = (state.time * 18) % gs;
    const oy = (state.time * 12) % gs;
    ctx.strokeStyle = `rgba(90, 120, 200, ${0.05 + comboPulse * 0.06})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -ox; x < W; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = -oy; y < H; y += gs) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // Stars — multi-color twinkle (deterministic palette per star via twinkle phase)
    const STAR_COLORS = ['#aaccff', '#ffd1f0', '#ccffe6', '#ffe1aa'];
    ctx.globalCompositeOperation = 'lighter';
    for (const s of stars) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(state.time * 1.5 + s.twinkle));
      ctx.globalAlpha = tw * 0.55;
      ctx.fillStyle = STAR_COLORS[(s.twinkle * 7 | 0) % STAR_COLORS.length];
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Corner vignette — subtle dark falloff toward the edges to focus play
    const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.4, W/2, H/2, Math.max(W,H)*0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // Combo vignette (overlaid on top of base vignette so it tints the dark falloff)
    if (comboPulse > 0.05) {
      const grad = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.3, W/2, H/2, Math.max(W,H)*0.7);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(124, 253, 214, ${0.06 * comboPulse})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function render() {
    // Background (un-shaken)
    drawBackground();

    // Begin shaken layer
    ctx.save();
    if (effects.shake > 0.1) {
      const sx = (Math.random() * 2 - 1) * effects.shake;
      const sy = (Math.random() * 2 - 1) * effects.shake;
      ctx.translate(sx, sy);
    }

    // Shockwaves
    for (const s of shockwaves) {
      const t = 1 - (s.life / s.maxLife);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lineWidth * (1 - t * 0.7);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Particles (additive for neon glow)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.restore();

    // Pre-burst flash pulses — bright expanding white halo, fades fast (drawn under shards)
    if (flashes.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const f of flashes) {
        const a = Math.max(0, f.life / f.maxLife);
        const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
        grad.addColorStop(0, `rgba(255,255,255,${0.85 * a})`);
        grad.addColorStop(0.5, `rgba(255,255,255,${0.35 * a})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Shards — spinning triangular debris from kills
    if (shards.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const s of shards) {
        const a = Math.max(0, Math.min(1, s.life / s.maxLife));
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.globalAlpha = a;
        ctx.fillStyle = s.color;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo( s.size,  0);
        ctx.lineTo(-s.size * 0.5,  s.size * 0.7);
        ctx.lineTo(-s.size * 0.5, -s.size * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    // Enemies
    for (const e of enemies) {
      drawEnemy(e);
      // Hit-flash overlay — brief white tint after a non-lethal hit
      if (e.hitFlash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = e.hitFlash * 4; // peaks at 0.48 right after a hit
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // HP bar — only for multi-HP enemies (bosses)
      if (e.maxHp && e.maxHp > 1) {
        const barW = e.r * 2.2;
        const barH = 5;
        const bx = e.x - barW / 2;
        const by = e.y - e.r - 14;
        const pct = Math.max(0, e.hp / e.maxHp);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
        ctx.fillStyle = pct > 0.5 ? '#88ffcc' : (pct > 0.25 ? '#ffcc44' : '#ff4422');
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.fillRect(bx, by, barW * pct, barH);
        ctx.restore();
      }
    }

    // Enemy projectiles (drawn under player bullets so player shots read on top)
    drawEnemyBullets();

    // Bullets — custom comet streaks, oriented along velocity
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of bullets) {
      drawComet(b.x, b.y, b.vx, b.vy, b.r, '#ffaa00', '#fff5cc');
    }
    ctx.restore();

    // Power-ups — pulsing core, orbiting sparkle ring, glyph centered
    for (const p of powerups) {
      const pulse = 0.8 + 0.2 * Math.sin(p.pulsePhase);
      const alpha = Math.max(0.3, p.life / p.maxLife);
      const isRecharge = p.type === 'recharge';
      const color = isRecharge ? '#88ffcc' : '#ffd700';

      ctx.save();
      ctx.globalAlpha = alpha;

      // Glow body
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18 * pulse;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Orbiting sparkle ring — three small dots rotating around the core
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ffffff';
      const orbitR = p.r * 1.55;
      const baseAng = state.time * 2.2;
      for (let i = 0; i < 3; i++) {
        const a = baseAng + i * (Math.PI * 2 / 3);
        const sx = p.x + Math.cos(a) * orbitR;
        const sy = p.y + Math.sin(a) * orbitR;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Glyph — custom-drawn so it renders identically across all platforms (no emoji variance)
      ctx.shadowBlur = 0;
      if (isRecharge) {
        // Hand-drawn lightning bolt — sharper and more "designed" than emoji ⚡
        const s = p.r * 0.95;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(p.x - s * 0.30, p.y - s * 0.65);
        ctx.lineTo(p.x + s * 0.18, p.y - s * 0.10);
        ctx.lineTo(p.x - s * 0.02, p.y - s * 0.10);
        ctx.lineTo(p.x + s * 0.32, p.y + s * 0.65);
        ctx.lineTo(p.x - s * 0.18, p.y + s * 0.10);
        ctx.lineTo(p.x + s * 0.02, p.y + s * 0.10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // Multiplier badge — "×3" text in dark center for legibility on the gold core
        ctx.fillStyle = '#1a1300';
        ctx.font = 'bold 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('×3', p.x, p.y);
      }

      ctx.restore();
    }

    // Player — custom vector ship, smooth-rotated to face the cursor, with halo + thrust + bank-tilt
    {
      const dx = mouse.x - player.x;
      const dy = mouse.y - player.y;
      const dist = Math.hypot(dx, dy);
      let prevAngle = player.angle;
      if (dist > 6) {
        // Lerp angle toward target — shortest-path on the circle so 359°→1° wraps cleanly
        const target = Math.atan2(dy, dx);
        let diff = target - player.angle;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        player.angle += diff * 0.18;
      }
      // Bank-tilt: ship leans into turns. Compute angular velocity, scale to a small Y-squash.
      let angVel = player.angle - prevAngle;
      while (angVel >  Math.PI) angVel -= Math.PI * 2;
      while (angVel < -Math.PI) angVel += Math.PI * 2;
      const bank = Math.max(-0.5, Math.min(0.5, angVel * 6)); // clamp so it stays subtle
      const r = player.r;

      // Engine particle trail — continuous spray of mint sparks behind the ship
      const engineAng = player.angle + Math.PI;
      const ex = player.x + Math.cos(engineAng) * r * 0.6;
      const ey = player.y + Math.sin(engineAng) * r * 0.6;
      for (let i = 0; i < 2; i++) {
        const spread = (Math.random() - 0.5) * 0.7;
        const sp = 70 + Math.random() * 110;
        const TRAIL_COLORS = ['#88ffcc', '#5fe0c0', '#aaffe6'];
        particles.push({
          x: ex + (Math.random() - 0.5) * 2,
          y: ey + (Math.random() - 0.5) * 2,
          vx: Math.cos(engineAng + spread) * sp,
          vy: Math.sin(engineAng + spread) * sp,
          life: 0.32, maxLife: 0.32,
          size: 1.4 + Math.random() * 1.0,
          color: TRAIL_COLORS[(Math.random() * TRAIL_COLORS.length) | 0],
        });
      }

      // Outer halo
      ctx.save();
      ctx.shadowColor = '#88ffcc';
      ctx.shadowBlur = 22;
      ctx.fillStyle = 'rgba(136,255,204,0.30)';
      ctx.beginPath();
      ctx.arc(player.x, player.y, r * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Thrust flame behind the ship (world-coords so it streams cleanly even mid-rotation)
      const thrustAng = player.angle + Math.PI;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const flicker = 0.7 + 0.3 * Math.random();
      const flameLen = r * 1.8 * flicker;
      const fx0 = player.x + Math.cos(thrustAng) * r * 0.55;
      const fy0 = player.y + Math.sin(thrustAng) * r * 0.55;
      const fx1 = player.x + Math.cos(thrustAng) * (r * 0.55 + flameLen);
      const fy1 = player.y + Math.sin(thrustAng) * (r * 0.55 + flameLen);
      const flame = ctx.createLinearGradient(fx0, fy0, fx1, fy1);
      flame.addColorStop(0, 'rgba(180,255,220,0.95)');
      flame.addColorStop(0.4, 'rgba(120,220,180,0.6)');
      flame.addColorStop(1, 'rgba(80,180,140,0)');
      ctx.strokeStyle = flame;
      ctx.lineWidth = r * 0.75;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(fx0, fy0);
      ctx.lineTo(fx1, fy1);
      ctx.stroke();
      ctx.restore();

      // Ship body — drawn in local coords with +X = forward (nose), Y squashed by bank-tilt
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.angle);
      ctx.scale(1, 1 - Math.abs(bank) * 0.5); // bank squashes vertically when turning hard
      ctx.transform(1, 0, bank * 0.25, 1, 0, 0); // and skews slightly so the lean reads

      // Wings (back-swept, dark-teal fill, neon edge)
      ctx.fillStyle = '#10302c';
      ctx.strokeStyle = '#5fe0c0';
      ctx.lineWidth = 1.3;
      ctx.shadowColor = '#5fe0c0';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo( r * 0.30,  0);
      ctx.lineTo(-r * 0.85,  r * 1.10);
      ctx.lineTo(-r * 0.55,  r * 0.30);
      ctx.lineTo(-r * 0.55, -r * 0.30);
      ctx.lineTo(-r * 0.85, -r * 1.10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Main hull — sleek dart pointing forward
      ctx.fillStyle = '#e6f6f0';
      ctx.strokeStyle = '#88ffcc';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#88ffcc';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo( r * 1.55,  0);              // nose
      ctx.lineTo(-r * 0.45,  r * 0.50);
      ctx.lineTo(-r * 0.65,  0);
      ctx.lineTo(-r * 0.45, -r * 0.50);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Cockpit canopy — small cyan diamond near the front
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#7af0ff';
      ctx.shadowColor = '#7af0ff';
      ctx.beginPath();
      ctx.moveTo( r * 0.65,  0);
      ctx.lineTo( r * 0.25,  r * 0.22);
      ctx.lineTo(-r * 0.05,  0);
      ctx.lineTo( r * 0.25, -r * 0.22);
      ctx.closePath();
      ctx.fill();

      // Engine glow at the back (animates with thrust flicker)
      ctx.shadowBlur = 10;
      ctx.fillStyle = `rgba(136, 255, 204, ${0.7 + 0.3 * flicker})`;
      ctx.shadowColor = '#88ffcc';
      ctx.beginPath();
      ctx.arc(-r * 0.6, 0, r * 0.28 * (0.85 + 0.15 * flicker), 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // Cursor reticle — minimalist diamond crosshair: 4 corner ticks rotating slowly
    {
      const t = state.time * 1.4;
      const reticleR = 12;
      const tickLen = 4;
      ctx.save();
      ctx.translate(mouse.x, mouse.y);
      ctx.rotate(t);
      ctx.strokeStyle = '#88ffcc';
      ctx.shadowColor = '#88ffcc';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.7;
      ctx.lineCap = 'round';
      // Four diagonal corner ticks (NE, SE, SW, NW)
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        const x0 = Math.cos(a) * reticleR;
        const y0 = Math.sin(a) * reticleR;
        const x1 = Math.cos(a) * (reticleR + tickLen);
        const y1 = Math.sin(a) * (reticleR + tickLen);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      // Tiny center dot
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#88ffcc';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();

    // Score floaters (un-shaken so they read cleanly)
    drawFloaters();

    // Ammo HUD — top-right, un-shaken
    drawAmmoHUD();

    // Flash overlay (un-shaken, on top)
    if (effects.flash > 0.01) {
      ctx.fillStyle = `rgba(${effects.flashColor},${effects.flash})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Record-popup banner (above flash so always readable)
    drawBanner();
  }

  /* ====== Modal close-click ====== */
  document.getElementById('lbModal').addEventListener('click', (e) => {
    if (e.target.id === 'lbModal') e.currentTarget.classList.remove('show');
  });

  /* ====== Boot ====== */
  resize();
  requestAnimationFrame(function loopStart() {
    requestAnimationFrame(loop);
  });
  setOverlayHome();
})();