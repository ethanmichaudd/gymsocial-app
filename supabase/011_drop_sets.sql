-- =========================================================================
-- GymSocial — drop sets
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- A set can be marked as a drop set (straight on from the set before it,
-- with less weight). Until this has been run the app still logs and syncs
-- drop sets; the marker just stays on the phone that logged it.
-- =========================================================================
alter table public.workout_sets add column if not exists is_drop boolean not null default false;
