-- 0021_undo_completion: let the barber undo a just-completed appointment (the toast
-- "UNDO" on the calendar). Clears completed_at, and optionally the started / checked-in
-- stamps that Mark-as-complete set — so undo restores the exact pre-complete state
-- instead of leaving the booking stuck "in chair". Guarded to a 2-minute window: this
-- is an undo, not a way to reopen jobs finished hours ago.

create function public.revert_completion(
  p_booking uuid,
  p_clear_start boolean default false,
  p_clear_checkin boolean default false
)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
begin
  select barber_id, completed_at into b from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() <> b.barber_id then raise exception 'Not your booking'; end if;
  if b.completed_at is null then raise exception 'Booking is not completed'; end if;
  if b.completed_at < now() - interval '2 minutes' then
    raise exception 'Too late to undo';
  end if;

  update public.bookings
    set completed_at = null,
        started_at = case when p_clear_start then null else started_at end,
        checked_in_at = case when p_clear_checkin then null else checked_in_at end
    where id = p_booking;
end;
$$;
