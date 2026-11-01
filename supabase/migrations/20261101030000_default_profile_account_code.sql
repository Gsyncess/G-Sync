alter table public.profiles
  alter column account_code
  set default 'G-' || nextval('public.gsync_account_code_seq')::text;
