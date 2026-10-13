-- mutherboard Sales Roleplay Trainer - schema
-- Run this once in the Supabase SQL editor (or with the Supabase CLI).
--
-- This script is built to live in a project that already has other tables (for example the company's own):
--   * Every table, function and index starts with "trainer_", so nothing here can clash with what already exists.
--   * It only CREATES things. It never drops, alters or replaces anything that was there before.
--   * It adds no trigger to the shared sign-in table (auth.users). The app creates each person's profile itself
--     when they sign in, and checks the @mutherboard.com domain itself.
--
-- Key security decisions:
--   * The prospect's hidden facts are NOT on trainer_sessions. They live in trainer_session_secrets, which has RLS
--     enabled and NO policies, so only the server (service role key) can read them. Reps can never see them.
--   * All writes to these tables go through the server (service role). People only get read access, to their own rows
--     (and a manager to their team's).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- trainer_profiles: one row per person who uses the trainer (created by the app on first sign-in)
-- ---------------------------------------------------------------------------
create table public.trainer_profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  name        text,
  role        text not null default 'rep' check (role in ('rep', 'manager')),
  manager_id  uuid references public.trainer_profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Is the current user the manager of this rep? (security definer avoids RLS recursion on trainer_profiles)
create or replace function public.trainer_is_manager_of(rep uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trainer_profiles p
    where p.id = rep and p.manager_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- trainer_sessions: one per call
-- ---------------------------------------------------------------------------
create table public.trainer_sessions (
  id               uuid primary key default gen_random_uuid(),
  rep_id           uuid not null references public.trainer_profiles (id) on delete cascade,
  company_size     text not null check (company_size in ('smb', 'mid_market', 'enterprise')),
  department       text not null check (department in ('sales', 'operations', 'product', 'finance')),
  personality      text not null check (personality in ('friendly', 'uninterested', 'skeptical')),
  scenario         text not null,
  difficulty       text not null check (difficulty in ('easy', 'medium', 'hard')),
  prospect_name    text not null,
  prospect_title   text not null,
  prospect_company text not null,
  input_mode       text not null default 'voice' check (input_mode in ('voice', 'typed')),
  status           text not null default 'ready'
                   check (status in ('ready', 'in_progress', 'ended', 'scored', 'score_failed')),
  ended_by         text check (ended_by in ('rep', 'prospect', 'timeout')),
  duration_ms      integer,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz
);

create index trainer_sessions_rep_started_idx on public.trainer_sessions (rep_id, started_at desc);

-- The prospect's hidden facts. Server-only: no policies on purpose.
create table public.trainer_session_secrets (
  session_id     uuid primary key references public.trainer_sessions (id) on delete cascade,
  hidden_profile jsonb not null
);

create table public.trainer_turns (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.trainer_sessions (id) on delete cascade,
  idx        integer not null,
  speaker    text not null check (speaker in ('rep', 'prospect')),
  text       text not null,
  started_ms integer,
  ended_ms   integer,
  created_at timestamptz not null default now(),
  unique (session_id, idx)
);

create table public.trainer_scores (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null unique references public.trainer_sessions (id) on delete cascade,
  total       integer not null,
  pass        boolean not null,
  result_json jsonb not null,
  model       text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security: who can read what
-- ---------------------------------------------------------------------------
alter table public.trainer_profiles        enable row level security;
alter table public.trainer_sessions        enable row level security;
alter table public.trainer_session_secrets enable row level security;
alter table public.trainer_turns           enable row level security;
alter table public.trainer_scores          enable row level security;

-- profiles: read your own row, and your direct reports' rows if you're a manager
create policy "trainer_profiles_select_own" on public.trainer_profiles
  for select using (id = auth.uid());
create policy "trainer_profiles_select_reports" on public.trainer_profiles
  for select using (manager_id = auth.uid());

-- sessions: reps read their own; managers read their team's
create policy "trainer_sessions_select_own" on public.trainer_sessions
  for select using (rep_id = auth.uid());
create policy "trainer_sessions_select_team" on public.trainer_sessions
  for select using (public.trainer_is_manager_of(rep_id));

-- turns and scores follow their session
create policy "trainer_turns_select_own" on public.trainer_turns
  for select using (exists (select 1 from public.trainer_sessions s where s.id = session_id and s.rep_id = auth.uid()));
create policy "trainer_turns_select_team" on public.trainer_turns
  for select using (exists (select 1 from public.trainer_sessions s where s.id = session_id and public.trainer_is_manager_of(s.rep_id)));

create policy "trainer_scores_select_own" on public.trainer_scores
  for select using (exists (select 1 from public.trainer_sessions s where s.id = session_id and s.rep_id = auth.uid()));
create policy "trainer_scores_select_team" on public.trainer_scores
  for select using (exists (select 1 from public.trainer_sessions s where s.id = session_id and public.trainer_is_manager_of(s.rep_id)));

-- trainer_session_secrets: intentionally NO policies. Only the service role (which bypasses RLS) can touch it.

-- ---------------------------------------------------------------------------
-- Optional: 90-day retention (UK GDPR). Run this block separately, after enabling the pg_cron extension
-- (Supabase dashboard -> Database -> Extensions -> pg_cron). Deleting a session also deletes its turns, score and
-- hidden facts. It only touches this app's table.
-- ---------------------------------------------------------------------------
-- select cron.schedule(
--   'trainer-purge-old-sessions',
--   '0 3 * * *',
--   $job$ delete from public.trainer_sessions where started_at < now() - interval '90 days' $job$
-- );

-- ---------------------------------------------------------------------------
-- Making someone a manager (run manually in the SQL editor, after they have signed in once):
--   update public.trainer_profiles set role = 'manager' where email = 'someone@mutherboard.com';
--   update public.trainer_profiles
--      set manager_id = (select id from public.trainer_profiles where email = 'manager@mutherboard.com')
--    where email = 'rep@mutherboard.com';
-- ---------------------------------------------------------------------------
