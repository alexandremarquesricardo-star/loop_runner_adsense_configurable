-- Supabase schema for Loop Runner (global leaderboard)
create extension if not exists pgcrypto;
create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 20),
  score integer not null check (score between 0 and 100000000),
  mode text not null check (mode in ('normal','daily')),
  day date
);
create index if not exists scores_score_desc_idx on public.scores (score desc);
create index if not exists scores_day_idx on public.scores (day);

alter table public.scores enable row level security;
do $$ begin
  create policy read_all on public.scores for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy insert_all on public.scores for insert with check (true);
exception when duplicate_object then null; end $$;
