-- 0040_walk_in_checkin: turn 27 — a customer scans the counter code and joins
-- today's queue without booking ahead.
--
-- The barber side already prints the code (0031's poster, src/lib/qr.ts); it
-- encodes https://sterncut.ma/q/<salon>[?b=<barber>]. Nothing scans the
-- customer — their phone reads the shop's code, which is why this is an RPC the
-- customer calls and not a barber action.

-- what the sheet in 27b needs before you commit: who is free, and how soon
create or replace function public.salon_queue_estimate(p_salon uuid)
returns table (barber_id uuid, name text, ahead int, wait_min int)
language sql stable security definer set search_path = ''
as $$
  select b.id,
         coalesce(p.full_name, 'Barber'),
         count(bk.id)::int,
         -- ponytail: sum of remaining service durations, no per-barber pace yet.
         -- Add a rolling average once there are enough completed rows to mean anything.
         coalesce(sum(extract(epoch from (bk.ends_at - bk.starts_at)) / 60), 0)::int
  from public.barbers b
  join public.profiles p on p.id = b.id
  left join public.bookings bk
    on bk.barber_id = b.id
   and bk.status = 'confirmed'
   and bk.completed_at is null
   and (bk.starts_at at time zone 'Africa/Casablanca')::date
       = (now() at time zone 'Africa/Casablanca')::date
  where b.salon_id = p_salon and b.status = 'approved' and b.salon_status = 'approved'
    and b.accepting_bookings
  group by b.id, p.full_name
  order by 4;
$$;
grant execute on function public.salon_queue_estimate(uuid) to authenticated;

-- 27b → 27c. Confirmed on the spot: the customer is standing in the shop, so
-- there is nobody to "accept" the request. No deposit — 27b says so out loud.
create or replace function public.join_queue(p_barber uuid, p_service uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  svc record;
  tail timestamptz;
  starts timestamptz;
  new_id uuid;
begin
  select s.price_cents, s.duration_min, s.barber_id into svc
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

  -- the back of today's line, or now if the line is empty
  select max(b.ends_at) into tail
  from public.bookings b
  where b.barber_id = p_barber and b.status = 'confirmed' and b.completed_at is null
    and (b.starts_at at time zone shop_tz)::date = (now() at time zone shop_tz)::date;
  starts := greatest(coalesce(tail, now()), now() + interval '1 minute');

  -- fill_booking would re-derive price and force 'pending'; a walk-in is neither
  -- a request nor an ahead-of-time slot, so it is written directly
  insert into public.bookings
    (customer_id, barber_id, service_id, starts_at, ends_at, status,
     price_cents, deposit_cents, mode)
  values (auth.uid(), p_barber, p_service, starts,
          starts + make_interval(mins => svc.duration_min), 'confirmed',
          svc.price_cents, 0, 'walk_in')
  returning id into new_id;
  return new_id;
end;
$$;
grant execute on function public.join_queue(uuid, uuid) to authenticated;

-- 27c's "Leave the queue" — a walk-in can drop out until the chair starts
create or replace function public.leave_queue(p_booking uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  b record;
begin
  select customer_id, started_at, completed_at, status into b
    from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if b.customer_id <> auth.uid() then raise exception 'Not your ticket'; end if;
  if b.started_at is not null or b.completed_at is not null then
    raise exception 'Your cut has already started';
  end if;
  update public.bookings
    set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = 'Left the queue'
    where id = p_booking;
end;
$$;
grant execute on function public.leave_queue(uuid) to authenticated;
