-- =========================================================================
-- GymSocial — step 3: real friends
-- Run once after schema.sql: SQL Editor -> paste -> Run. Safe to re-run.
--
-- A friendship is a row in connections (mutual). You get there by sending a
-- connection_request; the other person accepts through accept_friend_request,
-- which is the only way a connection is ever created.
-- =========================================================================

-- usernames are how people find each other: lowercase, 3-20 characters of
-- letters, numbers, _ and .   (the app checks this too, with a nicer message)
update public.profiles
   set username = left(lower(regexp_replace(username, '[^a-zA-Z0-9_.]', '', 'g')), 20)
 where username !~ '^[a-z0-9_.]{3,20}$';

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username ~ '^[a-z0-9_.]{3,20}$');

-- new accounts get a username that already fits those rules
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text := left(lower(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9_.]', '', 'g')), 14);
begin
  if length(base) < 3 then base := 'user'; end if;
  insert into public.profiles (id, username)
  values (new.id, base || '_' || substr(replace(new.id::text, '-', ''), 1, 4))
  on conflict (id) do nothing;
  return new;
end;
$$;

create index if not exists requests_to_idx on public.connection_requests (to_id);

-- Accept: checks the request is really addressed to you, makes the
-- connection, and clears the request (and any crossed one going back).
create or replace function public.accept_friend_request(requester uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from connection_requests where from_id = requester and to_id = me) then
    raise exception 'no request from that person';
  end if;
  insert into connections (user_a, user_b)
  values (least(me, requester), greatest(me, requester))
  on conflict do nothing;
  delete from connection_requests
   where (from_id = requester and to_id = me) or (from_id = me and to_id = requester);
end;
$$;
revoke all on function public.accept_friend_request(uuid) from public, anon;
grant execute on function public.accept_friend_request(uuid) to authenticated;

-- you can only react to a workout you're allowed to see
drop policy if exists "react as yourself" on public.reactions;
create policy "react as yourself" on public.reactions
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.workouts w where w.id = workout_id and public.can_view(w.user_id))
  );
