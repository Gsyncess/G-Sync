create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  profile_first_name text;
begin
  profile_first_name := coalesce(
    nullif(split_part(trim(new.raw_user_meta_data ->> 'first_name'), ' ', 1), ''),
    nullif(split_part(trim(new.raw_user_meta_data ->> 'given_name'), ' ', 1), ''),
    nullif(split_part(trim(new.raw_user_meta_data ->> 'full_name'), ' ', 1), ''),
    nullif(split_part(trim(new.raw_user_meta_data ->> 'name'), ' ', 1), ''),
    nullif(split_part(trim(new.raw_user_meta_data ->> 'username'), ' ', 1), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'User'
  );

  insert into public.profiles (id, account_code, email, username, display_name)
  values (
    new.id,
    'G-' || nextval('public.gsync_account_code_seq')::text,
    new.email,
    profile_first_name,
    profile_first_name
  )
  on conflict (id) do update
    set email = excluded.email,
        username = excluded.username,
        display_name = excluded.display_name,
        updated_at = now();
  return new;
end;
$$;

update public.profiles as profile
  set username = coalesce(
        nullif(split_part(trim(auth_user.raw_user_meta_data ->> 'first_name'), ' ', 1), ''),
        profile.username
      ),
      display_name = coalesce(
        nullif(split_part(trim(auth_user.raw_user_meta_data ->> 'first_name'), ' ', 1), ''),
        profile.display_name
      ),
      updated_at = now()
  from auth.users as auth_user
  where auth_user.id = profile.id
    and nullif(trim(auth_user.raw_user_meta_data ->> 'first_name'), '') is not null;
