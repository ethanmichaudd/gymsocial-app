-- =========================================================================
-- GymSocial — change your username
-- Run after 003_username_login.sql. Safe to re-run.
--
-- Why: the app used supabase.auth.updateUser({ email }) to move the login
-- (ethan@users.gymsocial.app -> ethanm@users.gymsocial.app). Supabase now
-- checks that an email address can actually receive mail before changing
-- it, and users.gymsocial.app can't, so every rename failed with
-- 'Email address "..." is invalid'.
--
-- This does the rename in the database instead: profile and login together,
-- in one transaction, for the signed-in user only. No email is involved.
-- =========================================================================
create or replace function public.change_username(new_name text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid   uuid := auth.uid();
  clean text := lower(regexp_replace(trim(coalesce(new_name, '')), '^@', ''));
  login text := clean || '@users.gymsocial.app';
  cur   text;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if clean !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'Use 3-20 lowercase letters, numbers, _ or .' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where username = clean and id <> uid) then
    raise exception 'taken' using errcode = '23505';
  end if;

  select email into cur from auth.users where id = uid;

  -- username accounts: the login follows the handle
  if cur like '%@users.gymsocial.app' and cur <> login then
    if exists (select 1 from auth.users where lower(email) = login and id <> uid) then
      raise exception 'taken' using errcode = '23505';
    end if;
    update auth.users
       set email = login, updated_at = now()
     where id = uid;
    update auth.identities
       set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(login)),
           updated_at = now()
     where user_id = uid and provider = 'email';
  end if;

  update public.profiles set username = clean where id = uid;
  return clean;
end;
$$;

revoke all on function public.change_username(text) from public, anon;
grant execute on function public.change_username(text) to authenticated;
