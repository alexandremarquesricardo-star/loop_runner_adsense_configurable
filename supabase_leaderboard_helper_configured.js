
/**
 * Playloop / Loop Runner — Supabase Leaderboard Helper
 * Drop this <script> AFTER your game code and AFTER the Supabase client script.
 * Fill in SUPABASE_URL and SUPABASE_ANON_KEY below.
 */

// 1) ---- REQUIRED: your Supabase credentials ----
const SUPABASE_URL = "https://zpoerliqhcywaulbthyf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpwb2VybGlxaGN5d2F1bGJ0aHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyMDQxNjYsImV4cCI6MjA3Mzc4MDE2Nn0.7jjITj1H2AxWPnCeyzmMsNw3uAVACoYb_CV5rRoD65k";

// 2) ---- Init client (safe to do on the public web; anon key is designed for client use) ----
let supabaseClient = null;
try {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { "x-client-info": "playloop-leaderboard/1.0" } }
  });
} catch (e) {
  console.warn("[Playloop] Supabase init failed; falling back to local scores.", e);
}

// 3) ---- Helpers ----
const TABLE = "scores";                      // Supabase table name
const TODAY = () => new Date().toISOString().slice(0,10); // YYYY-MM-DD

const ui = {
  nameInput: document.getElementById("nameInput"),
  lbBtn: document.getElementById("lbBtn"),
  lbModal: document.getElementById("lbModal"),
  lbClose: document.getElementById("lbClose"),
  lbMode: document.getElementById("lbMode"),
  lbTable: document.getElementById("lbTable")?.querySelector("tbody"),
  lbInfo: document.getElementById("lbInfo"),
  best: document.getElementById("best"),
  daily: document.getElementById("daily"),
};

// 4) ---- Local fallback storage (device-only) ----
const LOCAL_KEY = "playloop_local_scores";
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch { return []; }
}
function saveLocal(entry) {
  const arr = loadLocal();
  arr.push(entry);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(arr));
}

// 5) ---- API: submit score ----
async function submitScore(score, mode = "normal") {
  const name = (ui.nameInput?.value || "").trim() || "Anonymous";
  const entry = { name, score: Math.floor(score||0), mode, daystamp: TODAY(), created_at: new Date().toISOString() };

  // Keep best/daily HUD updated optimistically
  try {
    const best = Math.max(Number(ui.best?.dataset.value||0), entry.score);
    if (ui.best) { ui.best.dataset.value = String(best); ui.best.textContent = "Best: " + best; }
    if (mode === "daily" && ui.daily) {
      const dailyBest = Math.max(Number(ui.daily?.dataset.value||0), entry.score);
      ui.daily.dataset.value = String(dailyBest);
      ui.daily.textContent = "Daily: " + dailyBest;
    }
  } catch {}

  if (!supabaseClient) { saveLocal(entry); return { ok:true, local:true }; }

  const { data, error } = await supabaseClient.from(TABLE).insert(entry).select().single();
  if (error) {
    console.warn("[Playloop] Supabase insert failed, saving local:", error);
    saveLocal(entry);
    return { ok:false, error, local:true };
  }
  return { ok:true, data };
}

// 6) ---- API: fetch leaderboard ----
async function fetchLeaderboard(mode = "normal", limit = 50) {
  // Fallback: return local-only sorted view
  if (!supabaseClient) {
    const all = loadLocal().filter(e => e.mode === mode && (mode==="daily" ? e.daystamp === TODAY() : true));
    return all.sort((a,b)=>b.score - a.score).slice(0, limit);
  }

  let query = supabaseClient.from(TABLE)
    .select("name,score,mode,daystamp,created_at")
    .eq("mode", mode)
    .order("score", { ascending: false })
    .limit(limit);

  if (mode === "daily") query = query.eq("daystamp", TODAY());

  const { data, error } = await query;
  if (error) {
    console.warn("[Playloop] Supabase select failed; showing local scores.", error);
    const all = loadLocal().filter(e => e.mode === mode && (mode==="daily" ? e.daystamp === TODAY() : true));
    return all.sort((a,b)=>b.score - a.score).slice(0, limit);
  }
  return data;
}

// 7) ---- UI wiring: Leaderboard modal ----
function renderTable(rows) {
  if (!ui.lbTable) return;
  ui.lbTable.innerHTML = "";
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    const when = (r.created_at || new Date()).toString();
    tr.innerHTML = `
      <td>${i+1}</td>
      <td>${(r.name||"Anonymous").replace(/[<>&]/g, "")}</td>
      <td>${r.score}</td>
      <td style="text-align:right; opacity:.8;">${new Date(when).toLocaleString()}</td>
    `;
    ui.lbTable.appendChild(tr);
  });
}

async function refreshLeaderboard() {
  const mode = ui.lbMode?.value || "normal";
  ui.lbInfo && (ui.lbInfo.textContent = mode === "daily" ? `Showing today's (${TODAY()}) scores` : "Showing all-time scores");
  const rows = await fetchLeaderboard(mode);
  renderTable(rows);
}

ui.lbBtn?.addEventListener("click", () => {
  ui.lbModal?.classList.add("show");
  // Kick an ad refresh if AdSense is present in modal
  try { (adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
  refreshLeaderboard();
});

ui.lbClose?.addEventListener("click", () => ui.lbModal?.classList.remove("show"));
ui.lbMode?.addEventListener("change", refreshLeaderboard);

// 8) ---- Export minimal surface for your game loop ----
window.Playloop = window.Playloop || {};
window.Playloop.submitScore = submitScore;
window.Playloop.fetchLeaderboard = fetchLeaderboard;

/**
 * In your game-over logic, call:
 *   const mode = isDaily ? "daily" : "normal";
 *   Playloop.submitScore(finalScore, mode);
 *
 * That's it.
 */
