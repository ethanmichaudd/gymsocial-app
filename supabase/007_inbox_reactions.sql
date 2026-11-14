-- =========================================================================
-- GymSocial — inbox + custom reactions
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- * reactions carry the time they were made (the Inbox sorts and counts
--   unread by it); switching to a different emoji counts as a new one
-- * a reaction can be any single emoji, so the column is capped to a short
--   string instead of a fixed list
-- * a friendship remembers who asked, so the Inbox can say
--   "Dev accepted your request" to the right person
-- =========================================================================

-- ---------- reactions: when ----------
alter table public.reactions
  add column if not exists created_at timestamptz not null default now();

-- the server sets the time, so a phone with a wrong clock can't skew it
create or replace function public.touch_reaction()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  elsif new.emoji is distinct from old.emoji then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists reactions_touch on public.reactions;
create trigger reactions_touch
  before insert or update on public.reactions
  for each row execute function public.touch_reaction();

-- ---------- reactions: any single emoji ----------
-- One emoji can be several characters long (a flag, a family, a skin tone),
-- so this is a length cap, not a list. The app checks it's really one emoji.
alter table public.reactions drop constraint if exists reactions_emoji_short;
alter table public.reactions add constraint reactions_emoji_short
  check (char_length(emoji) between 1 and 32);

-- ---------- friendships: who asked ----------
alter table public.connections
  add column if not exists requested_by uuid references public.profiles(id) on delete set null;

create or replace function public.accept_friend_request(requester uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from connection_requests where from_id = requester and to_id = me) then
    raise exception 'no request from that person';
  end if;
  insert into connections (user_a, user_b, requested_by)
  values (least(me, requester), greatest(me, requester), requester)
  on conflict do nothing;
  delete from connection_requests
   where (from_id = requester and to_id = me) or (from_id = me and to_id = requester);
end;
$$;
revoke all on function public.accept_friend_request(uuid) from public, anon;
grant execute on function public.accept_friend_request(uuid) to authenticated;
