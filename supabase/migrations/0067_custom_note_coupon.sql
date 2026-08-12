-- 0067_custom_note_coupon: the multi-service booking keeps its note and coupon.
--
-- Picking several services in one sitting has been possible since 0047, but only
-- through the Bundles tab. Moving it into the ordinary booking sheet means it
-- now meets two things that sheet collects and `book_custom` never carried:
-- 39d's note and 37's coupon. Without this, ticking a second service silently
-- threw away the note the customer had just written — the exact class of bug
-- barber 11 and customer 39 were about.
--
-- Both functions are DROPPED before being recreated rather than gaining
-- defaulted arguments. 0057 is the reason: adding a default to an existing name
-- leaves the old signature in place, PostgREST then sees two candidates and
-- answers "Could not choose the best candidate function" for every call.

drop function if exists public.book_bundle(uuid, timestamptz, int);
drop function if exists public.book_custom(uuid, uuid[], timestamptz, int);

create function public.book_bundle(
  p_bundle uuid, p_starts_at timestamptz, p_deposit_cents int default 0,
  p_note text default null, p_coupon uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_barber uuid;
  v_id uuid;
begin
  select barber_id into v_barber from public.bundles where id = p_bundle;
  if v_barber is null then raise exception 'Bundle unavailable'; end if;

  -- the coupon has to be on the row at INSERT: `fill_booking` is what turns
  -- coupon_id into discount_cents, so setting it afterwards would record the
  -- coupon as spent and charge the customer full price anyway.
  insert into public.bookings (customer_id, barber_id, service_id, bundle_id,
                               starts_at, ends_at, price_cents, deposit_cents,
                               notes, coupon_id)
  -- service_id/ends_at/price are placeholders: fill_booking overwrites all three
  values (auth.uid(), v_barber,
          (select service_id from public.bundle_services where bundle_id = p_bundle order by sort limit 1),
          p_bundle, p_starts_at, p_starts_at, 0, p_deposit_cents,
          p_note, p_coupon)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.book_bundle(uuid, timestamptz, int, text, uuid) to authenticated;

create function public.book_custom(
  p_barber uuid, p_services uuid[], p_starts_at timestamptz, p_deposit_cents int default 0,
  p_note text default null, p_coupon uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_bundle uuid;
  v_total int;
  v_n int;
begin
  if array_length(p_services, 1) is null then raise exception 'Pick at least one service'; end if;

  select count(*)::int, sum(price_cents)::int into v_n, v_total
    from public.services
   where id = any (p_services) and barber_id = p_barber and is_active;
  if v_n <> array_length(p_services, 1) then
    raise exception 'Those services do not all belong to this barber';
  end if;

  -- an ad-hoc bundle is priced at the sum of its parts: there is no saving to
  -- give away on a combination the shop never offered as one
  insert into public.bundles (barber_id, name, price_cents, is_adhoc)
  values (p_barber, 'One sitting', v_total, true)
  returning id into v_bundle;

  insert into public.bundle_services (bundle_id, service_id, sort)
  select v_bundle, s.id, row_number() over (order by array_position(p_services, s.id))
    from public.services s where s.id = any (p_services);

  return public.book_bundle(v_bundle, p_starts_at, p_deposit_cents, p_note, p_coupon);
end;
$$;
grant execute on function public.book_custom(uuid, uuid[], timestamptz, int, text, uuid) to authenticated;

do $$
begin
  -- the reason both were dropped first: two candidates is not an overload, it
  -- is an outage. Exactly one of each name may exist.
  assert (select count(*) from pg_proc where proname = 'book_custom') = 1,
    'book_custom must have exactly one signature or PostgREST refuses to call it';
  assert (select count(*) from pg_proc where proname = 'book_bundle') = 1,
    'book_bundle must have exactly one signature or PostgREST refuses to call it';
end $$;
