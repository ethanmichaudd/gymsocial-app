-- =========================================================================
-- One-off: move everything from the old email account (@artejm1216_8b3c)
-- into the username account (@ethan). Runs as one transaction: if any step
-- fails, nothing changes. The old login itself is left in place (empty).
-- =========================================================================
begin;

-- @ethan only has the 15 starter exercises and no workouts; clear them so
-- the old account's 43 (same names included) can move over cleanly
delete from public.exercises
 where owner_id = '4fcd97e3-5d14-42d2-a354-84922bfb8ea3'
   and not exists (select 1 from public.workout_exercises we where we.exercise_id = exercises.id);

update public.exercises set owner_id = '4fcd97e3-5d14-42d2-a354-84922bfb8ea3'
 where owner_id = '8b3cbabe-6110-4e4f-bbe7-5920f2c68610';

update public.gyms set created_by = '4fcd97e3-5d14-42d2-a354-84922bfb8ea3'
 where created_by = '8b3cbabe-6110-4e4f-bbe7-5920f2c68610';

update public.workouts set user_id = '4fcd97e3-5d14-42d2-a354-84922bfb8ea3'
 where user_id = '8b3cbabe-6110-4e4f-bbe7-5920f2c68610';

-- profile picture, goals and app settings (custom equipment, theme, ...)
update public.profiles n
   set avatar = o.avatar, settings = o.settings, weekly_goal = o.weekly_goal,
       streak_mode = o.streak_mode, custom_count = o.custom_count,
       custom_days = o.custom_days, is_private = o.is_private,
       display_name = coalesce(n.display_name, o.display_name)
  from public.profiles o
 where n.id = '4fcd97e3-5d14-42d2-a354-84922bfb8ea3'
   and o.id = '8b3cbabe-6110-4e4f-bbe7-5920f2c68610';

-- keep the old, now-empty account out of friend search
-- (left public: the moved workout photo still sits in its old folder)
update public.profiles set display_name = null, avatar = null,
       username = 'old_' || substr(replace(id::text, '-', ''), 1, 8)
 where id = '8b3cbabe-6110-4e4f-bbe7-5920f2c68610';

commit;

-- check: @ethan should now show 6 workouts
select p.username,
       (select count(*) from public.workouts w where w.user_id = p.id) as workouts,
       (select count(*) from public.exercises e where e.owner_id = p.id) as exercises
  from public.profiles p;
