-- 0130_account_deletion: deleting an account had stopped working for nearly everyone,
-- and a phone kept the last person's pushes after they signed out.
--
-- ---- 1 · delete the person, keep the rows ------------------------------------------
--
-- 0039's delete_my_account removed the profile and let the cascades take the rest.
-- Since then:
--   · push_attempts (0104) cascades from profiles but refuses every delete, so anyone
--     who was ever sent a notification could not leave;
--   · wallet_transactions (0022) references profiles with no cascade and is
--     append-only (0075), so neither could anyone who ever topped up;
--   · a barber's drawer, statements and invoices are append-only by design.
-- Those rows have to outlive the person anyway — they are what a shop, a customer and
-- Sterncut owe each other. So deleting now erases who it was and keeps what happened:
-- the profile, barber row and auth user stay as a tombstone with no name, phone,
-- photo or bio on them and a public code nobody has, and every booking, payment and review keeps its
-- key and loses its name. Sign-in ends for good (identities, sessions and password
-- cleared, the user banned), so the same Google account or email signs up fresh.
--
-- Refused, with the reason, while something is still open:
--   · an upcoming booking on either side — cancelling tells the other person and
--     settles any deposit; a nameless booking would sit in a barber's day instead;
--   · a shop he owns — billing, drawer and team go through support;
--   · the shop's cash, or a drawer handover under way — the same two rules as the
--     owner's own "remove" (0128 salon_remove_member);
--   · a cash shortfall still open against him (0128);
--   · staff accounts (admin, agent) — ops closes those.
-- A barber in a team otherwise leaves it on the way out, exactly as
-- salon_remove_member would move him; 0128's trigger writes the day down.
--
-- The name lock (0109) would have copied the name into previous_name — undoing the
-- erase — and refused a second change inside sixty days. It stands aside for a
-- deletion. deleted_at has no update grant, so only this function can set it.
--
-- Files go through the Storage API, not SQL: the app removes the avatar and portfolio
-- folders after this succeeds. Avatars had no delete (or select) policy, so a deleted
-- user's photo stayed at its public URL; the two policies below let the owner remove
-- it. ID documents stay — private, ops-only, and the only KYC record there is.
--
-- ---- 2 · the push token follows whoever is signed in -------------------------------
--
-- push_tokens is keyed on the token, and its update policy only lets the owner touch
-- the row. When a second person signed in on a phone, the app's upsert was refused by
-- RLS, silently, so the token stayed with the first person: their bookings and
-- messages kept arriving on a phone they had left, and the new person got nothing.
-- claim_push_token hands the token to whoever registers it. The app also deletes its
-- token before signing out, while the session can still do it.

alter table public.profiles add column if not exists deleted_at timestamptz;

create or replace function public.profiles_name_lock()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.full_name is not distinct from old.full_name then return new; end if;

  -- 0130: an account being deleted keeps no name, not even the old one
  if new.deleted_at is not null and old.deleted_at is null then return new; end if;

  -- a barber nobody can book yet has no customers who know the name
  if not exists (select 1 from public.barbers b
                 where b.id = new.id and b.status = 'approved') then
    return new;
  end if;

  -- ops correcting a name is not the barber spending their one change
  if public.is_admin() then return new; end if;

  if old.name_changed_at is not null
     and old.name_changed_at > now() - interval '60 days' then
    raise exception 'Your name can change again on %',
      to_char((old.name_changed_at + interval '60 days') at time zone 'Africa/Casablanca',
              'FMDD FMMonth YYYY');
  end if;

  new.previous_name := old.full_name;
  new.name_changed_at := now();
  return new;
end;
$$;

