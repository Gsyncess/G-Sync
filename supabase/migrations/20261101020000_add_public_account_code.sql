create sequence if not exists public.gsync_account_code_seq
  start with 6839387474588
  increment by 1
  minvalue 1000000000000
  maxvalue 9999999999999
  no cycle;

alter table public.profiles
  add column if not exists account_code text;

update public.profiles
  set account_code = 'G-' || nextval('public.gsync_account_code_seq')::text
  where account_code is null;

alter table public.profiles
  alter column account_code set not null;

create unique index if not exists profiles_account_code_key
  on public.profiles (account_code);

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

  insert into public.profiles (id, account_code, email, username, display_name)
  values (
    new.id,
    'G-' || nextval('public.gsync_account_code_seq')::text,
    new.email,
    profile_username,
    profile_display_name
  )
  on conflict (id) do update
    set email = excluded.email,
        username = excluded.username,
        display_name = excluded.display_name,
        updated_at = now();
  return new;
end;
$$;
