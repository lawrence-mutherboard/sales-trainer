-- Run this once in the Supabase SQL editor (it is safe to run again).
-- Lets an admin turn someone's access to the sales trainer off and on from the Admin page.
-- Only the trainer's own profile table changes; the shared sign-in table (auth.users) is not touched, so this never
-- affects anyone's access to other company apps.
alter table public.trainer_profiles add column if not exists disabled boolean not null default false;

-- (The existing "role" column, 'rep' or 'manager', is what the Admin page uses to give someone manager access.)
