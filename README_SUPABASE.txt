# Loop Runner — Supabase Leaderboard
This build adds a worldwide leaderboard using Supabase.

## 1) Create Supabase project
- Go to https://supabase.com → New project
- Copy your Project URL and anon public key

## 2) Create the table
- In Supabase → SQL editor → run `supabase.sql` from this zip.

## 3) Wire credentials
- Open `index.html` and find:
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
- Replace both with your values. Keep the anon key client-side (it’s meant to be public).

## 4) Publish
- Commit/push to GitHub Pages. Open the leaderboard; it will read/write globally.
- If Supabase is unreachable, the leaderboard silently falls back to local (device) scores.
