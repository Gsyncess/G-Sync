create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  username text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists username text,
  add column if not exists display_name text;

alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  profile_username text;
  profile_display_name text;
begin
  profile_username := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'User'
  );
  profile_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    profile_username
  );

  insert into public.profiles (id, email, username, display_name)
  values (new.id, new.email, profile_username, profile_display_name)
  on conflict (id) do update
    set email = excluded.email,
        username = excluded.username,
        display_name = excluded.display_name,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email, username, display_name)
select
  id,
  email,
  coalesce(
    nullif(raw_user_meta_data ->> 'username', ''),
    nullif(raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(email, ''), '@', 1), ''),
    'User'
  ),
  coalesce(
    nullif(raw_user_meta_data ->> 'full_name', ''),
    nullif(raw_user_meta_data ->> 'name', ''),
    nullif(raw_user_meta_data ->> 'username', ''),
    nullif(split_part(coalesce(email, ''), '@', 1), ''),
    'User'
  )
from auth.users
on conflict (id) do update
  set email = excluded.email,
      username = coalesce(public.profiles.username, excluded.username),
      display_name = coalesce(public.profiles.display_name, excluded.display_name),
      updated_at = now();

create table if not exists public.bot_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.bot_subscriptions enable row level security;

drop policy if exists "Users can read their own bot subscription" on public.bot_subscriptions;
create policy "Users can read their own bot subscription"
  on public.bot_subscriptions for select
  using (auth.uid() = user_id);

create table if not exists public.nowpayments_payments (
  payment_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  order_id text not null unique,
  customer_email text,
  customer_name text,
  price_amount numeric not null,
  price_currency text not null,
  pay_currency text not null,
  pay_amount numeric not null,
  pay_address text not null,
  payment_status text not null,
  actually_paid numeric,
  payment_expires_at timestamptz,
  ipn_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz
);

alter table public.nowpayments_payments
  add column if not exists payment_expires_at timestamptz,
  add column if not exists customer_email text,
  add column if not exists customer_name text;

create index if not exists nowpayments_payments_user_created_idx
  on public.nowpayments_payments (user_id, created_at desc);

alter table public.nowpayments_payments enable row level security;

create or replace function public.activate_gsync_subscription_from_payment(p_payment_id text)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payment_user_id uuid;
  payment_status text;
  payment_activated_at timestamptz;
  next_expiry timestamptz;
begin
  select user_id, nowpayments_payments.payment_status, activated_at
    into payment_user_id, payment_status, payment_activated_at
    from public.nowpayments_payments
    where nowpayments_payments.payment_id = p_payment_id
    for update;

  if payment_user_id is null then
    raise exception 'Payment not found';
  end if;

  if payment_status <> 'finished' then
    return null;
  end if;

  if payment_activated_at is not null then
    select expires_at into next_expiry
      from public.bot_subscriptions
      where user_id = payment_user_id;
    return next_expiry;
  end if;

  insert into public.bot_subscriptions as current_subscription (user_id, expires_at, updated_at)
    values (payment_user_id, now() + interval '12 hours', now())
    on conflict (user_id) do update
      set expires_at = greatest(current_subscription.expires_at, now()) + interval '12 hours',
          updated_at = now()
    returning expires_at into next_expiry;

  update public.nowpayments_payments
    set activated_at = now(), updated_at = now()
    where payment_id = p_payment_id;

  return next_expiry;
end;
$$;

revoke all on function public.activate_gsync_subscription_from_payment(text) from public, anon, authenticated;
grant execute on function public.activate_gsync_subscription_from_payment(text) to service_role;
