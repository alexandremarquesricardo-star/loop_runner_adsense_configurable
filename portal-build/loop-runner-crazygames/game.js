(() => {
  const $ = (sel) => document.querySelector(sel);
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W=0, H=0, DPR=Math.min(devicePixelRatio||1,2);

  /* ====== layout sizing (full viewport — portal build has no top banner / nav) ====== */
  function resize(){
    W = innerWidth|0;
    H = Math.max(0, innerHeight|0);
    canvas.width  = Math.max(1, W*DPR);
    canvas.height = Math.max(1, H*DPR);
    canvas.style.width = W+'px';
    canvas.style.height = H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  addEventListener('resize', resize);
  window.addEventListener('load', resize);

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
    picking: false,
    picksTaken: 0,
    upgrades: {},          // { upgradeKey: level }
    timeWarpTimer: 0,      // active duration of post-kill slow-mo
    magnet: false,         // powerup magnet enabled?
  };

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
  const player = { x: W/2, y: H/2, r: 12, vx: 0, vy: 0, maxSpeed: 400, friction: 8 };
  const enemies = [];
  const bullets = [];
  const particles = [];
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

  function checkRecordTriggers() {
    const score = state.score | 0;

    // Score milestones (once per run, once per threshold)
    for (const m of SCORE_MILESTONES) {
      if (score >= m.score && !runFlags.scoreMilestones.has(m.score)) {
        runFlags.scoreMilestones.add(m.score);
        pushBanner(m.text, m.tier);
      }
    }

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

  // Lazily injected modal element (created once, reused per run)
  let upgradeModalEl = null;
  function ensureUpgradeModal() {
    if (upgradeModalEl) return upgradeModalEl;
    const m = document.createElement('div');
    m.id = 'upgradeModal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.innerHTML = `
      <div class="upgrade-sheet">
        <h2>CHOOSE AN UPGRADE</h2>
        <div class="subtle"></div>
        <div class="upgrade-cards"></div>
      </div>`;
    document.body.appendChild(m);
    upgradeModalEl = m;
    return m;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function maybeShowUpgrade() {
    if (state.picking || !state.running) return;
    const next = UPGRADE_THRESHOLDS[state.picksTaken];
    if (next === undefined || (state.score | 0) < next) return;

    // Filter to upgrades still under their max level
    const available = UPGRADE_POOL.filter(u => (state.upgrades[u.key] || 0) < u.maxLvl);
    if (available.length === 0) {
      // Everything maxed — silently skip and advance
      state.picksTaken++;
      return;
    }
    const picks = shuffle(available.slice()).slice(0, Math.min(3, available.length));
    showUpgradeModal(picks);
  }

  function showUpgradeModal(picks) {
    state.picking = true;
    const modal = ensureUpgradeModal();
    const cards = modal.querySelector('.upgrade-cards');
    const subtle = modal.querySelector('.subtle');
    subtle.textContent = `Pick ${state.picksTaken + 1} of ${UPGRADE_THRESHOLDS.length}`;
    cards.innerHTML = '';

    for (const u of picks) {
      const lvl = state.upgrades[u.key] || 0;
      const next = lvl + 1;
      const card = document.createElement('div');
      card.className = 'upgrade-card';
      card.innerHTML = `
        <div class="icon">${u.icon}</div>
        <div class="name">${u.name}</div>
        <div class="desc">${u.desc}</div>
        <div class="level">LV ${next} / ${u.maxLvl}</div>`;
      // Click → apply + close
      const onClick = () => {
        applyUpgrade(u.key);
        hideUpgradeModal();
      };
      card.addEventListener('click', onClick);
      cards.appendChild(card);
    }
    modal.classList.add('show');
  }

  function hideUpgradeModal(silent) {
    if (upgradeModalEl) upgradeModalEl.classList.remove('show');
    if (!silent) {
      state.picksTaken++;
      // Give the player a brief grace period before the next spawn
      state.spawnTimer = Math.max(state.spawnTimer, 0.9);
    }
    state.picking = false;
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
      const r = await fetch(`${SB_URL}?${params.toString()}`, { headers: SB_HEADERS });
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
  }

  function hideLeaderboard() {
    lb.modal.classList.remove('show');
  }

  function renderLeaderboard() {
    const mode = lb.modeSel.value;
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

    lb.table.innerHTML = '<tr><td colspan="5" style="opacity:.5; text-align:center; padding:18px;">Loading…</td></tr>';
    lb.info.textContent = 'Worldwide Top 10';

    fetch(`${SB_URL}?${params.toString()}`, { headers: SB_HEADERS })
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
      fetch(`${SB_URL}?${rankParams.toString()}`, {
        method: 'HEAD',
        headers: { ...SB_HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' }
      })
        .then(r => {
          const range = r.headers.get('content-range');
          if (!range) return;
          const total = parseInt(range.split('/')[1], 10);
          if (!isNaN(total)) {
            lb.userRank.textContent = `· Rank #${total + 1}`;
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
  ui.lbBtn.addEventListener('click', () => showLeaderboard());

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

  /* ====== Geolocation via IP ====== */
  let userCountry = 'XX'; // Default fallback
  
  async function detectUserLocation() {
    try {
      // Try ipapi.co first (free, no key required)
      const response = await fetch('https://ipapi.co/json/', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      
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
        const response = await fetch('https://ipinfo.io/json');
        if (response.ok) {
          const data = await response.json();
          if (data.country && data.country.length === 2) {
            userCountry = data.country.toUpperCase();
            return;
          }
        }
      } catch (e2) {
        // Final fallback - keep default 'XX'
        console.log('Could not detect location, using default');
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
    runFlags.firstSeen.clear();
    runFlags.firedLame.clear();
    fetchTopScoresForFlags();

    // Reset upgrades for the new run
    state.picking = false;
    state.picksTaken = 0;
    state.upgrades = {};
    state.timeWarpTimer = 0;
    state.magnet = false;
    state.rechargeInterval = 5;
    state.maxFireRounds = 3;
    state.fireRounds = state.maxFireRounds;
    hideUpgradeModal(true);
    
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

  ui.start.addEventListener('click', () => {
    initAudio();
    startGame(false);
  });
  ui.dailyBtn.addEventListener('click', () => {
    initAudio();
    startGame(true);
  });
  ui.btnResume.addEventListener('click', resumeGameUI);
  ui.btnPlayAgain.addEventListener('click', () => startGame(state.dailyMode));
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

    if (!state.running || state.paused || state.picking) {
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

  function drawEnemy(e) {
    // Spawn-in pop: subtle scale up over the first 0.18s of life
    const popScale = e.age < 0.18 ? 0.5 + 0.5 * (e.age / 0.18) : 1;
    const r = e.r * popScale;

    if (e.type === 'splitter') {
      ctx.save();
      // Pulsing aura
      const pulse = 0.85 + 0.15 * Math.sin(e.age * 6);
      ctx.shadowColor = '#e090ff';
      ctx.shadowBlur = 18 * pulse;
      ctx.fillStyle = '#a44ec0';
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * pulse, 0, Math.PI * 2);
      ctx.fill();
      // Internal cross — signals "I'll split"
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.x - r * 0.55, e.y); ctx.lineTo(e.x + r * 0.55, e.y);
      ctx.moveTo(e.x, e.y - r * 0.55); ctx.lineTo(e.x, e.y + r * 0.55);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (e.type === 'charger') {
      let core = '#9aa0a6', glow = '#cccccc', shadowBlur = 8;
      if (e.chargeState === 'aim')      { core = '#ff8866'; glow = '#ff8866'; shadowBlur = 18; }
      else if (e.chargeState === 'dash'){ core = '#ff3300'; glow = '#ff3300'; shadowBlur = 22; }

      // Telegraph line during aim — dashed, pulsing alpha
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

      ctx.save();
      ctx.fillStyle = core;
      ctx.shadowColor = glow;
      ctx.shadowBlur = shadowBlur;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Spike fins toward heading direction (or aim during aim)
      const heading = (e.chargeState === 'aim' || e.chargeState === 'dash')
        ? e.aimAng
        : Math.atan2(e.vy, e.vx);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(heading) * r,        e.y + Math.sin(heading) * r);
      ctx.lineTo(e.x + Math.cos(heading) * (r + 6),  e.y + Math.sin(heading) * (r + 6));
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (e.type === 'shielder') {
      ctx.save();
      // Body
      ctx.fillStyle = '#5a606e';
      ctx.shadowColor = '#9aaab8';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Cyan shield arc — additive glow
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#7af0ff';
      ctx.shadowColor = '#7af0ff';
      ctx.shadowBlur = 14;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r + 6,
        e.shieldArc - e.shieldHalfWidth,
        e.shieldArc + e.shieldHalfWidth);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (e.type === 'swarmer') {
      ctx.save();
      ctx.fillStyle = '#caff8c';
      ctx.shadowColor = '#caff8c';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (e.type === 'orbiter') {
      ctx.save();
      // Body (cool dark blue)
      ctx.fillStyle = '#3a4a78';
      ctx.shadowColor = '#88a0ff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Pink "eye" core that pulses faster as fire approaches
      const fireUrgency = e.orbitState === 'orbit'
        ? Math.max(0, 1 - (e.fireTimer || 0))
        : 0;
      const eyePulse = 0.7 + 0.3 * Math.abs(Math.sin(e.age * (4 + fireUrgency * 8)));
      ctx.fillStyle = '#ff6688';
      ctx.shadowColor = '#ff6688';
      ctx.shadowBlur = 8 * eyePulse;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 0.35 * eyePulse, 0, Math.PI * 2);
      ctx.fill();
      // Gun barrel pointing at player
      const ba = e.barrelAng || 0;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ff6688';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(ba) * (r * 0.5), e.y + Math.sin(ba) * (r * 0.5));
      ctx.lineTo(e.x + Math.cos(ba) * (r + 9),    e.y + Math.sin(ba) * (r + 9));
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.restore();
      return;
    }

    // grunt fallback (and splitter mini-grunts) — original speed-color dot, just respect popScale
    const fill = speedToColor(e.speed);
    ctx.save();
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.shadowColor = fill;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();
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
      ctx.globalAlpha = a;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
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

  function drawEnemyBullets() {
    if (enemyBullets.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const eb of enemyBullets) {
      // Outer glow
      ctx.fillStyle = '#ff5577';
      ctx.shadowColor = '#ff6688';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, eb.r, 0, Math.PI * 2);
      ctx.fill();
      // Hot core
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffccdd';
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, eb.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBackground() {
    // Solid base
    ctx.fillStyle = '#070710';
    ctx.fillRect(0, 0, W, H);

    const comboPulse = Math.min(state.combo / 30, 1);

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

    // Stars (parallax-ish twinkle)
    ctx.globalCompositeOperation = 'lighter';
    for (const s of stars) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(state.time * 1.5 + s.twinkle));
      ctx.globalAlpha = tw * 0.55;
      ctx.fillStyle = '#aaccff';
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Combo vignette
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

    // Enemies
    for (const e of enemies) drawEnemy(e);

    // Enemy projectiles (drawn under player bullets so player shots read on top)
    drawEnemyBullets();

    // Bullets (additive glow)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of bullets) {
      ctx.fillStyle = '#ffaa00';
      ctx.shadowColor = '#ffaa00';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      // Hot core
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff5cc';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Power-ups
    for (const p of powerups) {
      const pulse = 0.8 + 0.2 * Math.sin(p.pulsePhase);
      const alpha = Math.max(0.3, p.life / p.maxLife);

      ctx.save();
      ctx.globalAlpha = alpha;

      if (p.type === 'recharge') {
        ctx.fillStyle = '#88ffcc';
        ctx.shadowColor = '#88ffcc';
        ctx.shadowBlur = 18 * pulse;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡', p.x, p.y);
      } else if (p.type === 'multiplier') {
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 18 * pulse;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('x3', p.x, p.y);
      }
      ctx.restore();
    }

    // Player (with glowing halo)
    ctx.save();
    ctx.shadowColor = '#88ffcc';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#e6edf3';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Cursor reticle
    ctx.save();
    ctx.strokeStyle = '#88ffcc';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

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