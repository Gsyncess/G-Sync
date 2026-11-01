alter table public.plisio_payments
  add column if not exists expires_at timestamptz;

update public.plisio_payments
set expires_at = created_at + interval '30 minutes'
where expires_at is null
  and activated_at is null
  and payment_status in ('new', 'pending');

create index if not exists plisio_payments_pending_expiration_idx
  on public.plisio_payments (expires_at)
  where expires_at is not null
    and activated_at is null
    and payment_status in ('new', 'pending');
