-- =========================================================================
-- One-off: the old email account (artejm1216@gmail.com, all the real data)
-- takes over the username "ethan". The empty @ethan account (no workouts,
-- just starter exercises) is deleted first to free the name.
-- Afterwards: sign in with username "ethan" and the OLD account's password.
-- Runs as one transaction: if any step fails, nothing changes.
-- =========================================================================
begin;

-- 1. remove the empty @ethan account (its profile and starter exercises go with it)
delete from auth.users where id = '4fcd97e3-5d14-42d2-a354-84922bfb8ea3';

-- 2. the old account now signs in as "ethan"
update auth.users
   set email = 'ethan@users.gymsocial.app'
 where id = '8b3cbabe-6110-4e4f-bbe7-5920f2c68610';

update auth.identities
   set identity_data = identity_data || jsonb_build_object('email', 'ethan@users.gymsocial.app')
 where user_id = '8b3cbabe-6110-4e4f-bbe7-5920f2c68610' and provider = 'email';

-- 3. and is @ethan to friends
update public.profiles set username = 'ethan'
 where id = '8b3cbabe-6110-4e4f-bbe7-5920f2c68610';

commit;

-- check: one account, @ethan, 6 workouts
select p.username, u.email,
       (select count(*) from public.workouts w where w.user_id = p.id) as workouts
  from public.profiles p join auth.users u on u.id = p.id;
