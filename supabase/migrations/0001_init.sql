-- mutherboard Sales Roleplay Trainer - initial schema
-- Run this once in the Supabase SQL editor (or with the Supabase CLI).
--
-- Key security decisions:
--   * hidden_profile is NOT on `sessions`. It lives in `session_secrets`, which has RLS enabled and
--     NO policies, so only the server (service role key) can read it. Reps can never see it.
--   * Only @mutherboard.com accounts can be created (trigger below). Change the domain here if needed.
--   * All writes to sessions / turns / scores / session_secrets go through the server (service role).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  name        text,
  role        text not null default 'rep' check (role in ('rep', 'manager')),
  manager_id  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Create a profile for every new sign-in, and refuse accounts outside the company domain.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) not like '%@mutherboard.com' then
    raise exception 'Only mutherboard.com accounts are allowed';
  end if;

  insert into public.profiles (id, email, name)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Is the current user the manager of this rep? (security definer avoids RLS recursion on profiles)
create or replace function public.is_manager_of(rep uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = rep and p.manager_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- sessions (one per call)
-- ---------------------------------------------------------------------------
create table public.sessions (
  id               uuid primary key default gen_random_uuid(),
  rep_id           uuid not null references public.profiles (id) on delete cascade,
  company_size     text not null check (company_size in ('smb', 'enterprise')),
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

create index sessions_rep_started_idx on public.sessions (rep_id, started_at desc);

-- Server-only. No RLS policies on purpose.
create table public.session_secrets (
  session_id     uuid primary key references public.sessions (id) on delete cascade,
  hidden_profile jsonb not null
);

create table public.turns (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  idx        integer not null,
  speaker    text not null check (speaker in ('rep', 'prospect')),
  text       text not null,
  started_ms integer,
  ended_ms   integer,
  created_at timestamptz not null default now(),
  unique (session_id, idx)
);

create table public.scores (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null unique references public.sessions (id) on delete cascade,
  total       integer not null,
  pass        boolean not null,
  result_json jsonb not null,
  model       text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.sessions       enable row level security;
alter table public.session_secrets enable row level security;
alter table public.turns          enable row level security;
alter table public.scores         enable row level security;

-- profiles: read your own row, and your direct reports' rows if you're a manager
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_select_reports" on public.profiles
  for select using (manager_id = auth.uid());

-- sessions: reps read their own; managers read their team's
create policy "sessions_select_own" on public.sessions
  for select using (rep_id = auth.uid());
create policy "sessions_select_team" on public.sessions
  for select using (public.is_manager_of(rep_id));

-- turns and scores follow their session
create policy "turns_select_own" on public.turns
  for select using (exists (select 1 from public.sessions s where s.id = session_id and s.rep_id = auth.uid()));
create policy "turns_select_team" on public.turns
  for select using (exists (select 1 from public.sessions s where s.id = session_id and public.is_manager_of(s.rep_id)));

create policy "scores_select_own" on public.scores
  for select using (exists (select 1 from public.sessions s where s.id = session_id and s.rep_id = auth.uid()));
create policy "scores_select_team" on public.scores
  for select using (exists (select 1 from public.sessions s where s.id = session_id and public.is_manager_of(s.rep_id)));

-- session_secrets: intentionally NO policies. Only the service role (which bypasses RLS) can touch it.

-- ---------------------------------------------------------------------------
-- 90-day retention (UK GDPR)
-- Deleting a session cascades to turns, scores and session_secrets.
-- Requires the pg_cron extension: Supabase dashboard -> Database -> Extensions -> enable pg_cron.
-- If pg_cron isn't enabled this block just prints a notice; enable it and re-run this block.
-- ---------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'purge-old-sessions',
    '0 3 * * *',
    $job$ delete from public.sessions where started_at < now() - interval '90 days' $job$
  );
exception when others then
  raise notice 'pg_cron not available (%). Enable it in the dashboard and re-run this block.', sqlerrm;
end
$$;

-- ---------------------------------------------------------------------------
-- Making someone a manager (run manually in the SQL editor):
--   update public.profiles set role = 'manager' where email = 'someone@mutherboard.com';
--   update public.profiles set manager_id = (select id from public.profiles where email = 'manager@mutherboard.com')
--     where email = 'rep@mutherboard.com';
-- ---------------------------------------------------------------------------
