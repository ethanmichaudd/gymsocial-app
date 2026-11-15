-- =========================================================================
-- GymSocial — the developer account
-- Run after 008_gym_places.sql and 009_social.sql. Safe to re-run.
--
-- What this adds
--   * admins: the list of developer accounts. Nobody can read or change it
--     from the app or the developer page; only this SQL editor can.
--   * the developer page (admin.html) talks to the admin_* functions below
--     and nothing else. Each one checks the caller is on that list, here in
--     the database, so hiding the page is not what protects it.
--   * a developer account can't be used as a normal one: it can't log
--     workouts, react, comment or send friend requests, and nobody can find
--     it in search.
--   * gyms can be merged (a duplicate points at the gym it was merged into)
--     and hidden from the directory.
--
-- What a developer account can see about a person
--   username, display name, the day they joined, when they were last
--   active, whether they are signed in, and how many workouts they have
--   logged. Never an email, a workout, a photo, a comment or a friend list.
--   Private (home) gyms are only ever a count.
--
-- Turning an account into a developer account (one time)
--   1. create the account on the developer page (admin.html)
--   2. run this line here, with its username:
--
--        insert into public.admins (user_id)
--        select id from public.profiles where username = 'your_dev_username'
--        on conflict do nothing;
--
--   To take it away again:
--        delete from public.admins
--        where user_id = (select id from public.profiles where username = 'your_dev_username');
-- =========================================================================

-- ---------- who is a developer ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;   -- and no policies: closed to the app
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.is_admin_id(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = p_user);
$$;
revoke all on function public.is_admin_id(uuid) from public, anon;
grant execute on function public.is_admin_id(uuid) to authenticated;

-- every admin_* function starts with this
create or replace function public.require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Developer account only.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.require_admin() from public, anon;
grant execute on function public.require_admin() to authenticated;

-- ---------- a developer account is not a normal account ----------
-- Nobody else can see its profile, so it never shows up in search...
drop policy if exists "developer accounts stay out of the app" on public.profiles;
create policy "developer accounts stay out of the app" on public.profiles
  as restrictive for select
  using (id = auth.uid() or not public.is_admin_id(id));

