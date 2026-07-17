-- 0018_service_stages: appointment lifecycle on the barber dashboard
-- (confirm → check in → start → complete). Timestamps, not statuses: status
-- stays 'confirmed' end-to-end so the slot engine, review eligibility and the
-- customer screens keep working untouched. "Started 11:15" comes free.

alter table public.bookings
  add column checked_in_at timestamptz,
  add column started_at timestamptz,
  add column completed_at timestamptz;

create function public.advance_booking(p_booking uuid, p_stage text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
begin
  if p_stage not in ('check_in', 'start', 'complete') then
    raise exception 'Unknown stage';
  end if;
  select barber_id, status, checked_in_at, started_at, completed_at into b
    from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() <> b.barber_id then raise exception 'Not your booking'; end if;
  if b.status <> 'confirmed' then raise exception 'Booking is not active'; end if;
  if b.completed_at is not null then raise exception 'Already completed'; end if;

  if p_stage = 'check_in' then
    if b.checked_in_at is not null then raise exception 'Already checked in'; end if;
    update public.bookings set checked_in_at = now() where id = p_booking;
  elsif p_stage = 'start' then
    if b.started_at is not null then raise exception 'Already started'; end if;
    -- starting without a check-in backfills it (walk-in sat straight down)
    update public.bookings
      set checked_in_at = coalesce(checked_in_at, now()), started_at = now()
      where id = p_booking;
  else
    if b.started_at is null then raise exception 'Not started yet'; end if;
    update public.bookings set completed_at = now() where id = p_booking;
  end if;
end;
$$;

grant execute on function public.advance_booking to authenticated;
