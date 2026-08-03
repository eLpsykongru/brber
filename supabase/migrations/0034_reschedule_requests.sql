-- 0034_reschedule_requests: turns 11-13 of "Customer App.dc.html".
-- The customer asks for a new time (11a); the barber answers; the outcomes are
-- 12a "request sent", 13a "moved", 12b "declined, here are alternatives".
--
-- 0020's reschedule_booking() is the other direction: barber-only, and it moves
-- the row on the spot. This is an ASK that holds the original slot until answered
-- — the booking is not touched until the barber accepts.
--
-- BACKLOG: 0020 recorded "until push exists, the honest floor is the chat message".
-- 0032 laid the push rail, so the barber's ask arrives as a notification row.
-- The barber's ANSWER still writes a chat message, because the customer half of
-- that rail (customer push tokens + inbox) does not exist yet — see the note on
-- 13b in the turn-13 build.

-- ---- 0032's predicate, taught the new kind ---------------------------------
-- Unchanged except for the 'reschedule' arm: a move is a request, so it rides
-- the same "New booking requests" toggle rather than adding a switch the mock
-- never drew. Without this arm the CASE falls through to `else false` and a
-- reschedule ask would sit silently in the inbox.
create or replace function public.notif_should_push(p_barber uuid, p_kind public.notif_kind, p_urgent boolean)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  p record;
  local_now timestamp;
  now_min int;
  working boolean;
  cutting boolean;
begin
  select * into p from public.notification_prefs where barber_id = p_barber;
  if not found then
    return p_kind <> 'review';
  end if;

  if not (case p_kind
    when 'booking_request' then p.push_booking_request
    when 'reschedule'      then p.push_booking_request
    when 'cancellation'    then p.push_cancellation
    when 'checked_in'      then p.push_checked_in
    when 'wallet'          then p.push_wallet
    when 'message'         then p.push_message
    when 'review'          then p.push_review
    else false end) then
    return false;
  end if;

  if p_urgent and p.urgent_always then return true; end if;

  local_now := now() at time zone shop_tz;
  now_min := extract(hour from local_now)::int * 60 + extract(minute from local_now)::int;

  if p.quiet_outside_hours then
    select exists (
      select 1 from public.availability a
      where a.barber_id = p_barber
        and a.weekday = extract(dow from local_now)::int
        and a.start_min <= now_min and a.end_min > now_min
    ) and not exists (
      select 1 from public.days_off d
      where d.barber_id = p_barber and d.day = local_now::date
    ) into working;
    if not working then return false; end if;
  end if;

  if p.silent_while_cutting then
    select exists (
      select 1 from public.bookings b
      where b.barber_id = p_barber and b.started_at is not null and b.completed_at is null
    ) into cutting;
    if cutting then return false; end if;
  end if;

  return true;
end;
$$;

-- ---- the ask ---------------------------------------------------------------
create table public.reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  barber_id uuid not null references public.barbers (id) on delete cascade,
  from_start timestamptz not null,                 -- 12a's struck-through CURRENT column
  requested_start timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  note text,                                       -- the barber's line quoted in 12b
  alt_starts timestamptz[] not null default '{}',  -- "Youssef suggests" — optional
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- one open ask per booking: a partial unique index instead of an app-side check
create unique index reschedule_one_open_idx
  on public.reschedule_requests (booking_id) where status = 'pending';
create index reschedule_barber_idx on public.reschedule_requests (barber_id, created_at desc);

alter table public.reschedule_requests enable row level security;
create policy reschedule_select on public.reschedule_requests for select to authenticated
  using (customer_id = auth.uid() or barber_id = auth.uid());
grant select on public.reschedule_requests to authenticated;
-- no insert/update grant: every write goes through the three RPCs below

-- ---- 11a → 12a · the customer asks ---------------------------------------
create or replace function public.request_reschedule(p_booking uuid, p_new_start timestamptz)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  b record;
  svc text;
  who text;
  req uuid;
