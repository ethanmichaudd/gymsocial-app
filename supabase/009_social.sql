-- =========================================================================
-- GymSocial — comments, training together, and "at the gym now"
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- * comments        friends can comment on each other's workouts
-- * workout_tags    "with Maya, Dev": the friends you trained with
-- * presence        opt-in "Maya is at Planet Fitness · 25m", friends only,
--                   gone after three hours whatever the app does
--
-- Gym leaderboards, share cards and the weekly recap need nothing here:
-- they are worked out on the phone from what it can already see.
-- =========================================================================

-- ---------- comments ----------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.comments drop constraint if exists comments_body_length;
alter table public.comments add constraint comments_body_length
  check (char_length(btrim(body)) between 1 and 500);
create index if not exists comments_workout_idx on public.comments (workout_id, created_at);

alter table public.comments enable row level security;

-- you can read comments wherever you can see the workout
drop policy if exists "read comments you can see" on public.comments;
create policy "read comments you can see" on public.comments
  for select using (exists (
    select 1 from public.workouts w
    where w.id = workout_id and public.can_view(w.user_id)
  ));

-- Writing one takes more than being able to see the workout: it has to be
-- your own, or a friend's. A stranger can react to a public workout with
-- an emoji, but can't write on it.
drop policy if exists "comment on your own or a friend's" on public.comments;
create policy "comment on your own or a friend's" on public.comments
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id
        and (w.user_id = auth.uid() or public.is_connected(auth.uid(), w.user_id))
    )
  );

-- you can take down what you wrote, and anything written on your workout
drop policy if exists "delete your comment or one on your workout" on public.comments;
create policy "delete your comment or one on your workout" on public.comments
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid())
  );

-- the server sets the time, so a phone with a wrong clock can't reorder a thread
create or replace function public.stamp_created_at()
returns trigger language plpgsql as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists comments_stamp on public.comments;
create trigger comments_stamp
  before insert on public.comments
  for each row execute function public.stamp_created_at();

grant select, insert, delete on public.comments to authenticated;

-- ---------- training together ----------
-- One row per friend tagged in a workout. Only the workout's owner can tag,
-- and only people they're friends with; the person tagged can remove
-- themselves.
create table if not exists public.workout_tags (
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workout_id, user_id)
);
create index if not exists workout_tags_user_idx on public.workout_tags (user_id);

alter table public.workout_tags enable row level security;

drop policy if exists "read tags on workouts you can see" on public.workout_tags;
create policy "read tags on workouts you can see" on public.workout_tags
  for select using (exists (
    select 1 from public.workouts w
    where w.id = workout_id and public.can_view(w.user_id)
  ));

drop policy if exists "tag friends in your own workout" on public.workout_tags;
create policy "tag friends in your own workout" on public.workout_tags
  for insert with check (
    public.is_connected(auth.uid(), user_id)
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid())
  );

drop policy if exists "untag: the owner, or yourself" on public.workout_tags;
create policy "untag: the owner, or yourself" on public.workout_tags
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid())
  );

drop trigger if exists workout_tags_stamp on public.workout_tags;
create trigger workout_tags_stamp
  before insert on public.workout_tags
  for each row execute function public.stamp_created_at();

grant select, insert, delete on public.workout_tags to authenticated;

-- ---------- at the gym now ----------
-- At most one row per person: where they are, since when. Friends can read
-- it for three hours and then it stops existing as far as anyone else can
-- tell, even if the phone never came back to clear it. The app only writes
-- a row when "Show friends when I'm at the gym" is on (off by default).
create table if not exists public.presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 hours'
);

alter table public.presence enable row level security;

drop policy if exists "see your own, and friends' while it lasts" on public.presence;
create policy "see your own, and friends' while it lasts" on public.presence
  for select using (
    user_id = auth.uid()
    or (expires_at > now() and public.is_connected(auth.uid(), user_id))
  );

drop policy if exists "set your own" on public.presence;
create policy "set your own" on public.presence
  for insert with check (user_id = auth.uid());

drop policy if exists "change your own" on public.presence;
create policy "change your own" on public.presence
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "clear your own" on public.presence;
create policy "clear your own" on public.presence
  for delete using (user_id = auth.uid());

-- The clock is the server's, and three hours is three hours: a phone can't
-- send a later expiry, and re-sending the same gym doesn't restart the timer.
create or replace function public.stamp_presence()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.gym_id is distinct from old.gym_id or old.expires_at <= now() then
    new.started_at := now();
  else
    new.started_at := old.started_at;
  end if;
  new.expires_at := new.started_at + interval '3 hours';
  return new;
end;
$$;

drop trigger if exists presence_stamp on public.presence;
create trigger presence_stamp
  before insert or update on public.presence
  for each row execute function public.stamp_presence();

grant select, insert, update, delete on public.presence to authenticated;
