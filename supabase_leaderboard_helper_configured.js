// leaderboard-supabase.js — Global leaderboard via Supabase
// Lightweight, browser-friendly module. Safe to ship with anon key (RLS required).
// Usage:
//   import { GlobalBoard } from './leaderboard-supabase.js';
//   const LB = new GlobalBoard('playloop');
//   await LB.submit(name, score);
//   await LB.render(ctx, 10, 56);

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// You can set these at runtime via window.SUPABASE_URL / window.SUPABASE_ANON_KEY
// They are also defaulted here for convenience, derived from your provided anon key
// (project ref: zpoerliqhcywaulbthyf)
const SUPABASE_URL  = window.SUPABASE_URL || 'https://zpoerliqhcywaulbthyf.supabase.co';
const SUPABASE_ANON = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpwb2VybGlxaGN5d2F1bGJ0aHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyMDQxNjYsImV4cCI6MjA3Mzc4MDE2Nn0.7jjITj1H2AxWPnCeyzmMsNw3uAVACoYb_CV5rRoD65k';

const configured = SUPABASE_URL && SUPABASE_ANON;
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON) : null;

export class GlobalBoard {
  constructor(namespace='game'){
    this.ns = namespace;
    this.bestKey = `${namespace}:best`;
    this.cache = { rows: [], at: 0 };
  }

  best(){ return Number(localStorage.getItem(this.bestKey) || 0); }
  _setBest(score){ const s = Math.floor(score)||0; if (s > this.best()) localStorage.setItem(this.bestKey, String(s)); }

  async submit(name, score){
    this._setBest(score);
    if (!supabase) return;
    const cleanName = String(name || 'anon').slice(0,12);
    const cleanScore = Math.max(0, Math.floor(score) || 0);
    try {
      await supabase.from('scores').insert({ name: cleanName, score: cleanScore });
      this.cache.at = 0; // bust cache
    } catch (_) {}
  }

  async top(limit=10){
    if (Date.now() - this.cache.at < 5000 && this.cache.rows.length) return this.cache.rows;
    if (!supabase) return [{ name: '(offline)', score: this.best(), ts: new Date().toISOString() }];
    const { data, error } = await supabase
      .from('scores')
      .select('name, score, ts')
      .order('score', { ascending: false })
      .order('ts', { ascending: true })
      .limit(limit);
    if (!error && data){ this.cache = { rows: data, at: Date.now() }; return data; }
    return [];
  }

  async render(ctx, x, y){
    const rows = await this.top(10);
    ctx.save();
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.textBaseline = 'top';
    ctx.fillText('Top 10 (global)', x, y);
    rows.forEach((r,i)=>{
      const line = `${String(i+1).padStart(2,' ')}. ${(r.name||'anon').padEnd(12,' ')} — ${r.score}`;
      ctx.fillText(line, x, y + 16 + i*14);
    });
    ctx.restore();
  }
}
