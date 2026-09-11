-- 0108_cancellations_break_silence: BNT-05 of "Barber - Notifications.dc.html".
--
-- "Silent while cutting" (0032) holds every push from check-in to mark-done,
-- and that is right. BNT-05 is the screen that hands the held ones over, and it
-- names the one kind where waiting costs money: a cancellation held for forty
-- minutes is forty minutes less notice for the waitlist. Instead of asking the
-- barber to turn the whole rule off, the screen offers that single exception.
-- It starts off, like the mock.
--
-- notif_should_push is 0037's body verbatim except the cutting branch, which now
-- lets a cancellation through when the switch is on. The toggle and quiet-hours
-- checks above it still apply: this widens the rule, it does not bypass the rest.

alter table public.notification_prefs
  add column if not exists cancel_breaks_silence boolean not null default false;

create or replace function public.notif_should_push(p_user uuid, p_kind public.notif_kind, p_urgent boolean)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  p record;
  local_now timestamp;
  now_min int;
  is_barber boolean;
  working boolean;
  cutting boolean;
begin
  select * into p from public.notification_prefs where user_id = p_user;
  if not found then
    -- no row yet = defaults; the quiet ones stay quiet, everything else pushes
    return p_kind not in ('review', 'offer');
  end if;

  if not (case p_kind
    when 'booking_request' then p.push_booking_request
    when 'reschedule'      then p.push_booking_request
    when 'cancellation'    then p.push_cancellation
    when 'checked_in'      then p.push_checked_in
    when 'wallet'          then p.push_wallet
    when 'message'         then p.push_message
    when 'review'          then p.push_review
    when 'queue_next'      then p.push_queue_next
    when 'booking_answer'  then p.push_booking_answer
    when 'review_ask'      then p.push_review_ask
    when 'reminder'        then p.reminder_min <> 0
    when 'offer'           then p.push_offers
    else false end) then
    return false;
  end if;

  if p_urgent and p.urgent_always then return true; end if;

  is_barber := exists (select 1 from public.barbers b where b.id = p_user);
  if not is_barber then return true; end if;

  local_now := now() at time zone shop_tz;
  now_min := extract(hour from local_now)::int * 60 + extract(minute from local_now)::int;

  if p.quiet_outside_hours then
    select exists (
      select 1 from public.availability a
      where a.barber_id = p_user
        and a.weekday = extract(dow from local_now)::int
        and a.start_min <= now_min and a.end_min > now_min
    ) and not exists (
      select 1 from public.days_off d
      where d.barber_id = p_user and d.day = local_now::date
    ) into working;
    if not working then return false; end if;
  end if;

  if p.silent_while_cutting then
    select exists (
      select 1 from public.bookings b
      where b.barber_id = p_user and b.started_at is not null and b.completed_at is null
    ) into cutting;
    -- 0108: the one exception BNT-05 offers
    if cutting and not (p_kind = 'cancellation' and p.cancel_breaks_silence) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- ponytail: the one check this leaves behind. The switch is only honest if it
-- starts off — BNT-05 offers it, it does not assume it.
do $$
begin
  assert (select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'notification_prefs'
             and column_name = 'cancel_breaks_silence') = 'false',
    'cancellations break the silence only once the barber turns it on';
end $$;
