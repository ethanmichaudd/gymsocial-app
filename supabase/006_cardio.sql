-- =========================================================================
-- GymSocial — cardio
-- Run once in the Supabase SQL editor, before using Cardio in the app.
-- Safe to re-run.
--
-- * exercises and workout blocks can be "cardio" (a Run, a Row, ...)
-- * rowing distance is in metres
-- * a cardio entry can record incline/level, average heart rate and steps
-- =========================================================================
alter table public.exercises drop constraint if exists exercises_metric_check;
alter table public.exercises add constraint exercises_metric_check
  check (metric in ('reps','time','distance','cardio'));

alter table public.workout_exercises drop constraint if exists workout_exercises_metric_check;
alter table public.workout_exercises add constraint workout_exercises_metric_check
  check (metric in ('reps','time','distance','cardio'));

alter table public.workout_sets drop constraint if exists workout_sets_distance_unit_check;
alter table public.workout_sets add constraint workout_sets_distance_unit_check
  check (distance_unit in ('mi','km','m'));

alter table public.workout_sets add column if not exists intensity numeric(6,1);  -- incline %, level, resistance, damper
alter table public.workout_sets add column if not exists heart_rate int;          -- average bpm
alter table public.workout_sets add column if not exists steps int;
