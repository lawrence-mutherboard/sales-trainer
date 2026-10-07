-- Lets the app read and write the trainer tables through Supabase's data API.
-- Run this once in the SQL Editor if the app shows a "404 page not found" after you start a call, or the server log says
-- "permission denied for table trainer_...". Newer Supabase projects do not automatically open new tables to the API.
-- It only grants access to this app's trainer_ tables. Row-level security (the policies in 0001_init.sql) still decides
-- which ROWS each person can see, so this does not expose anyone's data.

grant usage on schema public to authenticated, service_role;

-- Signed-in people can READ their own rows (the policies limit it to theirs, and managers to their team's).
grant select on public.trainer_profiles, public.trainer_sessions, public.trainer_turns, public.trainer_scores to authenticated;

-- Never grant anything on trainer_session_secrets to authenticated: it holds the prospect's hidden facts.

-- The server (secret key) does all the writing.
grant select, insert, update, delete on
  public.trainer_profiles, public.trainer_sessions, public.trainer_session_secrets, public.trainer_turns, public.trainer_scores
  to service_role;

grant execute on function public.trainer_is_manager_of(uuid) to authenticated, service_role;
