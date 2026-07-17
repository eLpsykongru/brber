-- 0019_early_complete: a service completed before its slot time is really done.
-- The barber served the client early (20:08 for a 21:00 slot) → the customer can
-- review immediately, and nobody can cancel / no-show / reschedule a booking
-- that already happened.

-- reviews unlock at completed_at, not only when the slot's end time passes
create or replace function public.fill_review()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
begin
  select customer_id, barber_id, status, ends_at, completed_at into b
    from public.bookings where id = new.booking_id;
  if not found or b.customer_id <> auth.uid() then raise exception 'Not your booking'; end if;
  if b.status <> 'confirmed' or (b.completed_at is null and b.ends_at > now()) then
    raise exception 'You can review after the appointment has happened';
  end if;
  new.customer_id := b.customer_id;
  new.barber_id := b.barber_id;
  return new;
end;
$$;

-- a completed booking can no longer be cancelled…
create or replace function public.cancel_booking(p_booking uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
begin
  select customer_id, barber_id, status, starts_at, completed_at into b
    from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() <> b.customer_id and auth.uid() <> b.barber_id then
    raise exception 'Not your booking';
  end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'Booking is not active'; end if;
  if b.completed_at is not null then raise exception 'Service already completed'; end if;
  if b.starts_at <= now() then raise exception 'Booking has already started'; end if;

  update public.bookings set status = 'cancelled' where id = p_booking;
end;
$$;

-- …nor marked no-show…
create or replace function public.mark_no_show(p_booking uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
begin
  select barber_id, status, starts_at, completed_at into b
    from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() <> b.barber_id then raise exception 'Not your booking'; end if;
  if b.status <> 'confirmed' then raise exception 'Booking is not active'; end if;
  if b.completed_at is not null then raise exception 'Service already completed'; end if;
  if b.starts_at > now() then raise exception 'Booking has not started yet'; end if;

  update public.bookings set status = 'no_show' where id = p_booking;
end;
$$;

-- …nor rescheduled.
create or replace function public.reschedule_booking(p_booking uuid, p_new_start timestamptz)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
begin
  select barber_id, customer_id, status, starts_at, ends_at, completed_at into b
    from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() <> b.barber_id then raise exception 'Not your booking'; end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'Booking is not active'; end if;
  if b.completed_at is not null then raise exception 'Service already completed'; end if;
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
