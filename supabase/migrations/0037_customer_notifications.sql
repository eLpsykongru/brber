-- 0037_customer_notifications: turns 13b, 14 and 15 of the customer design.
--
-- 0032 built the inbox for barbers only — every table was keyed to public.barbers.
-- 13b (the customer lock screen) was deliberately left unbuilt then, because
-- faking half a rail is worse than none. This is that rail, made per-USER:
-- the same tables, the same predicate, the same delivery, one recipient column.
--
-- The rename is safe with no data migration: barbers.id references profiles.id,
-- so every id already in these tables is a valid profile id.
--
-- BACKLOG TRIGGER PULLED — "Reminders": the deferred "Remind me" toggle said it
-- "belongs with push notifications". 15a is that toggle, and send_due_reminders()
-- at the bottom is the job behind it.

-- ---- one recipient column --------------------------------------------------
-- Guarded so the file is safe to re-run: a rename is not idempotent, and this
-- migration is long enough that a failure halfway through is worth surviving.
do $$
declare
  t text;
begin
  foreach t in array array['notifications', 'notification_prefs', 'push_tokens'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'barber_id'
    ) then
      execute format('alter table public.%I rename column barber_id to user_id', t);
    end if;
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_barber_id_fkey');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_user_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id)'
      || ' references public.profiles (id) on delete cascade', t, t || '_user_id_fkey');
  end loop;
end $$;

-- ---- 14b · the customer's switches ----------------------------------------
-- One prefs table, not two: a row is per user, and each side only ever reads
-- its own half. The barber columns (silent_while_cutting, quiet_outside_hours)
-- are ignored for customers — see the is_barber guard in notif_should_push.
alter table public.notification_prefs
  add column if not exists push_queue_next boolean not null default true,     -- "You're next in line"
  add column if not exists push_queue_moves boolean not null default false,   -- every time the line moves
  add column if not exists push_booking_answer boolean not null default true, -- confirmed / declined / moved
  add column if not exists push_review_ask boolean not null default true,     -- "How was the cut?"
  add column if not exists push_offers boolean not null default false,        -- deals near you
  -- 15a. minutes before the slot; 0 = off, -1 = the evening before at 20:00
  add column if not exists reminder_min int not null default 60;

-- ---- the predicate, per user ----------------------------------------------
-- Same shape as 0032's. Two changes: the customer kinds, and the two barber-only
-- rules now check that the user IS a barber. Without that guard a customer would
-- fail the quiet-hours test (they have no `availability` rows) and never be
-- pushed anything at all.
--
-- Dropped first, not replaced: 0032 named the first parameter p_barber, and
-- PostgreSQL refuses to rename an input parameter through CREATE OR REPLACE.
-- Nothing depends on it by signature — push_dispatch resolves the call at
-- runtime — so the drop is safe.
drop function if exists public.notif_should_push(uuid, public.notif_kind, boolean);
create function public.notif_should_push(p_user uuid, p_kind public.notif_kind, p_urgent boolean)
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
    if cutting then return false; end if;
  end if;

  return true;
end;
$$;

-- ---- 13b · delivery, per user ---------------------------------------------
create or replace function public.push_dispatch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  urgent boolean := false;
  starts timestamptz;
begin
  if new.kind in ('cancellation', 'queue_next') and new.booking_id is not null then
    select b.starts_at into starts from public.bookings b where b.id = new.booking_id;
    urgent := new.kind = 'queue_next'
      or (starts is not null and starts < now() + interval '2 hours');
  end if;

  if not public.notif_should_push(new.user_id, new.kind, urgent) then
    return new;
  end if;

  begin
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := (
        select coalesce(jsonb_agg(jsonb_build_object(
          'to', t.token,
          'title', new.title,
          'body', coalesce(new.body, ''),
          'sound', 'default',
          'categoryId', case when new.kind = 'booking_request' then 'BOOKING_REQUEST' else null end,
          'data', jsonb_build_object('notificationId', new.id, 'kind', new.kind, 'bookingId', new.booking_id)
        )), '[]'::jsonb)
        from public.push_tokens t where t.user_id = new.user_id
      )
    );
  exception when others then
    null; -- ponytail: best-effort. The inbox row is the durable record.
  end;
  return new;
end;
$$;

create or replace function public.notif_mark_all_read()
returns void
language sql security definer set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null;
$$;

-- ---- events, now in both directions ---------------------------------------
create or replace function public.notify_booking_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  who text;
  barber_name text;
  svc text;
  whenlbl text;
  next_id uuid;
  next_customer uuid;