-- ...and it can't add anything a normal account adds.
do $$
declare t text;
begin
  foreach t in array array['workouts', 'reactions', 'connection_requests', 'follows',
                           'comments', 'workout_tags', 'presence'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "not for developer accounts" on public.%I', t);
      execute format('create policy "not for developer accounts" on public.%I
                        as restrictive for insert with check (not public.is_admin())', t);
    end if;
  end loop;
end $$;

-- ---------- gyms: merged and hidden ----------
-- merged_into: this gym was a duplicate; everything now lives at that gym.
--              The row stays so a phone that still remembers the old gym can
--              keep syncing: whatever it sends is moved to the right gym.
-- admin_hidden: taken out of the directory by a developer (it is also made
--              private, which is what actually hides it).
alter table public.gyms add column if not exists merged_into uuid references public.gyms(id);
alter table public.gyms add column if not exists admin_hidden boolean not null default false;

-- a merged gym no longer holds its name and address, so the same place can
-- be typed in again without an error
alter table public.gyms drop constraint if exists gyms_name_street_city_state_key;
create unique index if not exists gyms_place_unique
  on public.gyms (name, street, city, state) where merged_into is null;

-- nobody reads a merged gym any more
drop policy if exists "merged gyms are gone" on public.gyms;
create policy "merged gyms are gone" on public.gyms
  as restrictive for select using (merged_into is null);

-- the person who added a gym can't undo a developer hiding it
drop policy if exists "hidden gyms are the developer's call" on public.gyms;
create policy "hidden gyms are the developer's call" on public.gyms
  as restrictive for update using (not admin_hidden);

-- only the functions below may set the two new columns
create or replace function public.guard_gym_admin_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.merged_into := null;
      new.admin_hidden := false;
    else
      new.merged_into := old.merged_into;
      new.admin_hidden := old.admin_hidden;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists gyms_guard_admin_columns on public.gyms;
create trigger gyms_guard_admin_columns
  before insert or update on public.gyms
  for each row execute function public.guard_gym_admin_columns();

-- anything saved against a merged gym lands on the gym it was merged into
create or replace function public.follow_gym_merge()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target uuid;
  hops int := 0;
begin
  while new.gym_id is not null and hops < 5 loop
    select g.merged_into into target from gyms g where g.id = new.gym_id;
    exit when target is null;
    new.gym_id := target;
    hops := hops + 1;
  end loop;
  return new;
end;
$$;
drop trigger if exists workouts_follow_merge on public.workouts;
create trigger workouts_follow_merge
  before insert or update of gym_id on public.workouts
  for each row execute function public.follow_gym_merge();

do $$
begin
  if to_regclass('public.presence') is not null then
    drop trigger if exists presence_follow_merge on public.presence;
    create trigger presence_follow_merge            -- runs before presence_stamp (alphabetical)
      before insert or update on public.presence
      for each row execute function public.follow_gym_merge();
  end if;
end $$;

-- The app asks this after a sync: "of the gyms on my list, which were
-- merged, and into what?" so it can tidy its own list.
create or replace function public.gym_redirects(p_ids uuid[])
returns table (
  from_id uuid, id uuid, name text, street text, city text, state text,
  lat double precision, lng double precision, is_private boolean
)
language sql stable security definer set search_path = public as $$
  select x.id, y.id, y.name, y.street, y.city, y.state, y.lat, y.lng, y.is_private
  from gyms x
  join gyms y on y.id = x.merged_into
  where auth.uid() is not null
    and x.id = any (p_ids[1:500]);
$$;
revoke all on function public.gym_redirects(uuid[]) from public, anon;
grant execute on function public.gym_redirects(uuid[]) to authenticated;

-- The directory, exactly as in 008_gym_places.sql plus one line: merged gyms
-- are left out. (008 has the same line, so re-running either file is fine.)
drop function if exists public.gym_directory();
create function public.gym_directory()
returns table (
  id uuid, name text, street text, city text, state text,
  lat double precision, lng double precision,
  created_by uuid, is_private boolean,
  people_30d int, sessions_30d int, sessions_all int
)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.street, g.city, g.state, g.lat, g.lng, g.created_by, g.is_private,
         coalesce(s.people_30d, 0)::int, coalesce(s.sessions_30d, 0)::int, coalesce(s.sessions_all, 0)::int
  from gyms g
  left join (
    select w.gym_id,
           count(distinct w.user_id) filter (where w.performed_at > now() - interval '30 days') as people_30d,
           count(*) filter (where w.performed_at > now() - interval '30 days') as sessions_30d,
           count(*) as sessions_all
    from workouts w
    where w.gym_id is not null and public.can_view(w.user_id)
    group by w.gym_id
  ) s on s.gym_id = g.id
  where auth.uid() is not null
    and g.merged_into is null
    and (not g.is_private
         or g.created_by = auth.uid()
         or exists (select 1 from workouts w where w.gym_id = g.id and w.user_id = auth.uid()))
  order by g.name
  limit 2000;
$$;
revoke all on function public.gym_directory() from public, anon;
grant execute on function public.gym_directory() to authenticated;

-- =========================================================================
-- What the developer page calls
-- =========================================================================

-- ---------- the numbers ----------
-- "signed_in" is accounts with a live session on at least one device.
-- "active" is the last time one of those sessions was used. Both come from
-- Supabase's own session records; if those can't be read, activity falls
-- back to the last sign-in and signed_in is left empty.
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  signed_in int;
  active_day int;
  active_week int;
begin
  perform public.require_admin();

  begin
    select count(distinct s.user_id) filter (where s.not_after is null or s.not_after > now()),
           count(distinct s.user_id) filter (where coalesce(s.refreshed_at, s.updated_at, s.created_at) > now() - interval '1 day'),
           count(distinct s.user_id) filter (where coalesce(s.refreshed_at, s.updated_at, s.created_at) > now() - interval '7 days')
      into signed_in, active_day, active_week
      from auth.sessions s
     where not exists (select 1 from admins a where a.user_id = s.user_id);
  exception when undefined_table or undefined_column then
    signed_in := null;
    select count(*) filter (where u.last_sign_in_at > now() - interval '1 day'),
           count(*) filter (where u.last_sign_in_at > now() - interval '7 days')
      into active_day, active_week
      from auth.users u
     where not exists (select 1 from admins a where a.user_id = u.id);
  end;

  return jsonb_build_object(
    'users',         (select count(*) from profiles p where not exists (select 1 from admins a where a.user_id = p.id)),
    'new_week',      (select count(*) from profiles p where p.created_at > now() - interval '7 days'
                        and not exists (select 1 from admins a where a.user_id = p.id)),
    'signed_in',     signed_in,
    'active_day',    active_day,
    'active_week',   active_week,
    'workouts',      (select count(*) from workouts),
    'workouts_week', (select count(*) from workouts w where w.performed_at > now() - interval '7 days'),
    'gyms',          (select count(*) from gyms g where g.merged_into is null and not g.is_private),
    'gyms_private',  (select count(*) from gyms g where g.merged_into is null and g.is_private and not g.admin_hidden),
    'gyms_hidden',   (select count(*) from gyms g where g.merged_into is null and g.admin_hidden),
    'gyms_no_pin',   (select count(*) from gyms g where g.merged_into is null and not g.is_private and g.lat is null),
    'geocoding',     coalesce((select (c.value ->> 'geocoding')::boolean from app_config c where c.key = 'maps'), true)
  );
end;
$$;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- ---------- people: the basics, nothing else ----------
create or replace function public.admin_users(p_search text default '', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  term text := '%' || replace(replace(lower(trim(coalesce(p_search, ''))), '\', ''), '%', '') || '%';
  lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  off int := greatest(coalesce(p_offset, 0), 0);
  result jsonb;
begin
  perform public.require_admin();

  begin
    select coalesce(jsonb_agg(to_jsonb(r) order by r.joined desc), '[]'::jsonb) into result
    from (
      select p.id, p.username, p.display_name, p.created_at as joined,
             (select count(*) from workouts w where w.user_id = p.id)::int as workouts,
             greatest(u.last_sign_in_at,
                      (select max(coalesce(s.refreshed_at, s.updated_at, s.created_at))
                         from auth.sessions s where s.user_id = p.id)) as last_seen,
             exists (select 1 from auth.sessions s
                      where s.user_id = p.id and (s.not_after is null or s.not_after > now())) as signed_in
      from profiles p
      left join auth.users u on u.id = p.id
      where not exists (select 1 from admins a where a.user_id = p.id)
        and (lower(p.username) like term or lower(coalesce(p.display_name, '')) like term)
      order by p.created_at desc
      limit lim offset off
    ) r;
  exception when undefined_table or undefined_column then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.joined desc), '[]'::jsonb) into result
    from (
      select p.id, p.username, p.display_name, p.created_at as joined,
             (select count(*) from workouts w where w.user_id = p.id)::int as workouts,
             u.last_sign_in_at as last_seen,
             null::boolean as signed_in
      from profiles p
      left join auth.users u on u.id = p.id
      where not exists (select 1 from admins a where a.user_id = p.id)
        and (lower(p.username) like term or lower(coalesce(p.display_name, '')) like term)
      order by p.created_at desc
      limit lim offset off
    ) r;
  end;

  return result;
end;
$$;
revoke all on function public.admin_users(text, int, int) from public, anon;
grant execute on function public.admin_users(text, int, int) to authenticated;

-- ---------- change someone's username ----------
-- The same rules as change_username (005): the handle and, for username
-- accounts, the login move together. They sign in with the new name from
-- then on; a phone that is already signed in stays signed in.
create or replace function public.admin_set_username(p_user uuid, p_name text)
returns text language plpgsql security definer set search_path = public, auth as $$
declare
  clean text := lower(regexp_replace(trim(coalesce(p_name, '')), '^@', ''));
  login text := clean || '@users.gymsocial.app';
  cur   text;
begin
  perform public.require_admin();
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'No such account.' using errcode = '22023';
  end if;
  if clean !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'Use 3-20 lowercase letters, numbers, _ or .' using errcode = '22023';
  end if;
  if exists (select 1 from profiles where username = clean and id <> p_user) then
    raise exception 'That username is taken.' using errcode = '23505';
  end if;

  select email into cur from auth.users where id = p_user;
  if cur like '%@users.gymsocial.app' and cur <> login then
    if exists (select 1 from auth.users where lower(email) = login and id <> p_user) then
      raise exception 'That username is taken.' using errcode = '23505';
    end if;
    update auth.users set email = login, updated_at = now() where id = p_user;
    update auth.identities
       set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(login)),
           updated_at = now()
     where user_id = p_user and provider = 'email';
  end if;

  update profiles set username = clean where id = p_user;
  return clean;
end;
$$;
revoke all on function public.admin_set_username(uuid, text) from public, anon;
grant execute on function public.admin_set_username(uuid, text) to authenticated;

-- ---------- gyms: the public directory, plus any a developer hid ----------
-- Private (home) gyms are not listed; admin_overview only counts them.
create or replace function public.admin_gyms(p_search text default '')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  term text := '%' || replace(replace(lower(trim(coalesce(p_search, ''))), '\', ''), '%', '') || '%';
  result jsonb;
begin
  perform public.require_admin();
  select coalesce(jsonb_agg(to_jsonb(r) order by lower(r.name), r.city), '[]'::jsonb) into result
  from (
    select g.id, g.name, g.street, g.city, g.state, g.lat, g.lng,
           g.admin_hidden as hidden, g.created_at as added,
           (select count(*) from workouts w where w.gym_id = g.id)::int as sessions,
           (select count(distinct w.user_id) from workouts w where w.gym_id = g.id)::int as people
    from gyms g
    where g.merged_into is null
      and (not g.is_private or g.admin_hidden)
      and (lower(g.name) like term or lower(g.city) like term or lower(g.street) like term)
    order by lower(g.name), g.city
    limit 1000
  ) r;
  return result;
end;
$$;
revoke all on function public.admin_gyms(text) from public, anon;
grant execute on function public.admin_gyms(text) to authenticated;

-- ---------- fix a gym's name, address or pin ----------
create or replace function public.admin_update_gym(
  p_gym uuid, p_name text, p_street text, p_city text, p_state text,
  p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
declare
  n text := trim(coalesce(p_name, ''));
  s text := trim(coalesce(p_street, ''));
  c text := trim(coalesce(p_city, ''));
  st text := trim(coalesce(p_state, ''));
begin
  perform public.require_admin();
  if not exists (select 1 from gyms g where g.id = p_gym and g.merged_into is null
                   and (not g.is_private or g.admin_hidden)) then
    raise exception 'No such gym.' using errcode = '22023';
  end if;
  if n = '' then raise exception 'A gym needs a name.' using errcode = '22023'; end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'Give both latitude and longitude, or neither.' using errcode = '22023';
  end if;
  if p_lat is not null and (p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180) then
    raise exception 'Those coordinates are off the map.' using errcode = '22023';
  end if;
  if exists (select 1 from gyms g where g.id <> p_gym and g.merged_into is null
               and g.name = n and g.street = s and g.city = c and g.state = st) then
    raise exception 'Another gym already has that exact name and address. Merge them instead.' using errcode = '23505';
  end if;
  update gyms set name = n, street = s, city = c, state = st, lat = p_lat, lng = p_lng where id = p_gym;
end;
$$;
revoke all on function public.admin_update_gym(uuid, text, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.admin_update_gym(uuid, text, text, text, text, double precision, double precision) to authenticated;

-- ---------- merge a duplicate into the gym to keep ----------
-- Every workout at the duplicate moves to the kept gym. Returns how many.
create or replace function public.admin_merge_gyms(p_from uuid, p_into uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  a public.gyms%rowtype;
  b public.gyms%rowtype;
  moved int;
begin
  perform public.require_admin();
  if p_from = p_into then raise exception 'Pick two different gyms.' using errcode = '22023'; end if;
  select * into a from gyms where id = p_from;
  if not found or a.merged_into is not null then raise exception 'No such gym.' using errcode = '22023'; end if;
  select * into b from gyms where id = p_into;
  if not found or b.merged_into is not null then raise exception 'No such gym.' using errcode = '22023'; end if;
  if (a.is_private and not a.admin_hidden) or (b.is_private and not b.admin_hidden) then
    raise exception 'Private gyms can''t be merged.' using errcode = '22023';
  end if;

  update workouts set gym_id = p_into where gym_id = p_from;
  get diagnostics moved = row_count;
  if to_regclass('public.presence') is not null then
    execute 'update public.presence set gym_id = $2 where gym_id = $1' using p_from, p_into;
  end if;
  -- the kept gym takes the duplicate's pin if it has none of its own
  if b.lat is null and a.lat is not null then
    update gyms set lat = a.lat, lng = a.lng where id = p_into;
  end if;
  -- "my gym" follows
  update profiles
     set settings = jsonb_set(settings, '{homeGymId}', to_jsonb(p_into::text))
   where settings ->> 'homeGymId' = p_from::text;
  -- anything merged into the duplicate earlier now points at the kept gym
  update gyms set merged_into = p_into where merged_into = p_from;
  update gyms set merged_into = p_into where id = p_from;
  return moved;
end;
$$;
revoke all on function public.admin_merge_gyms(uuid, uuid) from public, anon;
grant execute on function public.admin_merge_gyms(uuid, uuid) to authenticated;

-- ---------- take a gym out of the directory, or put it back ----------
-- Nothing is deleted. A hidden gym is still there for the people who have
-- trained at it (their workouts keep their gym); everyone else stops
-- seeing it, on the map and in search.
create or replace function public.admin_hide_gym(p_gym uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if not exists (select 1 from gyms g where g.id = p_gym and g.merged_into is null
                   and (not g.is_private or g.admin_hidden)) then
    raise exception 'No such gym.' using errcode = '22023';
  end if;
  update gyms set is_private = coalesce(p_hidden, false), admin_hidden = coalesce(p_hidden, false)
   where id = p_gym;
end;
$$;
revoke all on function public.admin_hide_gym(uuid, boolean) from public, anon;
grant execute on function public.admin_hide_gym(uuid, boolean) to authenticated;

-- ---------- address lookups on or off, for everyone ----------
create or replace function public.admin_set_geocoding(p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  insert into app_config (key, value) values (
    'maps',
    jsonb_build_object('geocoding', coalesce(p_on, true),
                       'geocoder_url', 'https://nominatim.openstreetmap.org/search',
                       'tile_url', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'))
  on conflict (key) do update
    set value = jsonb_set(app_config.value, '{geocoding}', to_jsonb(coalesce(p_on, true))),
        updated_at = now();
  return coalesce(p_on, true);
end;
$$;
revoke all on function public.admin_set_geocoding(boolean) from public, anon;
grant execute on function public.admin_set_geocoding(boolean) to authenticated;
