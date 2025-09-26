@@ .. @@
 create table if not exists public.scores (
   id uuid primary key default gen_random_uuid(),
   created_at timestamptz not null default now(),
   name text not null check (char_length(name) between 1 and 20),
   score integer not null check (score between 0 and 100000000),
   mode text not null check (mode in ('normal','daily')),
-  day date
+  day date,
+  country text default 'XX'
 );