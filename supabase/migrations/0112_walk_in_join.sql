-- 0112_walk_in_join: the app's walk-in check-in (27b) gives a ticket, not a
-- request. Needs 0110 (walk_in_start).
--
-- 0040's join_queue wrote its booking "directly", believing that skipped
-- fill_booking. It does not — fill_booking is a BEFORE INSERT trigger (0003) — so
-- a customer's walk-in came out 'pending', a request the barber had to accept and
-- that Home never shows as a ticket. When the barber keeps cleaning time it was
-- refused outright as "Too close to another booking": 0040 started it at the end
-- of the last booking with no gap. (0040's mode 'walk_in' was never written
-- either — the column only allows 'shop' and 'home', and fill_booking sets 'shop'.)
--
-- Two changes; nothing else about the booking path moves:
--   · The start comes from walk_in_start (0110), the answer the queue page and the
--     guest join already use: breaks stepped over, cleaning time kept, the sitting
--     inside his hours. So fill_booking's own checks pass, and the app and the web
--     page cannot place the same walk-in differently.
--   · join_queue marks its own insert with a transaction-local setting, and a
--     trigger that runs after fill_booking turns exactly that row back into what
--     27b says: confirmed on the spot, no deposit. A client cannot set the mark —
--     set_config is not reachable over the API.
-- BEFORE triggers fire in name order: before_booking_insert (fill_booking),
-- before_booking_shop_floor, before_booking_suspended, then before_booking_walk_in.
-- The closed shop (0064), a suspended customer (0056) and a blocked client still
-- refuse. notify_booking_event (0037) stays silent, as it does for any booking
-- that arrives already confirmed.

create or replace function public.confirm_queue_join()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if current_setting('sterncut.queue_join', true) is distinct from
     new.customer_id::text || ':' || new.barber_id::text then
    return new;
  end if;
  -- one row per mark: nothing else inserted in the same transaction rides on it
  perform set_config('sterncut.queue_join', '', true);
  new.status := 'confirmed';
  new.deposit_cents := 0;
  return new;
end;
$$;
revoke execute on function public.confirm_queue_join() from public, anon, authenticated;

drop trigger if exists before_booking_walk_in on public.bookings;
create trigger before_booking_walk_in
  before insert on public.bookings
  for each row execute function public.confirm_queue_join();

create or replace function public.join_queue(p_barber uuid, p_service uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  svc record;
  starts timestamptz;
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to join the queue'; end if;
  select s.duration_min, s.barber_id into svc
    from public.services s where s.id = p_service and s.is_active;
  if not found then raise exception 'Service unavailable'; end if;
  if svc.barber_id <> p_barber then raise exception 'Service does not belong to this barber'; end if;
  if not exists (select 1 from public.barbers b
                 where b.id = p_barber and b.status = 'approved' and b.accepting_bookings) then
    raise exception 'This barber is not taking anyone right now';
  end if;
  if exists (select 1 from public.bookings b
             where b.customer_id = auth.uid() and b.status = 'confirmed'
               and b.completed_at is null
               and (b.starts_at at time zone shop_tz)::date = (now() at time zone shop_tz)::date) then
    raise exception 'You are already in a queue today';
  end if;

  for attempt in 1..3 loop
    starts := public.walk_in_start(p_barber, svc.duration_min);
    if starts is null then raise exception 'No room left with this barber today'; end if;
    begin
      perform set_config('sterncut.queue_join', auth.uid()::text || ':' || p_barber::text, true);
      insert into public.bookings (customer_id, barber_id, service_id, starts_at, deposit_cents)
      values (auth.uid(), p_barber, p_service, starts, 0)
      returning id into new_id;
      return new_id;
    exception
      -- somebody took that place a moment ago: the next one is behind them
      when exclusion_violation then null;
    end;
  end loop;
  raise exception 'The line moved while you were joining — try again';
end;
$$;
grant execute on function public.join_queue(uuid, uuid) to authenticated;

-- ---- checked at apply time ---------------------------------------------------
do $$
begin
  begin
    perform public.join_queue('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000');
    raise exception 'join_queue ran with nobody signed in';
  exception when raise_exception then
    assert sqlerrm = 'Sign in to join the queue', 'nobody signed in, nobody joins: ' || sqlerrm;
  end;
  assert coalesce(current_setting('sterncut.queue_join', true), '') = '', 'no mark is left behind';
end $$;
