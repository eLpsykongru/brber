-- 0006_cancel: either participant can cancel an upcoming booking.
-- Done as an RPC instead of an UPDATE policy so the only possible status
-- transition from the app is (pending|confirmed) -> cancelled, on future bookings.

create function public.cancel_booking(p_booking uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
begin
  select customer_id, barber_id, status, starts_at into b
    from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() <> b.customer_id and auth.uid() <> b.barber_id then
    raise exception 'Not your booking';
  end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'Booking is not active'; end if;
  if b.starts_at <= now() then raise exception 'Booking has already started'; end if;

  update public.bookings set status = 'cancelled' where id = p_booking;
end;
$$;

grant execute on function public.cancel_booking to authenticated;
