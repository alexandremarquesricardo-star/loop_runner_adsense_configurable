(() => {
  console.log('Starting Loop Runner initialization...');
  
  const $ = (sel) => document.querySelector(sel);
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W=0, H=0, DPR=Math.min(devicePixelRatio||1,2);

  /* ====== layout sizing (ad-aware) ====== */
  function resize(){
    const spacer = document.getElementById('ad-spacer');
    const adH = (spacer && spacer.offsetHeight) || parseInt(getComputedStyle(document.documentElement).getPropertyValue('--adH')) || 0;
    W = innerWidth|0;
    H = Math.max(0, (innerHeight|0) - adH);
    canvas.width  = Math.max(1, W*DPR);
    canvas.height = Math.max(1, H*DPR);
    canvas.style.width = W+'px';
    canvas.style.height = H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  addEventListener('resize', resize);

  const topIns = document.getElementById('ad-top-unit');
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

  const spacer = document.getElementById('ad-spacer');
  const topWrap = document.getElementById('ad-top-wrapper');
  function updateAdVars(){
    const h = (topWrap && topWrap.offsetHeight) || parseInt(getComputedStyle(document.documentElement).getPropertyValue('--adCap')) || 0;
    spacer.style.height = h + 'px';
    document.documentElement.style.setProperty('--adH', h+'px');
    resize();
  }
  if('ResizeObserver' in window && topWrap){ new ResizeObserver(updateAdVars).observe(topWrap); } else { setTimeout(updateAdVars, 300); }

  /* ====== storage helpers ====== */
  function getLS(k, fallback){ try{ const v = localStorage.getItem(k); return v===null? fallback: v; }catch{ return fallback; } }
  function setLS(k, v){ try{ localStorage.setItem(k, v); }catch{} }

  /* ====== Real Location Detection ====== */
  let userCountry = null;
  let locationDetected = false;

  async function detectUserLocation() {
    if (locationDetected) return userCountry;
    
    try {
      console.log('Detecting user location...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://ipapi.co/json/', {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error('Location API failed');
      
      const data = await response.json();
      userCountry = data.country_code || 'XX';
      locationDetected = true;
      console.log('User location detected:', userCountry);
      return userCountry;
    } catch (error) {
      console.warn('Location detection failed:', error);
      userCountry = 'XX'; // Unknown location
      locationDetected = true;
      return userCountry;
    }
  }

  // Start location detection early
  detectUserLocation();

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
    // Enhanced stats
    enemiesKilled: 0, 
    bossesKilled: 0, 
    totalDashes: 0, 
    perfectDashes: 0,
    // Fire rounds system
    fireRounds: 3,
    maxFireRounds: 3,
    // Recharge system
    rechargeTimer: 0,
    rechargeInterval: 5.0, // 5 seconds per round
    isRecharging: false
  };

  /* ====== UI refs ====== */
  const ui = {
    score: $('#score'), 
    combo: $('#combo'), 
    best: $('#best'), 
    daily: $('#daily'),
    fireIndicator: $('#fireIndicator'),
    overlay: $('#overlay'),
    ovTitle: $('#overlayTitle'), 
    ovBody: $('#overlayBody'),
    start: $('#start'), 
    dailyBtn: $('#dailyBtn'),
    btnResume: $('#btnResume'), 
    btnPlayAgain: $('#btnPlayAgain'), 
    btnShare: $('#btnShare'),
    lbBtn: $('#lbBtn'), 
    nameInput: $('#nameInput'),
    restartBtn: $('#restartBtn'), 
    shareBtn: $('#shareBtn'),
    dailyBanner: $('#dailyBanner')
  };

  function updateFireIndicator() {
    const dots = ui.fireIndicator.querySelectorAll('.fire-dot');
    const rechargeProgress = state.isRecharging ? (1 - state.rechargeTimer / state.rechargeInterval) : 0;
    
    dots.forEach((dot, i) => {
      if (i < state.fireRounds) {
        dot.classList.add('active');
        dot.classList.remove('inactive');
        dot.style.opacity = '1';
      } else if (state.isRecharging && i === state.fireRounds) {
        // Show recharging dot with progress
        dot.classList.remove('active');
        dot.classList.add('inactive');
        dot.style.opacity = 0.3 + (rechargeProgress * 0.7);
        dot.style.background = `linear-gradient(to right, #88ffcc ${rechargeProgress * 100}%, #444 ${rechargeProgress * 100}%)`;
      } else {
        dot.classList.remove('active');
        dot.classList.add('inactive');
        dot.style.opacity = '1';
        dot.style.background = '#444';
      }
    });
    
    if (state.fireRounds === 0) {
      ui.fireIndicator.classList.add('empty');
    } else {
      ui.fireIndicator.classList.remove('empty');
    }
  }

  function hydrateHUD() { 
    ui.score.textContent = 'Score: 0'; 
    ui.combo.textContent = 'Combo: 0'; 
    ui.best.textContent = 'Best: ' + state.best; 
    ui.daily.textContent = 'Daily: ' + state.dailyBest;
    updateFireIndicator();
  }
  
  hydrateHUD();
  ui.dailyBanner.textContent = 'Daily Challenge: ' + new Date().toISOString().slice(0,10);

  /* ====== Pause/Resume helpers (overlay driven) ====== */
  function showOverlay() { ui.overlay.classList.add('visible'); }
  function hideOverlay() { ui.overlay.classList.remove('visible'); }

  function setOverlayHome() {
    ui.ovTitle.textContent = 'Loop Runner';
    ui.ovBody.innerHTML = 'Player follows your mouse cursor. <strong>Right-click to fire</strong> (3 rounds, auto-recharge). Chain kills to build combo. Catch power-ups for special abilities!';
    ui.btnResume.style.display = 'none';
    ui.btnPlayAgain.style.display = 'none';
    showOverlay();
  }
  
  function setOverlayPaused() {
    ui.ovTitle.textContent = 'Paused';
    ui.ovBody.innerHTML = 'Press <b>P</b> or <b>Esc</b> to resume';
    ui.btnResume.style.display = '';
    ui.btnPlayAgain.style.display = '';
    showOverlay();
  }
  
  function setOverlayGameOver(score, best, isPB) {
    ui.ovTitle.textContent = isPB ? 'New Best!' : 'Game Over';
    
    // Enhanced game over screen with stats
    const minutes = Math.floor(state.time / 60);
    const seconds = Math.floor(state.time % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    ui.ovBody.innerHTML = `
      <div style="text-align:center; margin-bottom:12px;">
        Score: <strong>${score}</strong> • Best: <strong>${best}</strong>${isPB?' • 🎉':''}
      </div>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${state.enemiesKilled}</div>
          <div class="stat-label">Enemies Killed</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${state.combo}</div>
          <div class="stat-label">Best Combo</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${state.bossesKilled}</div>
          <div class="stat-label">Bosses Killed</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${state.totalDashes}</div>
          <div class="stat-label">Total Dashes</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${state.perfectDashes}</div>
          <div class="stat-label">Perfect Dashes</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${timeStr}</div>
          <div class="stat-label">Game Time</div>
        </div>
      </div>
    `;
    ui.btnResume.style.display = 'none';
    ui.btnPlayAgain.style.display = '';
    showOverlay();
  }

  /* ====== RNG ====== */
  const todayKey = () => new Date().toISOString().slice(0,10);
  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t^t>>>15, t|1);
      t ^= t + Math.imul(t^t>>>7, t|61);
      return ((t^t>>>14)>>>0) / 4294967296;
    };
  }
  
  let seededRand = Math.random; 
  let usingSeed = false;
  
  function setDailySeed() { 
    usingSeed = true; 
    seededRand = mulberry32(hashToInt('looprunner:' + todayKey())); 
  }
  
  function rnd(a=0, b=1) { 
    return (usingSeed ? seededRand() : Math.random()) * (b-a) + a; 
  }
  
  function rndi(a, b) { 
    return Math.floor(rnd(a, b+1)); 
  }
  
  function hashToInt(str) { 
    let h = 2166136261>>>0; 
    for(let i=0; i<str.length; i++) { 
      h ^= str.charCodeAt(i); 
      h = Math.imul(h, 16777619); 
    } 
    return h>>>0; 
  }

  /* ====== Audio ====== */
  let audio, master;
  function initAudio() { 
    if(!audio) { 
      audio = new (window.AudioContext || window.webkitAudioContext)(); 
      master = audio.createGain(); 
      master.gain.value = 0.08; 
      master.connect(audio.destination); 
    } 
  }

  /* ====== Entities ====== */
  const player = { 
    x: W/2, 
    y: H/2, 
    r: 12, 
    vx: 0, 
    vy: 0, 
    maxSpeed: 900, 
    friction: 9, 
    dashing: false, 
    dashCooldown: 0, 
    dashWindup: 0 
  };
  
  const enemies = [];
  const particles = [];
  const bosses = [];
  const projectiles = [];
  const powerUps = [];
  const backgroundParticles = [];

  // Initialize background particles
  function initBackgroundParticles() {
    backgroundParticles.length = 0;
    for(let i = 0; i < 50; i++) {
      backgroundParticles.push({
        x: rnd(0, W),
        y: rnd(0, H),
        vx: rnd(-20, 20),
        vy: rnd(-20, 20),
        size: rnd(1, 3),
        alpha: rnd(0.1, 0.3),
        color: `hsl(${rnd(200, 280)}, 70%, 60%)`
      });
    }
  }

  function addParticle(x, y, size=2, life=0.4) { 
    const a = rnd(0, Math.PI*2); 
    const sp = rnd(40, 240); 
    particles.push({
      x, y, 
      vx: Math.cos(a)*sp, 
      vy: Math.sin(a)*sp, 
      life, 
      maxLife: life, 
      size
    }); 
  }

  function spawnEnemy() { 
    const m = 24; 
    const side = rndi(0, 3); 
    let x, y; 
    if(side === 0) { x = rnd(-m, W+m); y = -m; } 
    else if(side === 1) { x = W+m; y = rnd(-m, H+m); } 
    else if(side === 2) { x = rnd(-m, W+m); y = H+m; } 
    else { x = -m; y = rnd(-m, H+m); } 
    
    const r = rnd(14, 22); 
    const speed = rnd(40, 90) + Math.min(state.time*4, 220); 
    const ang = Math.atan2(player.y-y, player.x-x) + rnd(-0.5, 0.5); 
    const vx = Math.cos(ang)*speed;
    const vy = Math.sin(ang)*speed; 
    
    enemies.push({x, y, r, vx, vy, speed, ang}); 
  }

  function spawnBoss() {
    const m = 30;
    const side = rndi(0, 3);
    let x, y;
    if(side === 0) { x = rnd(-m, W+m); y = -m; }
    else if(side === 1) { x = W+m; y = rnd(-m, H+m); }
    else if(side === 2) { x = rnd(-m, W+m); y = H+m; }
    else { x = -m; y = rnd(-m, H+m); }
    
    const r = 35;
    const speed = rnd(30, 60) + Math.min(state.time * 2, 100);
    const ang = Math.atan2(player.y - y, player.x - x);
    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed;
    
    bosses.push({
      x, y, r, vx, vy, speed, ang,
      health: 5,
      maxHealth: 5,
      lastHit: 0
    });
  }

  function spawnPowerUp(type, x, y) {
    powerUps.push({
      x: x || rnd(50, W - 50),
      y: y || rnd(50, H - 50),
      type: type, // 'recharge' or 'multiplier'
      r: 15,
      life: 10.0, // 10 seconds to collect
      maxLife: 10.0,
      pulseTime: 0
    });
  }

  function spawnRandomPowerUp() {
    const types = ['recharge', 'multiplier'];
    const type = types[Math.floor(Math.random() * types.length)];
    spawnPowerUp(type);
  }
  function fireBurst() {
    console.log('Fire burst activated!');
    if(state.fireRounds <= 0) {
      console.log('No fire rounds left!');
      return; // No rounds left
    }
    
    state.fireRounds--;
    
    // Start recharging if we have less than max rounds
    if(state.fireRounds < state.maxFireRounds && !state.isRecharging) {
      state.isRecharging = true;
      state.rechargeTimer = state.rechargeInterval;
    }
    
    updateFireIndicator();
    console.log('Fire rounds remaining:', state.fireRounds);
    
    const projectileCount = 10;
    for(let i = 0; i < projectileCount; i++) {
      const angle = (i / projectileCount) * Math.PI * 2;
      const speed = 400;
      projectiles.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 2.0,
        maxLife: 2.0,
        size: 4
      });
    }
    
    // Add burst effect particles
    for(let i = 0; i < 20; i++) {
      addParticle(player.x, player.y, rnd(2, 5), rnd(0.3, 0.6));
    }
  }

  /* ====== Input ====== */
  let pointer = { x: W/2, y: H/2, down: false };

  function screenToWorld(e) { 
    const rect = canvas.getBoundingClientRect(); 
    return { x: (e.clientX-rect.left), y: (e.clientY-rect.top) }; 
  }

  function startDashTowards(px, py) { 
    if(player.dashCooldown > 0) return; 
    const dx = px - player.x;
    const dy = py - player.y; 
    const len = Math.hypot(dx, dy) || 1; 
    const ux = dx / len;
    const uy = dy / len; 
    player.vx = ux * player.maxSpeed; 
    player.vy = uy * player.maxSpeed; 
    player.dashing = true; 
    player.dashCooldown = 0.35; 
    player.dashWindup = 0.12; 
    state.totalDashes++;
    
    // Check for perfect dash (hitting enemy immediately)
    let hitEnemy = false;
    for(const e of enemies) {
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if(d < e.r + player.r + 20) {
        hitEnemy = true;
        break;
      }
    }
    if(hitEnemy) state.perfectDashes++;
    
    for(let i=0; i<10; i++) addParticle(player.x, player.y, 3, 0.25); 
  }

  // Mouse controls
  canvas.addEventListener('pointerdown', (e) => {
    initAudio();
    if(e.button === 2) { // Right click
      e.preventDefault();
      fireBurst();
    }
  });

  canvas.addEventListener('pointermove', (e) => { 
    const p = screenToWorld(e); 
    pointer.x = p.x; 
    pointer.y = p.y; 
  });

  canvas.addEventListener('pointerup', () => { 
    pointer.down = false; 
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault(); // Prevent context menu
  });

  // Keyboard controls
  addEventListener('keydown', (e) => {
    if(e.repeat) return;
    
    // Fire burst
    if(e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      fireBurst();
      return;
    }
    
    if(e.code === 'Space') { 
      if(!state.running) { 
        e.preventDefault(); 
        startGame(state.dailyMode); 
        return; 
      } 
    }
    if(e.key === 'r' || e.key === 'R') { 
      e.preventDefault(); 
      startGame(state.dailyMode); 
      return; 
    }
    if(e.key === 'p' || e.key === 'P' || e.key === 'Escape') { 
      e.preventDefault(); 
      if(state.running) { 
        if(!state.paused) pauseGameUI(); 
        else resumeGameUI(); 
      } 
      return; 
    }
    
    // Arrow key dashing
    const amt = 80; 
    if(e.key && e.key.indexOf('Arrow') === 0) { 
      let dx = 0, dy = 0; 
      if(e.key === 'ArrowUp') dy = -amt; 
      else if(e.key === 'ArrowDown') dy = amt; 
      else if(e.key === 'ArrowLeft') dx = -amt; 
      else if(e.key === 'ArrowRight') dx = amt; 
      startDashTowards(player.x + dx, player.y + dy);
    }
  });

  addEventListener('blur', () => { 
    if(state.running && !state.paused) pauseGameUI(); 
  });

  /* ====== Leaderboard ====== */
  const lb = { 
    modal: $('#lbModal'), 
    close: $('#lbClose'), 
    modeSel: $('#lbMode'), 
    info: $('#lbInfo'), 
    table: $('#lbTable').querySelector('tbody') 
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

  const SB_URL = 'https://zpoerliqhcywaulbthyf.supabase.co/rest/v1/scores';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpwb2VybGlxaGN5d2F1bGJ0aHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyMDQxNjYsImV4cCI6MjA3Mzc4MDE2Nn0.7jjITj1H2AxWPnCeyzmMsNw3uAVACoYb_CV5rRoD65k';
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

  function getMotivationalWord(rank) {
    // This function now takes rank but we'll override it with score-based words
    return 'PLAYER'; // Fallback, will be overridden
  }

  function getScoreBasedMotivationalWord(score) {
    if (score >= 1000) {
      // High scores get very positive words
      const highWords = [
        'LEGEND!', 'CHAMPION!', 'MASTER!', 'HERO!', 'WARRIOR!',
        'ELITE!', 'CRUSHER!', 'BEAST!', 'DOMINATOR!', 'UNSTOPPABLE!'
      ];
      return highWords[Math.floor(Math.random() * highWords.length)];
    } else {
      // Lower scores get less positive words
      const lowWords = [
        'Trying', 'Learning', 'Rookie', 'Beginner', 'Starter',
        'Newbie', 'Amateur', 'Casual', 'Practice', 'Getting There'
      ];
      return lowWords[Math.floor(Math.random() * lowWords.length)];
    }
  }

  function getRandomTimeAgo() {
    const options = ['now', '1m ago', '2m ago', '5m ago', '12m ago', '1h ago', '2h ago', '5h ago', '1d ago', '2d ago', '3d ago'];
    return options[Math.floor(Math.random() * options.length)];
  }

  function getRandomCountry() {
    const countries = [
      'US', 'UK', 'CA', 'AU', 'DE', 'FR', 'JP', 'KR', 'BR', 'MX',
      'IT', 'ES', 'NL', 'SE', 'NO', 'DK', 'FI', 'PL', 'RU', 'IN',
      'CN', 'SG', 'MY', 'TH', 'PH', 'ID', 'VN', 'TW', 'HK', 'NZ'
    ];
    return countries[Math.floor(Math.random() * countries.length)];
  }

  function renderLeaderboard() {
    const mode = lb.modeSel.value;
    const params = new URLSearchParams();
    params.append('select', 'name,score,created_at,country,mode');
    params.append('order', 'score.desc');
    params.append('limit', '10');
    
    // Filter by mode
    if (mode === 'daily') {
      params.append('mode', 'eq.daily');
    } else {
      params.append('mode', 'eq.normal');
    }

    lb.table.innerHTML = '';
    lb.info.textContent = mode === 'daily' ? 'Daily Challenge Top 10' : 'Worldwide Top 10';

    console.log('Fetching leaderboard from:', `${SB_URL}?${params.toString()}`);

    fetch(`${SB_URL}?${params.toString()}`, { headers: SB_HEADERS })
      .then(res => { 
        console.log('Leaderboard response status:', res.status);
        if (!res.ok) throw new Error('REST ' + res.status); 
        return res.json(); 
      })
      .then(rows => {
        console.log('Leaderboard data received:', rows);
        rows.slice(0, 10).forEach((e, i) => {
          const tr = document.createElement('tr');
          const motivationalWord = getScoreBasedMotivationalWord(e.score || 0);
          const timeAgo = getRandomTimeAgo();
          const country = e.country || 'XX'; // Use real country from database
          
          tr.innerHTML = `
            <td>${i+1}</td>
            <td>${escapeHtml(e.name||'anon')}</td>
            <td>${e.score|0}</td>
            <td style="color:#88ffcc; font-weight:bold;">${motivationalWord}</td>
            <td style="opacity:.8">${timeAgo}</td>
            <td style="opacity:.8">${country}</td>
          `;
          lb.table.appendChild(tr);
        });
        if (rows.length === 0) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="6" style="opacity:.7;">No scores yet. Be the first!</td>';
          lb.table.appendChild(tr);
        }
      })
      .catch((error) => {
        console.error('Leaderboard fetch failed:', error);
        // Fallback to local storage
        const key = mode === 'daily' ? ('lr_daily_scores_' + todayKey()) : 'lr_normal_scores';
        const arr = loadLB(key);
        lb.info.textContent += ' • offline';
        lb.table.innerHTML = '';
        arr.slice(0, 10).forEach((e, i) => {
          const tr = document.createElement('tr');
          const motivationalWord = getScoreBasedMotivationalWord(e.score || 0);
          const timeAgo = getRandomTimeAgo();
          const country = getRandomCountry();
          
          tr.innerHTML = `
            <td>${i+1}</td>
            <td>${escapeHtml(e.name)}</td>
            <td>${e.score}</td>
            <td style="color:#88ffcc; font-weight:bold;">${motivationalWord}</td>
            <td style="opacity:.8">${timeAgo}</td>
            <td style="opacity:.8">${country}</td>
          `;
          lb.table.appendChild(tr);
        });
        if (arr.length === 0) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="6" style="opacity:.7;">No scores yet. Play a run!</td>';
          lb.table.appendChild(tr);
        }
      });
  }
  
  function escapeHtml(s) { 
    return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); 
  }
  
  lb.close.addEventListener('click', hideLeaderboard);
  lb.modeSel.addEventListener('change', renderLeaderboard);
  ui.lbBtn.addEventListener('click', () => showLeaderboard());

  let modalAdFilled = false;
  function maybeFillModalAd() {
    if(modalAdFilled) return;
    const ins = document.getElementById('ad-modal-unit');
    if(!ins) return;
    const w = ins.clientWidth;
    if(w && w > 0) { 
      (window.adsbygoogle = window.adsbygoogle || []).push({}); 
      modalAdFilled = true; 
    } else { 
      setTimeout(maybeFillModalAd, 200); 
    }
  }

  /* ====== Share (overlay + quickbar) ====== */
  async function doShare() {
    const url = location.href;
    const text = `I just played Loop Runner and scored ${state.score|0}!`;
    try {
      if (navigator.share) { 
        await navigator.share({ title: 'Loop Runner', text, url }); 
      } else {
        await navigator.clipboard.writeText(url);
        alert('Link copied to clipboard!');
      }
    } catch(e) { 
      /* user cancelled */ 
    }
  }

  /* ====== Game control ====== */
  function startGame(daily = false) {
    state.running = true; 
    state.paused = false; 
    state.time = 0; 
    state.score = 0; 
    state.combo = 0; 
    state.spawnTimer = 0; 
    state.spawnInterval = 1.1; 
    state.enemiesKilled = 0;
    state.bossesKilled = 0;
    state.totalDashes = 0;
    state.perfectDashes = 0;
    state.fireRounds = 3;
    state.rechargeTimer = 0;
    state.isRecharging = false;
    enemies.length = 0; 
    particles.length = 0; 
    bosses.length = 0;
    projectiles.length = 0;
    powerUps.length = 0;
    player.x = W/2; 
    player.y = H/2; 
    player.vx = 0; 
    player.vy = 0; 
    player.dashing = false; 
    player.dashCooldown = 0; 
    player.dashWindup = 0; 
    hydrateHUD(); 
    state.dailyMode = daily; 
    usingSeed = false; 
    if(daily) setDailySeed(); 
    initBackgroundParticles();
    hideOverlay();
  }
  
  function gameOver() {
    state.running = false; 
    state.paused = false;
    const score = state.score|0;
    let isPB = false;
    if(state.dailyMode) { 
      if(score > state.dailyBest) { 
        state.dailyBest = score; 
        setLS('lr_daily', state.dailyBest); 
        isPB = true; 
      } 
    } else { 
      if(score > state.best) { 
        state.best = score; 
        setLS('lr_best', state.best); 
        isPB = true; 
      } 
    }
    hydrateHUD();
    setOverlayGameOver(score, state.dailyMode ? state.dailyBest : state.best, isPB);
    submitScore();
    showLeaderboard(state.dailyMode ? 'daily' : 'normal');
    if (isPB) setTimeout(() => { try { doShare(); } catch {} }, 450);
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
    const name = (ui.nameInput.value || getLS('lr_name', 'Player')).slice(0, 20).trim() || 'Player';
    setLS('lr_name', name);
    
    // Ensure we have location before submitting
    await detectUserLocation();
    
    console.log('Submitting score:', state.score, 'for player:', name);
    
    try {
      const body = { 
        name: name.slice(0, 12), 
        score: state.score|0, 
        mode: (state.dailyMode ? 'daily' : 'normal'),
        country: userCountry || 'XX'
      };
      
      console.log('Score submission body:', body);
      
      fetch(SB_URL, { 
        method: 'POST', 
        headers: { ...SB_HEADERS, Prefer: 'return=minimal' }, 
        body: JSON.stringify(body) 
      })
        .then(async r => { 
          console.log('Score submission response:', r.status);
          if(!r.ok) { 
            let txt = ''; 
            try { txt = await r.text(); } catch {} 
            console.error('Supabase insert failed', r.status, txt); 
          } else {
            console.log('Score submitted successfully!');
          } 
        })
        .catch(err => console.error('Supabase insert network error', err));
    } catch(err) { 
      console.error('submitScore exception', err); 
    }
    
    // Also save locally as backup
    const localKey = state.dailyMode ? ('lr_daily_scores_' + todayKey()) : 'lr_normal_scores';
    const localScores = loadLB(localKey);
    localScores.push({
      name: name.slice(0, 12),
      score: state.score|0,
      mode: state.dailyMode ? 'daily' : 'normal',
      when: new Date().toISOString()
    });
    localScores.sort((a, b) => b.score - a.score);
    saveLB(localKey, localScores.slice(0, 50)); // Keep top 50 locally
  }

  ui.start.addEventListener('click', () => { initAudio(); startGame(false); });
  ui.dailyBtn.addEventListener('click', () => { initAudio(); startGame(true); });
  ui.btnResume.addEventListener('click', resumeGameUI);
  ui.btnPlayAgain.addEventListener('click', () => startGame(state.dailyMode));
  ui.btnShare.addEventListener('click', doShare);
  ui.restartBtn.addEventListener('click', () => startGame(state.dailyMode));
  ui.shareBtn.addEventListener('click', doShare);

  /* ====== Loop ====== */
  let last = performance.now();
  function loop() {
    requestAnimationFrame(loop);
    const t = performance.now(); 
    let dt = (t - last) / 1000; 
    last = t;
    if(!state.running || state.paused) { 
      render(); 
      return; 
    }
    state.time += dt; 
    state.score += dt * 10; 
    if(((state.score|0) % 10) === 0) ui.score.textContent = `Score: ${state.score|0}`;

    update(dt); 
    render();
  }

  function update(dt) {
    // Update recharge system
    if(state.isRecharging && state.fireRounds < state.maxFireRounds) {
      state.rechargeTimer -= dt;
      if(state.rechargeTimer <= 0) {
        state.fireRounds++;
        console.log('Fire round recharged! Now have:', state.fireRounds);
        
        if(state.fireRounds < state.maxFireRounds) {
          // Continue recharging
          state.rechargeTimer = state.rechargeInterval;
        } else {
          // Fully recharged
          state.isRecharging = false;
          state.rechargeTimer = 0;
        }
        updateFireIndicator();
      } else {
        // Update visual progress
        updateFireIndicator();
      }
    }
    
    // Update player to follow mouse
    const dx = pointer.x - player.x;
    const dy = pointer.y - player.y;
    const followSpeed = 300;
    player.vx = dx * followSpeed * dt;
    player.vy = dy * followSpeed * dt;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    
    // Keep player in bounds
    player.x = Math.max(player.r, Math.min(W - player.r, player.x));
    player.y = Math.max(player.r, Math.min(H - player.r, player.y));

    // Spawn enemies
    state.spawnTimer -= dt; 
    if(state.spawnTimer <= 0) { 
      spawnEnemy(); 
      state.spawnTimer = state.spawnInterval; 
    }

    // Spawn bosses occasionally
    if(Math.random() < 0.001 && state.time > 10) {
      spawnBoss();
    }

    // Spawn power-ups occasionally
    if(Math.random() < 0.0008 && state.time > 5) {
      spawnRandomPowerUp();
    }

    // Update power-ups
    for(let i = 0; i < powerUps.length; i++) {
      const p = powerUps[i];
      p.life -= dt;
      p.pulseTime += dt;
      
      if(p.life <= 0) {
        powerUps.splice(i, 1);
        i--;
        continue;
      }
      
      // Check collision with player
      const d = Math.hypot(p.x - player.x, p.y - player.y);
      if(d < p.r + player.r) {
        // Collected power-up!
        if(p.type === 'recharge') {
          // Instantly recharge all fire rounds
          state.fireRounds = state.maxFireRounds;
          state.isRecharging = false;
          state.rechargeTimer = 0;
          updateFireIndicator();
          console.log('Fire rounds recharged!');
          
          // Add recharge particles
          for(let k = 0; k < 20; k++) {
            addParticle(p.x, p.y, rnd(2, 5), rnd(0.4, 0.8));
          }
        } else if(p.type === 'multiplier') {
          // Multiply current score by 3
          const oldScore = state.score;
          state.score *= 3;
          ui.score.textContent = `Score: ${state.score|0}`;
          console.log(`Score multiplied! ${oldScore|0} → ${state.score|0}`);
          
          // Add multiplier particles
          for(let k = 0; k < 30; k++) {
            addParticle(p.x, p.y, rnd(3, 6), rnd(0.5, 1.0));
          }
        }
        
        powerUps.splice(i, 1);
        i--;
      }
    }
    // Update projectiles
    for(let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      
      if(p.life <= 0 || p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > H + 50) {
        projectiles.splice(i, 1);
        i--;
        continue;
      }
      
      // Check projectile vs enemies
      for(let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if(d < p.size + e.r) {
          // Hit enemy
          enemies.splice(j, 1);
          projectiles.splice(i, 1);
          i--;
          state.enemiesKilled++;
          state.score += 50;
          ui.score.textContent = `Score: ${state.score|0}`;
          
          // Add hit particles
          for(let k = 0; k < 15; k++) {
            addParticle(e.x, e.y, rnd(2, 4), rnd(0.2, 0.5));
          }
          break;
        }
      }
      
      // Check projectile vs bosses
      for(let j = 0; j < bosses.length; j++) {
        const b = bosses[j];
        const d = Math.hypot(p.x - b.x, p.y - b.y);
        if(d < p.size + b.r) {
          // Hit boss
          projectiles.splice(i, 1);
          i--;
          b.health--;
          b.lastHit = state.time;
          
          if(b.health <= 0) {
            bosses.splice(j, 1);
            state.bossesKilled++;
            state.score += 200;
            ui.score.textContent = `Score: ${state.score|0}`;
            
            // Big explosion
            for(let k = 0; k < 30; k++) {
              addParticle(b.x, b.y, rnd(3, 6), rnd(0.4, 0.8));
            }
          } else {
            // Hit particles
            for(let k = 0; k < 8; k++) {
              addParticle(b.x, b.y, rnd(2, 4), rnd(0.2, 0.4));
            }
          }
          break;
        }
      }
    }

    // Update enemies
    for(let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const ang = Math.atan2(player.y - e.y, player.x - e.x); 
      e.vx = Math.cos(ang) * e.speed; 
      e.vy = Math.sin(ang) * e.speed; 
      e.ang = Math.atan2(e.vy, e.vx); 
      e.x += e.vx * dt; 
      e.y += e.vy * dt;
      
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if(d < e.r + player.r) {
        gameOver(); 
        break;
      }
      if(e.x < -100 || e.x > W + 100 || e.y < -100 || e.y > H + 100) { 
        enemies.splice(i, 1); 
        i--; 
      }
    }

    // Update bosses
    for(let i = 0; i < bosses.length; i++) {
      const b = bosses[i];
      const ang = Math.atan2(player.y - b.y, player.x - b.x);
      b.vx = Math.cos(ang) * b.speed;
      b.vy = Math.sin(ang) * b.speed;
      b.ang = Math.atan2(b.vy, b.vx);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      
      const d = Math.hypot(b.x - player.x, b.y - player.y);
      if(d < b.r + player.r) {
        gameOver();
        break;
      }
      if(b.x < -100 || b.x > W + 100 || b.y < -100 || b.y > H + 100) {
        bosses.splice(i, 1);
        i--;
      }
    }

    // Update particles
    for(let i = 0; i < particles.length; i++) { 
      const p = particles[i]; 
      p.life -= dt; 
      p.x += p.vx * dt; 
      p.y += p.vy * dt; 
      p.vx *= 0.98; 
      p.vy *= 0.98; 
      if(p.life <= 0) { 
        particles.splice(i, 1); 
        i--; 
      } 
    }

    // Update background particles
    for(let i = 0; i < backgroundParticles.length; i++) {
      const p = backgroundParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      
      // Wrap around screen
      if(p.x < 0) p.x = W;
      if(p.x > W) p.x = 0;
      if(p.y < 0) p.y = H;
      if(p.y > H) p.y = 0;
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
    if(t < 0.5) {
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

  function drawBoss(b) {
    ctx.save();
    
    // Flash red when hit recently
    const timeSinceHit = state.time - b.lastHit;
    const isFlashing = timeSinceHit < 0.2;
    
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = isFlashing ? '#ff4444' : '#ff8844';
    ctx.shadowColor = '#ff8844';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
    
    // Health bar
    const barWidth = b.r * 2;
    const barHeight = 6;
    const barX = b.x - barWidth / 2;
    const barY = b.y - b.r - 15;
    
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    
    // Health
    const healthPercent = b.health / b.maxHealth;
    ctx.fillStyle = healthPercent > 0.5 ? '#44ff44' : healthPercent > 0.25 ? '#ffff44' : '#ff4444';
    ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
    
    ctx.restore();
  }
  
  function render() {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    
    // Draw background particles
    for(const p of backgroundParticles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    }
    
    // Draw projectiles
    for(const p of projectiles) {
      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = '#88ffcc';
      ctx.shadowColor = '#88ffcc';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.restore();
    }
    
    // Draw particles
    for(const p of particles) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = '#8fb3ff';
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    
    // Draw enemies
    for(const e of enemies) { 
      drawDot(e); 
    }
    
    // Draw bosses
    for(const b of bosses) { 
      drawBoss(b); 
    }
    
    // Draw player
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fillStyle = '#e6edf3';
    ctx.shadowColor = '#88ffcc';
    ctx.shadowBlur = 8;
    ctx.fill();
    
    ctx.restore();
  }

  /* ====== Modal close-click ====== */
  document.getElementById('lbModal').addEventListener('click', (e) => { 
    if(e.target.id === 'lbModal') e.currentTarget.classList.remove('show'); 
  });

  /* ====== Boot ====== */
  resize();
  requestAnimationFrame(function loopStart() { 
    requestAnimationFrame(loop); 
  });
  setOverlayHome();
})();