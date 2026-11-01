drop function if exists public.activate_gsync_subscription_from_payment(text);

alter table public.nowpayments_payments rename to legacy_subscription_payments;

alter index if exists public.nowpayments_payments_user_created_idx
  rename to legacy_subscription_payments_user_created_idx;

create table if not exists public.plisio_payments (
  payment_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  order_id text not null unique,
  customer_email text,
  price_amount numeric not null,
  price_currency text not null default 'USD',
  payment_amount numeric not null,
  payment_currency text not null,
  payment_address text not null,
  qr_code text,
  payment_status text not null default 'new',
  callback_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz
);

create index if not exists plisio_payments_user_created_idx
  on public.plisio_payments (user_id, created_at desc);

alter table public.plisio_payments enable row level security;

create or replace function public.activate_gsync_subscription_from_plisio_payment(p_payment_id text)
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
  select plisio_payments.user_id, plisio_payments.payment_status, plisio_payments.activated_at
    into payment_user_id, payment_status, payment_activated_at
    from public.plisio_payments
    where plisio_payments.payment_id = p_payment_id
    for update;

  if payment_user_id is null then
    raise exception 'Payment not found';
  end if;

  if payment_status <> 'completed' then
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

  update public.plisio_payments
    set activated_at = now(), updated_at = now()
    where payment_id = p_payment_id;

  return next_expiry;
end;
$$;

revoke all on function public.activate_gsync_subscription_from_plisio_payment(text) from public, anon, authenticated;
grant execute on function public.activate_gsync_subscription_from_plisio_payment(text) to service_role;
