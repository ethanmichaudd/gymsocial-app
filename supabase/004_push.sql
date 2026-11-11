-- =========================================================================
-- GymSocial — push notifications
-- One row per phone that turned Notifications on. The Edge Function reads
-- these (with the service key) to know where to send; each person can only
-- see and manage their own rows.
-- =========================================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,     -- the phone's push address (Apple's server)
  p256dh text not null,              -- the phone's encryption key
  auth text not null,                -- and its auth secret
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "see your own subscriptions" on public.push_subscriptions;
create policy "see your own subscriptions" on public.push_subscriptions
  for select using (user_id = auth.uid());
drop policy if exists "add your own subscriptions" on public.push_subscriptions;
create policy "add your own subscriptions" on public.push_subscriptions
  for insert with check (user_id = auth.uid());
drop policy if exists "update your own subscriptions" on public.push_subscriptions;
create policy "update your own subscriptions" on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove your own subscriptions" on public.push_subscriptions;
create policy "remove your own subscriptions" on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- A phone that was signed in to another account keeps the same endpoint.
-- Re-claiming it has to move the row, which RLS can't allow directly (the row
-- isn't yours yet), so this does it for the signed-in user only.
create or replace function public.claim_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;
revoke all on function public.claim_push_subscription(text, text, text) from public, anon;
grant execute on function public.claim_push_subscription(text, text, text) to authenticated;
