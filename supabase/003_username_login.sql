-- =========================================================================
-- GymSocial — sign in with a username instead of an email
-- Run after 002_friends.sql. Safe to re-run.
--
-- The app turns "ethan" into the login ethan@users.gymsocial.app (no mail is
-- ever sent there). New profiles made that way take the username exactly;
-- real-email accounts still get one generated from the email.
-- Also: Authentication -> Sign In / Providers -> Email -> turn OFF
-- "Confirm email", or sign-ups will wait for a confirmation that never comes.
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text;
begin
  if new.email like '%@users.gymsocial.app' then
    -- the app already checked the format; a taken name fails the signup
    insert into public.profiles (id, username)
    values (new.id, split_part(new.email, '@', 1))
    on conflict (id) do nothing;
  else
    base := left(lower(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9_.]', '', 'g')), 14);
    if length(base) < 3 then base := 'user'; end if;
    insert into public.profiles (id, username)
    values (new.id, base || '_' || substr(replace(new.id::text, '-', ''), 1, 4))
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
