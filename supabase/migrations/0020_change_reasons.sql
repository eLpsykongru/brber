  -- 0020_change_reasons: cancel/reschedule can carry a short reason, and the client
  -- is told why in the chat message (the only notification surface until push lands).
  -- Reason is optional (default null) so every existing caller keeps working; the
  -- arg is added, so the old single-signature functions are dropped first to avoid
  -- an ambiguous overload for no-reason calls.

  drop function if exists public.cancel_booking(uuid);
  create function public.cancel_booking(p_booking uuid, p_reason text default null)
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

    -- notify the client only when the BARBER cancels a real client's booking
    -- (a customer cancelling their own doesn't message themselves; walk-ins have no account)
    if p_reason is not null and auth.uid() = b.barber_id and b.customer_id <> b.barber_id then
      insert into public.messages (booking_id, sender_id, body)
      values (p_booking, b.barber_id, 'Your booking was cancelled — ' || p_reason);
    end if;
  end;
  $$;

  drop function if exists public.reschedule_booking(uuid, timestamptz);
  create function public.reschedule_booking(p_booking uuid, p_new_start timestamptz, p_reason text default null)
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
        || to_char(p_new_start at time zone 'Africa/Casablanca', 'Dy DD Mon, HH24:MI')
        || case when p_reason is not null then ' — ' || p_reason else '' end);
    end if;
  end;
  $$;