create or replace function public.delete_my_account(p_confirm text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_role text;
  v_salon uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if upper(btrim(coalesce(p_confirm, ''))) <> 'DELETE' then
    raise exception 'Type DELETE to confirm';
  end if;

  select p.role into v_role from public.profiles p where p.id = v_me and p.deleted_at is null;
  if v_role is null then raise exception 'This account is already deleted'; end if;
  if v_role not in ('customer', 'barber') then
    raise exception 'Staff accounts are closed by ops, not from the app';
  end if;

  if exists (select 1 from public.bookings b
              where (b.customer_id = v_me or b.barber_id = v_me)
                and b.status in ('pending', 'confirmed')
                and b.completed_at is null and b.ends_at > now()) then
    raise exception 'Cancel or move your upcoming bookings first';
  end if;

  if exists (select 1 from public.salons s where s.owner_id = v_me) then
    raise exception 'You own a shop on Sterncut. Close it or hand it over with support first';
  end if;

  select b.salon_id into v_salon from public.barbers b where b.id = v_me;
  if v_salon is not null then
    if v_me = public.till_of(v_salon) then
      raise exception 'You hold the shop''s cash. Hand the drawer to someone else first';
    end if;
    if exists (select 1 from public.drawer_transfers t
                where t.salon_id = v_salon and t.state in ('pending', 'mismatch')
                  and v_me in (t.from_id, t.to_id)) then
      raise exception 'A handover of the drawer involving you is under way';
    end if;
  end if;

  if exists (select 1 from public.barber_shortfalls f
              where f.barber_id = v_me and f.status = 'open') then
    raise exception 'A cash shortfall is still open against you. Settle it with the shop''s cash agent first';
  end if;

  -- the person goes; the rows stay
  update public.profiles set
    full_name = null, phone = null, avatar_url = null, dob = null, usual_service = null,
    preferred_barber_id = null, referral_code = null, previous_name = null,
    name_changed_at = null, deleted_at = now()
  where id = v_me;

  -- leaves his team the way salon_remove_member moves him, then goes unbookable
  update public.barbers set
    salon_id = null, salon_status = 'pending', salon_role = 'barber',
    pay_model = 'rent', commission_pct = 55, rent_cents = 0, chair_label = null,
    bio = null, specialty = null, years_experience = null, languages = '{}',
    -- not null (0110): a fresh code is how the old link dies
    short_code = public.new_barber_code(),
    accepting_bookings = false
  where id = v_me;
  update public.services set is_active = false where barber_id = v_me;

  delete from public.push_tokens where user_id = v_me;
  delete from public.wishlists where customer_id = v_me;
  delete from public.waitlist_requests where customer_id = v_me;
  update public.searches set customer_id = null where customer_id = v_me;

  -- sign-in, for good. A far date rather than 'infinity', which Auth cannot parse.
  delete from auth.identities where user_id = v_me;
  delete from auth.sessions where user_id = v_me;
  update auth.users set
    email = null, phone = null, encrypted_password = null,
    raw_user_meta_data = '{}'::jsonb, banned_until = now() + interval '100 years',
    updated_at = now()
  where id = v_me;
end;
$$;

create or replace function public.claim_push_token(p_token text, p_platform text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if coalesce(btrim(p_token), '') = '' then raise exception 'No token'; end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

-- default privileges hand anon EXECUTE on anything new (0117): take it back by name
revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;
revoke execute on function public.claim_push_token(text, text) from public, anon;
grant execute on function public.claim_push_token(text, text) to authenticated;

drop policy if exists "avatars_select_own" on storage.objects;
create policy "avatars_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---- checked at apply time ---------------------------------------------------
do $$
begin
  -- the last step writes to auth; find out now, not on a customer's phone
  assert has_table_privilege('auth.users', 'UPDATE'), 'cannot update auth.users';
  assert has_table_privilege('auth.identities', 'DELETE'), 'cannot delete auth.identities';
  assert has_table_privilege('auth.sessions', 'DELETE'), 'cannot delete auth.sessions';

  -- nothing deletes a profile any more: that is what broke on the append-only rows
  assert (select p.prosrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'public' and p.proname = 'delete_my_account')
         not ilike '%delete from public.profiles%', 'delete_my_account still deletes the profile';

  begin
    perform public.delete_my_account('DELETE');
    raise exception 'deleted with nobody signed in';
  exception when raise_exception then
    assert sqlerrm = 'Not signed in', 'no session: ' || sqlerrm;
  end;
  begin
    perform public.claim_push_token('ExponentPushToken[x]', 'ios');
    raise exception 'claimed a token with nobody signed in';
  exception when raise_exception then
    assert sqlerrm = 'Not signed in', 'no session: ' || sqlerrm;
  end;
end $$;
