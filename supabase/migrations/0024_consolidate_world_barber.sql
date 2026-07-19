-- 0024_consolidate_world_barber: DEV cleanup. There are 3 "World barber" salons
-- (onboarding one-man salons + the 0023 seed's "World Barber Salon"). Keep the one
-- real salon, move Mehdi + Naoufal (its owner) into it, and delete the rest —
-- including the duplicate Naoufal the 0023 seed created.
--
-- No-op on any DB that doesn't have the keeper salon (e.g. a fresh push), so it
-- only ever touches the database that actually has this mess.

do $$
declare
  v_keep  uuid := 'a9b393d0-6689-4861-915c-734d2edf8a8a'; -- the salon to keep
  v_owner uuid := 'd4ae1138-822a-4542-b197-6d3924d5ca2d'; -- its owner = Naoufal
  v_mehdi uuid;
  v_dup   uuid;
begin
  if not exists (select 1 from public.salons where id = v_keep) then
    raise notice 'Keeper salon % not present — nothing to consolidate', v_keep;
    return;
  end if;

  select id into v_mehdi from public.profiles
  where role = 'barber' and full_name ilike '%mehdi%'
  order by created_at limit 1;
  if v_mehdi is null then
    raise notice 'No barber named Mehdi found — attaching the owner only';
  end if;

  -- the salon's two barbers: Naoufal (owner) + Mehdi
  update public.barbers set salon_id = v_keep, status = 'approved' where id = v_owner;
  update public.barbers set salon_id = v_keep where id = v_mehdi;

  -- drop the duplicate Naoufal the 0023 seed made, but only if he isn't the real owner
  select id into v_dup from auth.users
  where email = 'naoufal@worldbarber.ma' and id <> v_owner;
  if v_dup is not null then
    delete from public.wallet_transactions where created_by = v_dup or user_id = v_dup;
    delete from public.bookings where barber_id = v_dup or customer_id = v_dup;
    update public.barbers set salon_id = null where id = v_dup;   -- unlink before its salon dies
    delete from public.salons where owner_id = v_dup;
    delete from auth.users where id = v_dup;  -- cascades profile → barber → services/availability
  end if;

  -- move anything still tied to a leftover "World barber" salon onto the keeper,
  -- so the foreign keys don't block the delete…
  update public.barbers set salon_id = v_keep
  where salon_id in (select id from public.salons where id <> v_keep and name ilike '%world barber%');
  update public.wallet_transactions set salon_id = v_keep
  where salon_id in (select id from public.salons where id <> v_keep and name ilike '%world barber%');

  -- …then delete the duplicate salons
  delete from public.salons where id <> v_keep and name ilike '%world barber%';

  raise notice 'Consolidated into % (owner %, Mehdi %)', v_keep, v_owner, v_mehdi;
end $$;
