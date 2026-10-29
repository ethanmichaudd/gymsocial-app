-- =========================================================================
-- GymSocial — database schema (step 2)
--
-- Run once in your Supabase project: SQL Editor -> paste -> Run.
-- Mirrors the shape the app already uses, so your exported backup imports
-- cleanly. Row-level security is what actually enforces privacy — the UI
-- hiding something is not protection.
-- =========================================================================

-- ---------- people ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  is_private boolean not null default false,
  weekly_goal int not null default 3,
  streak_mode text not null default 'weekly' check (streak_mode in ('weekly','daily','custom')),
  custom_count int not null default 4,
  custom_days int not null default 10,
  created_at timestamptz not null default now()
);

-- ---------- gyms ----------
create table if not exists public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  offerings text[] default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (name, city)
);

-- ---------- exercise catalogue ("inventory") ----------
-- Shared built-ins have owner_id null; anything you invent belongs to you.
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  category text,
  metric text not null default 'reps' check (metric in ('reps','time','distance')),
  created_at timestamptz not null default now()
);
create unique index if not exists exercises_owner_name_idx
  on public.exercises (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- ---------- sessions ----------
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  gym_id uuid references public.gyms(id),
  title text,
  performed_at timestamptz not null,   -- start of the session
  ended_at timestamptz,                -- optional; duration = ended_at - performed_at
  calories int,
  created_at timestamptz not null default now()
);
create index if not exists workouts_user_time_idx on public.workouts (user_id, performed_at desc);

create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  order_index int not null default 0,
  metric text not null default 'reps' check (metric in ('reps','time','distance')),
  note text,
  superset_group text   -- same value = performed together (A1/A2)
);
create index if not exists we_workout_idx on public.workout_exercises (workout_id);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises(id) on delete cascade,
  set_number int not null,
  reps int,
  seconds int,
  weight numeric(7,2),
  weight_unit text default 'lb' check (weight_unit in ('lb','kg')),
  distance numeric(8,2),
  distance_unit text default 'mi' check (distance_unit in ('mi','km'))
);
create index if not exists ws_we_idx on public.workout_sets (workout_exercise_id);

-- ---------- social (step 3) ----------
-- follows = whose sessions reach your feed (one-way)
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

-- connections = mutual, accepted; this is what unlocks a private account
create table if not exists public.connections (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)   -- store each pair once, smaller id first
);

create table if not exists public.connection_requests (
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id),
  check (from_id <> to_id)
);

-- =========================================================================
-- Row Level Security
-- =========================================================================
alter table public.profiles            enable row level security;
alter table public.gyms                enable row level security;
alter table public.exercises           enable row level security;
alter table public.workouts            enable row level security;
alter table public.workout_exercises   enable row level security;
alter table public.workout_sets        enable row level security;
alter table public.follows             enable row level security;
alter table public.connections         enable row level security;
alter table public.connection_requests enable row level security;

-- Are these two connected? (pair stored smaller-id-first)
create or replace function public.is_connected(a uuid, b uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.connections c
    where c.user_a = least(a, b) and c.user_b = greatest(a, b)
  );
$$;

-- Can the current user see this person's training?
create or replace function public.can_view(target uuid)
returns boolean language sql stable as $$
  select target = auth.uid()
      or not coalesce((select is_private from public.profiles where id = target), false)
      or public.is_connected(auth.uid(), target);
$$;

-- profiles
create policy "profiles readable when signed in" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "insert own profile" on public.profiles
  for insert with check (auth.uid() = id);
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id);

-- gyms: shared directory
create policy "gyms readable" on public.gyms
  for select using (auth.role() = 'authenticated');
create policy "add gyms" on public.gyms
  for insert with check (auth.uid() = created_by);
create policy "edit gyms you added" on public.gyms
  for update using (auth.uid() = created_by);

-- exercises: built-ins plus your own
create policy "exercises readable" on public.exercises
  for select using (owner_id is null or owner_id = auth.uid());
create policy "add own exercises" on public.exercises
  for insert with check (owner_id = auth.uid());
create policy "edit own exercises" on public.exercises
  for update using (owner_id = auth.uid());
create policy "delete own exercises" on public.exercises
  for delete using (owner_id = auth.uid());

-- workouts: you write yours; others read per privacy
create policy "read workouts you're allowed to" on public.workouts
  for select using (public.can_view(user_id));
create policy "write own workouts" on public.workouts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- children inherit the parent workout's visibility
create policy "read workout_exercises" on public.workout_exercises
  for select using (exists (
    select 1 from public.workouts w
    where w.id = workout_id and public.can_view(w.user_id)
  ));
create policy "write own workout_exercises" on public.workout_exercises
  for all using (exists (
    select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid()
  ));

create policy "read workout_sets" on public.workout_sets
  for select using (exists (
    select 1 from public.workout_exercises we
    join public.workouts w on w.id = we.workout_id
    where we.id = workout_exercise_id and public.can_view(w.user_id)
  ));
create policy "write own workout_sets" on public.workout_sets
  for all using (exists (
    select 1 from public.workout_exercises we
    join public.workouts w on w.id = we.workout_id
    where we.id = workout_exercise_id and w.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.workout_exercises we
    join public.workouts w on w.id = we.workout_id
    where we.id = workout_exercise_id and w.user_id = auth.uid()
  ));

-- follows
create policy "follows readable" on public.follows
  for select using (auth.role() = 'authenticated');
create policy "follow as yourself" on public.follows
  for insert with check (follower_id = auth.uid());
create policy "unfollow as yourself" on public.follows
  for delete using (follower_id = auth.uid());

-- connections: either side may read or remove; creation goes through a request
create policy "connections readable" on public.connections
  for select using (auth.role() = 'authenticated');
create policy "remove your connection" on public.connections
  for delete using (auth.uid() in (user_a, user_b));

-- requests: sender and recipient can see; recipient accepts by inserting
-- into connections (do that in an edge function or a trigger for safety)
create policy "see your requests" on public.connection_requests
  for select using (auth.uid() in (from_id, to_id));
create policy "send a request" on public.connection_requests
  for insert with check (from_id = auth.uid());
create policy "cancel or decline" on public.connection_requests
  for delete using (auth.uid() in (from_id, to_id));

-- =========================================================================
-- Starter exercise catalogue (shared: owner_id null)
-- =========================================================================
insert into public.exercises (owner_id, name, category, metric) values
  (null, 'Barbell Bench Press', 'push', 'reps'),
  (null, 'Incline Dumbbell Press', 'push', 'reps'),
  (null, 'Overhead Press', 'push', 'reps'),
  (null, 'Lateral Raise', 'push', 'reps'),
  (null, 'Tricep Pushdown', 'push', 'reps'),
  (null, 'Pull-Up', 'pull', 'reps'),
  (null, 'Lat Pulldown', 'pull', 'reps'),
  (null, 'Barbell Row', 'pull', 'reps'),
  (null, 'Bicep Curl', 'pull', 'reps'),
  (null, 'Back Squat', 'legs', 'reps'),
  (null, 'Deadlift', 'legs', 'reps'),
  (null, 'Romanian Deadlift', 'legs', 'reps'),
  (null, 'Leg Press', 'legs', 'reps'),
  (null, 'Plank', 'core', 'time'),
  (null, 'Treadmill Run', 'cardio', 'distance'),
  (null, 'Stationary Bike', 'cardio', 'distance')
on conflict do nothing;
