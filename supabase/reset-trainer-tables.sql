-- Removes ONLY the sales trainer's own tables and function, so migrations/0001_init.sql can be run again from scratch.
--
-- !! This DELETES every call, transcript, score and profile stored by the trainer. It cannot be undone. !!
-- It touches nothing else: every name below starts with "trainer_". Other tables in the project are not affected.
-- It does not delete anyone's sign-in account (those are in auth.users); the app recreates each person's
-- trainer profile the next time they sign in.
--
-- Order: run this, then run 0001_init.sql.

drop table if exists public.trainer_scores cascade;
drop table if exists public.trainer_turns cascade;
drop table if exists public.trainer_session_secrets cascade;
drop table if exists public.trainer_sessions cascade;
drop table if exists public.trainer_profiles cascade;
drop function if exists public.trainer_is_manager_of(uuid);

-- If you had scheduled the 90-day clean-up, remove it too (ignore an error if pg_cron isn't enabled):
-- select cron.unschedule('trainer-purge-old-sessions');
