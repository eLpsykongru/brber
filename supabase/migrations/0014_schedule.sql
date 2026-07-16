-- 0014_schedule: barber-managed slots on his own calendar.
-- A walk-in is a normal bookings row where the barber is both barber and customer
-- (passes the existing insert policy + fill_booking trigger untouched), with the
-- client's name in walk_in_name. Conflict-safety and customer-side slot hiding
-- come free from the no_double_booking constraint and booked_ranges.

alter table public.bookings add column walk_in_name text;

-- barber marks a started booking as a no-show (frees nothing — the slot is past —
-- but keeps the history honest and feeds the reputation system later)
create function public.mark_no_show(p_booking uuid)
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
  if b.status <> 'confirmed' then raise exception 'Booking is not active'; end if;
  if b.starts_at > now() then raise exception 'Booking has not started yet'; end if;

  update public.bookings set status = 'no_show' where id = p_booking;
end;
$$;

grant execute on function public.mark_no_show to authenticated;