begin
  select coalesce(b.walk_in_name, p.full_name, 'A client') into who
    from public.bookings b left join public.profiles p on p.id = b.customer_id
    where b.id = new.id;
  select coalesce(p.full_name, 'Your barber') into barber_name
    from public.profiles p where p.id = new.barber_id;
  select s.name into svc from public.services s where s.id = new.service_id;
  whenlbl := to_char(new.starts_at at time zone 'Africa/Casablanca', 'Dy DD Mon HH24:MI');

  -- a customer's request landing in the barber's lap
  if tg_op = 'INSERT' and new.status = 'pending' and new.customer_id <> new.barber_id then
    insert into public.notifications (user_id, kind, title, body, booking_id, amount_cents)
    values (new.barber_id, 'booking_request', 'New booking request',
      who || ' · ' || coalesce(svc, 'Service') || ' · ' || whenlbl, new.id, new.price_cents);
    return new;
  end if;

  if tg_op = 'UPDATE' and new.customer_id <> new.barber_id then
    -- the barber answered: pending → confirmed
    if new.status = 'confirmed' and old.status = 'pending' then
      insert into public.notifications (user_id, kind, title, body, booking_id)
      values (new.customer_id, 'booking_answer',
        barber_name || ' confirmed your booking',
        coalesce(svc, 'Service') || ' · ' || whenlbl, new.id);

    elsif new.status = 'cancelled' and old.status <> 'cancelled' then
      -- whoever did not press the button hears about it
      if new.cancelled_by = new.barber_id then
        insert into public.notifications (user_id, kind, title, body, booking_id)
        values (new.customer_id, 'cancellation',
          barber_name || ' cancelled your booking',
          whenlbl || coalesce(' · ' || new.cancel_reason, ''), new.id);
      else
        insert into public.notifications (user_id, kind, title, body, booking_id)
        values (new.barber_id, 'cancellation', 'Booking cancelled',
          who || ' · ' || whenlbl || ' · slot reopened', new.id);
      end if;

    elsif new.checked_in_at is not null and old.checked_in_at is null then
      insert into public.notifications (user_id, kind, title, body, booking_id)
      values (new.barber_id, 'checked_in', who || ' checked in',
        'Waiting for ' || to_char(new.starts_at at time zone 'Africa/Casablanca', 'HH24:MI')
        || ' ' || coalesce(svc, 'Service'), new.id);

    -- 14a's "How was the cut?" — the visit is done, the review is owed
    elsif new.completed_at is not null and old.completed_at is null then
      insert into public.notifications (user_id, kind, title, body, booking_id)
      values (new.customer_id, 'review_ask', 'How was the cut?',
        'Rate ' || split_part(barber_name, ' ', 1) || ' — it takes 10 seconds', new.id);
    end if;

    -- someone went into the chair → whoever is next hears about it
    if new.started_at is not null and old.started_at is null then
      select b.id, b.customer_id into next_id, next_customer
      from public.bookings b
      where b.barber_id = new.barber_id
        and b.status = 'confirmed'
        and b.started_at is null and b.completed_at is null
        and b.starts_at > new.starts_at
        and (b.starts_at at time zone 'Africa/Casablanca')::date
            = (now() at time zone 'Africa/Casablanca')::date
        and b.customer_id <> b.barber_id
      order by b.starts_at
      limit 1;
      if next_id is not null then
        insert into public.notifications (user_id, kind, title, body, booking_id)
        values (next_customer, 'queue_next', 'You''re next in the chair',
          'Head to ' || coalesce((select s.name from public.salons s
             join public.barbers bb on bb.salon_id = s.id where bb.id = new.barber_id),
             'the shop') || ' now', next_id);
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- wallet: the agent already got a row; the customer gets one for money that
-- lands back in their balance (0035's refunds) or that they just handed over.
create or replace function public.notify_wallet_topup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  who text;
  shop text;
begin
  select coalesce(p.full_name, 'a customer') into who
    from public.profiles p where p.id = new.user_id;
  select s.name into shop from public.salons s where s.id = new.salon_id;

  if new.kind = 'cash_topup' then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (new.created_by, 'wallet',
      'Wallet top-up · ' || (new.amount_cents / 100) || ' DH',
      'You credited ' || who, new.amount_cents);
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (new.user_id, 'wallet',
      (new.amount_cents / 100) || ' DH added to your wallet',
      coalesce(shop, 'Your barber') || ' took the cash', new.amount_cents);

  elsif new.kind = 'deposit_refund' then
    insert into public.notifications (user_id, kind, title, body, booking_id, amount_cents)
    values (new.user_id, 'wallet',
      (new.amount_cents / 100) || ' DH back in your wallet',
      coalesce(shop, 'The salon') || ' cancelled — deposit refunded',
      new.booking_id, new.amount_cents);
  end if;
  -- a 'deposit' debit needs no push: the customer just pressed the button
  return new;
end;
$$;

create or replace function public.notify_message()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  b record;
  who text;
  preview text;
begin
  select barber_id, customer_id into b from public.bookings where id = new.booking_id;
  if b.barber_id is null or b.customer_id = b.barber_id then return new; end if;
  select coalesce(p.full_name, 'Someone') into who from public.profiles p where p.id = new.sender_id;
  preview := left(coalesce(nullif(btrim(new.body), ''), 'Sent a photo'), 90);

  if new.sender_id = b.barber_id then
    insert into public.notifications (user_id, kind, title, body, booking_id)
    values (b.customer_id, 'message', who || ' sent you a message', preview, new.booking_id);
  else
    insert into public.notifications (user_id, kind, title, body, booking_id)
    values (b.barber_id, 'message', 'Message from ' || who, preview, new.booking_id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_review()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  who text;
begin
  select coalesce(p.full_name, 'A client') into who from public.profiles p where p.id = new.customer_id;
  insert into public.notifications (user_id, kind, title, body, booking_id)
  values (new.barber_id, 'review',
    who || ' left you ' || new.rating || ' star' || case when new.rating = 1 then '' else 's' end,
    nullif(btrim(coalesce(new.comment, '')), ''), new.booking_id);
  return new;
end;
$$;

-- 0034 wrote this one against the old column name; the rename above would break
-- it at runtime the first time a customer asked to move a booking. Body is
-- unchanged apart from barber_id → user_id in the notifications insert.
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
  insert into public.notifications (user_id, kind, title, body, booking_id)
  values (b.barber_id, 'reschedule', 'Reschedule request',
    who || ' · ' || coalesce(svc, 'Service') || ' → '
      || to_char(p_new_start at time zone 'Africa/Casablanca', 'Dy DD Mon HH24:MI'),
    p_booking);
  return req;
end;
$$;

-- 12a/13a — the customer hears the answer to their reschedule ask
create or replace function public.respond_reschedule(
  p_request uuid, p_accept boolean, p_note text default null,
  p_alts timestamptz[] default '{}')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  b record;
  barber_name text;
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

  select coalesce(p.full_name, 'Your barber') into barber_name
    from public.profiles p where p.id = r.barber_id;

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
    insert into public.notifications (user_id, kind, title, body, booking_id)
    values (r.customer_id, 'booking_answer', barber_name || ' moved your booking',
      'Now ' || to_char(r.requested_start at time zone 'Africa/Casablanca', 'Dy DD Mon, HH24:MI'),
      r.booking_id);
  else
    update public.reschedule_requests
      set status = 'declined', decided_at = now(), note = p_note,
          alt_starts = coalesce(p_alts, '{}')
      where id = p_request;
    insert into public.messages (booking_id, sender_id, body)
    values (r.booking_id, r.barber_id,
      coalesce(p_note, 'Sorry, I can''t do that time — your original slot still stands.'));
    insert into public.notifications (user_id, kind, title, body, booking_id)
    values (r.customer_id, 'booking_answer', barber_name || ' declined the new time',
      'Your original slot still stands', r.booking_id);
  end if;
end;
$$;

-- ---- 15a · the reminder job ------------------------------------------------
-- Idempotent by design: one reminder row per booking, ever. Safe to call as
-- often as you like, so the schedule below is a convenience, not a contract.
create or replace function public.send_due_reminders()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int := 0;
  r record;
begin
  for r in
    select b.id, b.customer_id, b.starts_at, s.name as svc, sa.name as shop,
           coalesce(np.reminder_min, 60) as lead
    from public.bookings b
    join public.profiles cp on cp.id = b.customer_id
    left join public.notification_prefs np on np.user_id = b.customer_id
    left join public.services s on s.id = b.service_id
    left join public.barbers bb on bb.id = b.barber_id
    left join public.salons sa on sa.id = bb.salon_id
    where b.status = 'confirmed'
      and b.started_at is null and b.completed_at is null
      and b.customer_id <> b.barber_id
      and b.starts_at > now()
      and coalesce(np.reminder_min, 60) <> 0
      and not exists (
        select 1 from public.notifications x
        where x.booking_id = b.id and x.kind = 'reminder')
      and b.starts_at <= now() + make_interval(
        mins => case when coalesce(np.reminder_min, 60) = -1 then 960
                     else coalesce(np.reminder_min, 60) end)
  loop
    insert into public.notifications (user_id, kind, title, body, booking_id)
    values (r.customer_id, 'reminder',
      coalesce(r.svc, 'Your appointment') || ' at '
        || to_char(r.starts_at at time zone 'Africa/Casablanca', 'HH24:MI'),
      coalesce(r.shop, 'Your barber') || ' · '
        || case when r.lead = -1 then 'tomorrow'
                when r.lead >= 60 then (r.lead / 60) || ' h from now'
                else r.lead || ' min from now' end,
      r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Runs every 5 minutes when pg_cron is available; a no-op otherwise so this
-- migration never fails on a project without the extension. If reminders are
-- not arriving, this is the first thing to check.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sterncut-reminders', '*/5 * * * *',
      'select public.send_due_reminders()');
  else
    raise notice 'pg_cron not installed — reminders will not fire until it is enabled '
      'and public.send_due_reminders() is scheduled.';
  end if;
end $$;
