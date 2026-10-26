-- Run this once in the Supabase SQL editor (it is safe to run again).
-- Lets an owner make people admins from the Admin page: the trainer's profile role can now be 'rep', 'manager' or
-- 'admin'. Only the trainer's own profile table changes.
alter table public.trainer_profiles drop constraint if exists trainer_profiles_role_check;
alter table public.trainer_profiles add constraint trainer_profiles_role_check check (role in ('rep', 'manager', 'admin'));
