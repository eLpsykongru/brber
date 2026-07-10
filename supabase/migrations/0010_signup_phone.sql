-- 0010_signup_phone: capture phone at signup (column already exists since 0001).
-- Same body as the 0001 trigger, plus phone from the signup metadata.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  new_role text := case when new.raw_user_meta_data ->> 'role' = 'barber'
                        then 'barber' else 'customer' end; -- 'admin' can never be self-assigned
begin
  insert into public.profiles (id, full_name, phone, role)
  values (new.id,
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'phone',
          new_role);
  if new_role = 'barber' then
    insert into public.barbers (id) values (new.id);
  end if;
  return new;
end;
$$;
