-- 0023_seed_world_barber: DEV/DEMO SEED (not schema) — World Barber Salon.
-- Two barbers: Mehdi (already onboarded, looked up by name) + Naoufal, a brand-new
-- loginable owner. Idempotent: re-running after the salon exists is a no-op.
--
--   Naoufal login →  email: naoufal@worldbarber.ma   password: Naoufal123!
--
-- Creating Naoufal means seeding an auth.users row; the on_auth_user_created
-- trigger then makes his profiles + barbers rows, which we flesh out below.

create extension if not exists pgcrypto with schema extensions; -- crypt()/gen_salt()

do $$
declare
  v_naoufal uuid;
  v_mehdi   uuid;
  v_salon   uuid;
  v_email   text := 'naoufal@worldbarber.ma';
begin
  if exists (select 1 from public.salons where name = 'World Barber Salon') then
    raise notice 'World Barber Salon already seeded — skipping';
    return;
  end if;

  -- Mehdi is already in the DB; find him by name (first barber match)
  select p.id into v_mehdi
  from public.profiles p
  where p.role = 'barber' and p.full_name ilike '%mehdi%'
  order by p.created_at
  limit 1;
  if v_mehdi is null then
    raise exception 'No barber named Mehdi found — onboard him first';
  end if;

  -- Naoufal: reuse if a prior partial run created him, else make the auth user
  select id into v_naoufal from auth.users where email = v_email;
  if v_naoufal is null then
    v_naoufal := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_naoufal,
      'authenticated', 'authenticated', v_email,
      extensions.crypt('Naoufal123!', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', 'Naoufal El Idrissi',
                         'phone', '+212 661 234 567', 'role', 'barber'),
      '', '', '', ''
    );
    -- email-login identity (required by modern GoTrue)
    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_naoufal::text, v_naoufal,
      jsonb_build_object('sub', v_naoufal::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end if;

  -- the salon, owned by Naoufal
  insert into public.salons (owner_id, name, address, lat, lng, bio)
  values (v_naoufal, 'World Barber Salon',
          'Bd Mohammed V, Tanger', 35.7690, -5.8000,
          'Fades, beards and hot-towel shaves in the heart of Tangier.')
  returning id into v_salon;

  -- flesh out Naoufal (the trigger left a bare barber row)
  update public.barbers set
    salon_id = v_salon, status = 'approved',
    specialty = 'Skin fades & beard design', years_experience = 9,
    bio = 'Owner of World Barber. Nine years on the chair, fade specialist.'
  where id = v_naoufal;

  -- Mehdi joins the salon (his own status/profile untouched; his old one-man
  -- salon from the 0011 backfill is left orphaned — harmless for a seed)
  update public.barbers set salon_id = v_salon where id = v_mehdi;

  -- Naoufal's menu
  insert into public.services (barber_id, name, price_cents, duration_min, category) values
    (v_naoufal, 'Skin Fade',              8000, 40, 'Hair Services'),
    (v_naoufal, 'Classic Cut',            6000, 30, 'Hair Services'),
    (v_naoufal, 'Fade + Beard Combo',    12000, 55, 'Hair Services'),
    (v_naoufal, 'Beard Trim & Line-up',   5000, 25, 'Beard Services'),
    (v_naoufal, 'Hot Towel Shave',        7000, 35, 'Beard Services');

  -- weekly hours so he's actually bookable: Mon–Sat, 10:00–20:00
  insert into public.availability (barber_id, weekday, start_min, end_min)
  select v_naoufal, wd, 600, 1200 from generate_series(1, 6) as wd;

  raise notice 'Seeded World Barber Salon (owner Naoufal % / Mehdi %)', v_naoufal, v_mehdi;
end $$;
