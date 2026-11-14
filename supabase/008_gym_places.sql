-- =========================================================================
-- GymSocial — gyms as places
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- * a gym has coordinates (a pin on the map) and can be marked private
--   (a home gym: off the map and out of everyone else's search)
-- * gym_directory(): every gym you may see, with how busy it is — counts only
-- * gym_stats(gym): what's popular there and when it's busy — totals only,
--   never a name and never a workout
-- * set_gym_location(gym, lat, lng): place or move a gym's pin
-- * app_config: where the map and the address lookup come from, so either
--   can be switched or turned off here without releasing a new version
--
-- The privacy rule for every number below is the one the rest of the app
-- already uses, can_view(): public accounts, your friends and you. A private
-- account you aren't friends with is not counted anywhere.
-- =========================================================================

-- ---------- gyms: where, and whether it's private ----------
alter table public.gyms add column if not exists lat double precision;
alter table public.gyms add column if not exists lng double precision;
alter table public.gyms add column if not exists is_private boolean not null default false;

alter table public.gyms drop constraint if exists gyms_latlng_range;
alter table public.gyms add constraint gyms_latlng_range check (
  (lat is null and lng is null)
  or (lat between -90 and 90 and lng between -180 and 180)
);

create index if not exists workouts_gym_time_idx on public.workouts (gym_id, performed_at desc);

-- ---------- place or move a pin ----------
-- A gym with no pin yet can be placed by anyone signed in (that is how the
-- existing gyms get filled in). Once it has one, only the person who added
-- the gym or someone who has trained there can move it.
create or replace function public.set_gym_location(p_gym uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g public.gyms%rowtype;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'bad coordinates';
  end if;
  select * into g from gyms where id = p_gym;
  if not found then raise exception 'no such gym'; end if;
  if g.lat is not null
     and g.created_by is distinct from me
     and not exists (select 1 from workouts w where w.gym_id = p_gym and w.user_id = me) then
    raise exception 'Only people who train here can move the pin.';
  end if;
  update gyms set lat = p_lat, lng = p_lng where id = p_gym;
end;
$$;
revoke all on function public.set_gym_location(uuid, double precision, double precision) from public, anon;
grant execute on function public.set_gym_location(uuid, double precision, double precision) to authenticated;

-- ---------- the directory: every gym, with counts ----------
-- One row per gym you may see. The three numbers are counts of people and
-- sessions and nothing else. A private gym is listed only for the person who
-- added it and people who have trained there.
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
    and (not g.is_private
         or g.created_by = auth.uid()
         or exists (select 1 from workouts w where w.gym_id = g.id and w.user_id = auth.uid()))
  order by g.name
  limit 2000;
$$;
revoke all on function public.gym_directory() from public, anon;
grant execute on function public.gym_directory() to authenticated;

-- ---------- one gym: what's popular, when it's busy ----------
-- Returns totals only:
--   people_30d, sessions_30d   how many people / sessions in the last 30 days
--   top_exercises              [{ name, sets }] over the last 30 days
--   by_hour                    24 numbers: sessions started in each hour of
--                              the day (in the caller's time zone), 90 days
-- There is no user id, name or workout anywhere in the result.
create or replace function public.gym_stats(p_gym uuid, p_tz text default 'UTC')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tz text := 'UTC';
  result jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  if exists (select 1 from pg_timezone_names where pg_timezone_names.name = p_tz) then tz := p_tz; end if;

  -- a private gym's numbers are for the people who use it
  if exists (
    select 1 from gyms g
    where g.id = p_gym and g.is_private
      and g.created_by is distinct from me
      and not exists (select 1 from workouts w where w.gym_id = p_gym and w.user_id = me)
  ) then
    return jsonb_build_object('people_30d', 0, 'sessions_30d', 0,
                              'top_exercises', '[]'::jsonb, 'by_hour', to_jsonb(array_fill(0, array[24])));
  end if;

  with seen as (
    select w.id, w.user_id, w.performed_at
    from workouts w
    where w.gym_id = p_gym
      and w.performed_at > now() - interval '90 days'
      and public.can_view(w.user_id)
  ),
  recent as (
    select * from seen where performed_at > now() - interval '30 days'
  ),
  top as (
    select max(e.name) as ex_name, count(*)::int as sets
    from recent r
    join workout_exercises we on we.workout_id = r.id
    join workout_sets ws on ws.workout_exercise_id = we.id
    join exercises e on e.id = we.exercise_id
    where we.metric <> 'cardio'
    group by lower(e.name)
    order by count(*) desc, max(e.name)
    limit 8
  ),
  hours as (
    select extract(hour from (s.performed_at at time zone tz))::int as h, count(*)::int as n
    from seen s group by 1
  )
  select jsonb_build_object(
    'people_30d',   (select count(distinct user_id) from recent),
    'sessions_30d', (select count(*) from recent),
    'top_exercises', coalesce((select jsonb_agg(jsonb_build_object('name', ex_name, 'sets', sets)
                                               order by sets desc, ex_name) from top), '[]'::jsonb),
    'by_hour', (select jsonb_agg(coalesce(hours.n, 0) order by hr.h)
                from generate_series(0, 23) as hr(h) left join hours on hours.h = hr.h)
  ) into result;
  return result;
end;
$$;
revoke all on function public.gym_stats(uuid, text) from public, anon;
grant execute on function public.gym_stats(uuid, text) to authenticated;

-- ---------- where the map comes from ----------
-- The app reads this on open. OpenStreetMap's usage policies ask that an
-- app can stop using their servers without shipping an update: set
-- "geocoding" to false to stop address lookups, or point either URL at
-- another provider, right here.
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists "config readable" on public.app_config;
create policy "config readable" on public.app_config for select using (true);
grant select on public.app_config to anon, authenticated;

insert into public.app_config (key, value) values (
  'maps',
  '{"geocoding": true,
    "geocoder_url": "https://nominatim.openstreetmap.org/search",
    "tile_url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png"}'::jsonb
) on conflict (key) do nothing;
