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
    rechargeInterval: 5
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
  }
  hydrateHUD();
  ui.dailyBanner.textContent = 'Daily Challenge: ' + new Date().toISOString().slice(0,10);

  /* ====== Pause/Resume helpers (overlay driven) ====== */
  function showOverlay(){ ui.overlay.classList.add('visible'); }
  function hideOverlay(){ ui.overlay.classList.remove('visible'); }

  function setOverlayHome(){
    ui.ovTitle.textContent = 'Loop Runner';
    ui.ovBody.textContent = 'Player follows your mouse cursor. Right-click to fire (3 rounds, auto-recharge). Chain kills to build combo. Catch power-ups for special abilities!';
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
  function setOverlayGameOver(score, best, isPB){
    ui.ovTitle.textContent = isPB ? 'New Best!' : 'Game Over';
    ui.ovBody.innerHTML = `Score: <b>${score}</b> • Best: <b>${best}</b>${isPB?' • 🎉':''}`;
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
  function initAudio(){ if(!audio){ audio=new (window.AudioContext||window.webkitAudioContext)(); master=audio.createGain(); master.gain.value=0.08; master.connect(audio.destination); } }

  /* ====== Entities ====== */
  const player = { x: W/2, y: H/2, r: 12, vx: 0, vy: 0, maxSpeed: 400, friction: 8 };
  const enemies = [];
  const bullets = [];
  const particles = [];
  const powerups = [];

  function addParticle(x, y, color = '#8fb3ff', size = 2, life = 0.4) {
    const a = rnd(0, Math.PI * 2);
    const sp = rnd(40, 240);
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life, maxLife: life, size, color
    });
  }

  function spawnEnemy() {
    const m = 24;
    const side = rndi(0, 3);
    let x, y;
    if (side === 0) { x = rnd(-m, W + m); y = -m; }
    else if (side === 1) { x = W + m; y = rnd(-m, H + m); }
    else if (side === 2) { x = rnd(-m, W + m); y = H + m; }
    else { x = -m; y = rnd(-m, H + m); }
    
    const r = rnd(14, 22);
    const speed = rnd(40, 90) + Math.min(state.time * 4, 220);
    const ang = Math.atan2(player.y - y, player.x - x) + rnd(-0.5, 0.5);
    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed;
    
    enemies.push({ x, y, r, vx, vy, speed, ang });
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
    
    state.fireRounds--;
    updateFireIndicator();
    
    const dx = mouse.x - player.x;
    const dy = mouse.y - player.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    
    bullets.push({
      x: player.x,
      y: player.y,
      vx: ux * 600,
      vy: uy * 600,
      r: 4,
      life: 2
    });
    
    // Add muzzle flash particles
    for (let i = 0; i < 8; i++) {
      addParticle(mouse.x, mouse.y, '#ffaa00', 3, 0.3);
    }
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

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') {
      if (!state.running) {
        e.preventDefault();
        startGame(state.dailyMode);
        return;
      }
    }
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      startGame(state.dailyMode);
      return;
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

  function renderLeaderboard() {
    const mode = lb.modeSel.value;
    const params = new URLSearchParams();
    params.append('select', 'name,score,country,created_at');
    params.append('order', 'score.desc');
    params.append('limit', '10');

    lb.table.innerHTML = '';
    lb.info.textContent = 'Worldwide Top 10';

    fetch(`${SB_URL}?${params.toString()}`, { headers: SB_HEADERS })
      .then(res => {
        if (!res.ok) throw new Error('REST ' + res.status);
        return res.json();
      })
      .then(rows => {
        rows.slice(0, 10).forEach((e, i) => {
          const tr = document.createElement('tr');
          const status = getMotivationalStatus(e.score);
          const statusColor = (e.score >= 1000) ? '#88ffcc' : '#ff6b6b';
          tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(e.name)}</td><td>${e.score}</td><td style="color:${statusColor}; font-weight:bold;">${status}</td><td>${e.country || 'XX'}</td>`;
          lb.table.appendChild(tr);
        });
        if (rows.length === 0) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="5" style="opacity:.7;">No scores yet. Be the first!</td>';
          lb.table.appendChild(tr);
        }
      })
      .catch(() => {
        const key = mode === 'daily' ? ('lr_lb_daily_' + todayKey()) : 'lr_lb_normal';
        const arr = loadLB(key);
        arr.slice(0, 10).forEach((e, i) => {
          const tr = document.createElement('tr');
          const status = getMotivationalStatus(e.score);
          const statusColor = (e.score >= 1000) ? '#88ffcc' : '#ff6b6b';
          tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(e.name)}</td><td>${e.score}</td><td style="color:${statusColor}; font-weight:bold;">${status}</td><td>Local</td>`;
          lb.table.appendChild(tr);
        });
        if (arr.length === 0) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="5" style="opacity:.7;">No scores yet. Be the first!</td>';
          lb.table.appendChild(tr);
        }
        lb.info.textContent += ' • offline';
      });
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
    
    player.x = W / 2;
    player.y = H / 2;
    player.vx = 0;
    player.vy = 0;
    
    hydrateHUD();
    state.dailyMode = daily;
    usingSeed = false;
    if (daily) setDailySeed();
    hideOverlay();
  }

  function gameOver() {
    state.running = false;
    state.paused = false;
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
    setOverlayGameOver(score, state.dailyMode ? state.dailyBest : state.best, isPB);
    submitScore();
    showLeaderboard(state.dailyMode ? 'daily' : 'normal');
    
    if (isPB) {
      setTimeout(() => {
        try {
          doShare();
        } catch {}
      }, 450);
    }
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
    
    try {
      const body = {
        name: name.slice(0, 12),
        score: state.score | 0,
        mode: (state.dailyMode ? 'daily' : 'normal'),
        country: 'XX'
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
  ui.restartBtn.addEventListener('click', () => startGame(state.dailyMode));
  ui.shareBtn.addEventListener('click', doShare);

  /* ====== Loop ====== */
  let last = performance.now();
  let powerupSpawnTimer = 0;

  function loop() {
    requestAnimationFrame(loop);
    const t = performance.now();
    let dt = (t - last) / 1000;
    last = t;
    
    if (!state.running || state.paused) {
      render();
      return;
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

    // Spawn enemies
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnEnemy();
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

    // Update bullets
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      
      if (b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H) {
        bullets.splice(i, 1);
        i--;
      }
    }

    // Update enemies
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const ang = Math.atan2(player.y - e.y, player.x - e.x);
      e.vx = Math.cos(ang) * e.speed;
      e.vy = Math.sin(ang) * e.speed;
      e.ang = Math.atan2(e.vy, e.vx);
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // Check collision with player
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < e.r + player.r) {
        gameOver();
        break;
      }

      // Check collision with bullets
      for (let j = 0; j < bullets.length; j++) {
        const b = bullets[j];
        const bd = Math.hypot(b.x - e.x, b.y - e.y);
        if (bd < b.r + e.r) {
          // Hit!
          bullets.splice(j, 1);
          enemies.splice(i, 1);
          i--;
          j--;
          
          state.combo += 1;
          const add = Math.floor(10 * Math.pow(1.4, state.combo - 1));
          state.score += add;
          ui.combo.textContent = `Combo: ${state.combo}`;
          ui.score.textContent = `Score: ${state.score | 0}`;
          
          // Add explosion particles
          for (let k = 0; k < 12; k++) {
            addParticle(e.x, e.y, '#ff6666', Math.random() * 3 + 2, Math.random() * 0.4 + 0.3);
          }
          break;
        }
      }

      // Remove enemies that are too far away
      if (e.x < -100 || e.x > W + 100 || e.y < -100 || e.y > H + 100) {
        enemies.splice(i, 1);
        i--;
      }
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
      
      // Check collision with player
      const d = Math.hypot(p.x - player.x, p.y - player.y);
      if (d < p.r + player.r) {
        // Collected!
        if (p.type === 'recharge') {
          state.fireRounds = state.maxFireRounds;
          state.rechargeTimer = 0;
          updateFireIndicator();
          
          // Blue particles
          for (let k = 0; k < 20; k++) {
            addParticle(p.x, p.y, '#88ffcc', Math.random() * 4 + 2, Math.random() * 0.6 + 0.4);
          }
        } else if (p.type === 'multiplier') {
          state.score *= 3;
          ui.score.textContent = `Score: ${state.score | 0}`;
          
          // Gold particles
          for (let k = 0; k < 20; k++) {
            addParticle(p.x, p.y, '#ffd700', Math.random() * 4 + 2, Math.random() * 0.6 + 0.4);
          }
        }
        
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

  function render() {
    ctx.save();
    ctx.clearRect(0, 0, W, H);

    // Draw particles
    for (const p of particles) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Draw enemies
    for (const e of enemies) {
      drawDot(e);
    }

    // Draw bullets
    ctx.fillStyle = '#ffaa00';
    ctx.shadowColor = '#ffaa00';
    ctx.shadowBlur = 6;
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Draw power-ups
    for (const p of powerups) {
      const pulse = 0.8 + 0.2 * Math.sin(p.pulsePhase);
      const alpha = Math.max(0.3, p.life / p.maxLife);
      
      ctx.save();
      ctx.globalAlpha = alpha;
      
      if (p.type === 'recharge') {
        // Blue recharge power-up
        ctx.fillStyle = '#88ffcc';
        ctx.shadowColor = '#88ffcc';
        ctx.shadowBlur = 12 * pulse;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
        ctx.fill();
        
        // Lightning symbol
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡', p.x, p.y);
      } else if (p.type === 'multiplier') {
        // Gold multiplier power-up
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 12 * pulse;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
        ctx.fill();
        
        // x3 text
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('x3', p.x, p.y);
      }
      
      ctx.restore();
    }

    // Draw player
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fillStyle = '#e6edf3';
    ctx.shadowColor = '#88ffcc';
    ctx.shadowBlur = 8;
    ctx.fill();
    
    // Draw cursor indicator
    ctx.save();
    ctx.strokeStyle = '#88ffcc';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
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