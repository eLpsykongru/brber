-- 0015_pending_requests: customer bookings need barber approval.
-- Reverses 0005's instant-confirm: app bookings start 'pending' and the barber
-- accepts/declines/reschedules. Walk-ins the barber adds himself (customer_id =
-- barber_id) stay instant-confirmed. Pending rows already hold the slot via the
-- no_double_booking constraint; a pending request whose start time passes is
-- simply dead (the app renders it as expired — no cron).

create or replace function public.fill_booking()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca'; -- ponytail: single-city; per-barber tz when multi-city
  svc record;
  local_start timestamp;
  slot_start_min int;
begin
  select s.price_cents, s.duration_min, s.barber_id
    into svc
    from public.services s
    where s.id = new.service_id and s.is_active;
  if not found then raise exception 'Service unavailable'; end if;
  if svc.barber_id <> new.barber_id then raise exception 'Service does not belong to this barber'; end if;
  if not exists (select 1 from public.barbers b where b.id = new.barber_id and b.status = 'approved') then
    raise exception 'Barber not available';
  end if;
  if new.starts_at <= now() then raise exception 'Booking must be in the future'; end if;

  -- server-side snapshots: ignore whatever the client sent for these
  new.price_cents := svc.price_cents;
  new.deposit_cents := 0;        -- ponytail: no deposit rail yet; revisit when a Moroccan PSP lands
  -- barber's own walk-in → instant; customer request → barber must accept
  new.status := case when new.customer_id = new.barber_id then 'confirmed' else 'pending' end;
  new.ends_at := new.starts_at + make_interval(mins => svc.duration_min);
  new.mode := 'shop';

  -- inside working hours, not on a day off (shop-local time)
  local_start := new.starts_at at time zone shop_tz;
  slot_start_min := extract(hour from local_start)::int * 60 + extract(minute from local_start)::int;
  if exists (select 1 from public.days_off d
             where d.barber_id = new.barber_id and d.day = local_start::date) then
    raise exception 'Barber is off that day';
  end if;
  if not exists (select 1 from public.availability a
                 where a.barber_id = new.barber_id
                   and a.weekday = extract(dow from local_start)::int
                   and a.start_min <= slot_start_min
                   and a.end_min >= slot_start_min + svc.duration_min) then
    raise exception 'Outside working hours';
  end if;

  return new;
end;
$$;

-- barber accepts a pending request
create function public.accept_booking(p_booking uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
begin
  select barber_id, status, starts_at into b
    from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() <> b.barber_id then raise exception 'Not your booking'; end if;
  if b.status <> 'pending' then raise exception 'Booking is not pending'; end if;
  if b.starts_at <= now() then raise exception 'Request has expired'; end if;

  update public.bookings set status = 'confirmed' where id = p_booking;
end;
$$;
grant execute on function public.accept_booking to authenticated;

-- barber moves a booking to a new time; it confirms, and the customer is told in chat.
-- ponytail: no availability-window check — it's the barber's own call to stay late;
-- the no_double_booking constraint still rejects overlaps on UPDATE.
create function public.reschedule_booking(p_booking uuid, p_new_start timestamptz)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
begin
  select barber_id, customer_id, status, starts_at, ends_at into b
    from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() <> b.barber_id then raise exception 'Not your booking'; end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'Booking is not active'; end if;
  if p_new_start <= now() then raise exception 'New time must be in the future'; end if;

  update public.bookings
    set starts_at = p_new_start,
        ends_at = p_new_start + (b.ends_at - b.starts_at),
        status = 'confirmed'
    where id = p_booking;

  -- only notification surface we have until push lands
  if b.customer_id <> b.barber_id then
    insert into public.messages (booking_id, sender_id, body)
    values (p_booking, b.barber_id,
      'Your booking was moved to '
      || to_char(p_new_start at time zone 'Africa/Casablanca', 'Dy DD Mon, HH24:MI'));
  end if;
end;
$$;
grant execute on function public.reschedule_booking to authenticated;

-- decline = the existing cancel_booking(); no new function needed.