begin
  select customer_id, barber_id, status, starts_at, completed_at, service_id
    into b from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() <> b.customer_id then raise exception 'Not your booking'; end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'Booking is not active'; end if;
  if b.completed_at is not null then raise exception 'Service already completed'; end if;
  if b.starts_at <= now() then raise exception 'Booking has already started'; end if;
  if p_new_start <= now() then raise exception 'New time must be in the future'; end if;
  if p_new_start = b.starts_at then raise exception 'That is already your time'; end if;
  if exists (select 1 from public.reschedule_requests r
             where r.booking_id = p_booking and r.status = 'pending') then
    raise exception 'You already asked to move this booking';
  end if;

  insert into public.reschedule_requests
    (booking_id, customer_id, barber_id, from_start, requested_start)
  values (p_booking, b.customer_id, b.barber_id, b.starts_at, p_new_start)
  returning id into req;

  select s.name into svc from public.services s where s.id = b.service_id;
  select coalesce(p.full_name, 'A client') into who
    from public.profiles p where p.id = b.customer_id;
  insert into public.notifications (barber_id, kind, title, body, booking_id)
  values (b.barber_id, 'reschedule', 'Reschedule request',
    who || ' · ' || coalesce(svc, 'Service') || ' → '
      || to_char(p_new_start at time zone 'Africa/Casablanca', 'Dy DD Mon HH24:MI'),
    p_booking);
  return req;
end;
$$;
grant execute on function public.request_reschedule(uuid, timestamptz) to authenticated;

-- ---- 13a / 12b · the barber answers --------------------------------------
-- p_alts is what 12b lists under "Youssef suggests". Left empty (the case until
-- the barber gets a picker) the customer's screen falls back to the next free
-- slots it can compute itself, labelled as such rather than as his suggestion.
create or replace function public.respond_reschedule(
  p_request uuid, p_accept boolean, p_note text default null,
  p_alts timestamptz[] default '{}')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  b record;
begin
  select * into r from public.reschedule_requests where id = p_request;
  if not found then raise exception 'Request not found'; end if;
  if auth.uid() <> r.barber_id then raise exception 'Not your request'; end if;
  if r.status <> 'pending' then raise exception 'Already answered'; end if;

  select starts_at, ends_at, status, completed_at into b
    from public.bookings where id = r.booking_id;
  if b.status not in ('pending', 'confirmed') or b.completed_at is not null then
    raise exception 'Booking is no longer active';
  end if;

  if p_accept then
    if r.requested_start <= now() then raise exception 'That time has passed'; end if;
    update public.bookings
      set starts_at = r.requested_start,
          ends_at = r.requested_start + (b.ends_at - b.starts_at),
          status = 'confirmed'
      where id = r.booking_id;
    update public.reschedule_requests
      set status = 'accepted', decided_at = now(), note = p_note
      where id = p_request;
    insert into public.messages (booking_id, sender_id, body)
    values (r.booking_id, r.barber_id,
      'Moved you to '
        || to_char(r.requested_start at time zone 'Africa/Casablanca', 'Dy DD Mon, HH24:MI')
        || coalesce(' — ' || p_note, ''));
  else
    update public.reschedule_requests
      set status = 'declined', decided_at = now(), note = p_note,
          alt_starts = coalesce(p_alts, '{}')
      where id = p_request;
    insert into public.messages (booking_id, sender_id, body)
    values (r.booking_id, r.barber_id,
      coalesce(p_note, 'Sorry, I can''t do that time — your original slot still stands.'));
  end if;
end;
$$;
grant execute on function public.respond_reschedule(uuid, boolean, text, timestamptz[]) to authenticated;

-- ---- 12b · the customer takes one of the offered times --------------------
create or replace function public.accept_reschedule_offer(p_request uuid, p_start timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  b record;
begin
  select * into r from public.reschedule_requests where id = p_request;
  if not found then raise exception 'Request not found'; end if;
  if auth.uid() <> r.customer_id then raise exception 'Not your booking'; end if;
  if r.status <> 'declined' then raise exception 'Nothing to accept'; end if;
  if not (p_start = any (r.alt_starts)) then raise exception 'That time was not offered'; end if;
  if p_start <= now() then raise exception 'That time has passed'; end if;

  select starts_at, ends_at, status, completed_at into b
    from public.bookings where id = r.booking_id;
  if b.status not in ('pending', 'confirmed') or b.completed_at is not null then
    raise exception 'Booking is no longer active';
  end if;

  update public.bookings
    set starts_at = p_start,
        ends_at = p_start + (b.ends_at - b.starts_at),
        status = 'confirmed'
    where id = r.booking_id;
  update public.reschedule_requests
    set status = 'accepted', requested_start = p_start, decided_at = now()
    where id = r.id;
end;
$$;
grant execute on function public.accept_reschedule_offer(uuid, timestamptz) to authenticated;
