-- 0032_notifications: turn 4 of "Barber App.dc.html".
-- BACKLOG TRIGGER PULLED: several deferred items name "the push-notifications
-- increment" as their trigger (client reminders, booking proposals). This lays
-- the rail: an inbox row per event, per-barber preferences, and device tokens.
--
-- Delivery: rows are written by SQL triggers (safe, transactional). The HTTP hop
-- to Expo's push service is attempted separately and can never roll back the
-- booking that caused it — see push_dispatch() below.

create type public.notif_kind as enum (
  'booking_request', 'cancellation', 'checked_in', 'wallet', 'message', 'review', 'digest'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  kind public.notif_kind not null,
  title text not null,
  body text,
  booking_id uuid references public.bookings (id) on delete cascade,
  amount_cents int,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_inbox_idx on public.notifications (barber_id, created_at desc);

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (barber_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (barber_id = auth.uid()) with check (barber_id = auth.uid());
grant select, update (read_at) on public.notifications to authenticated;
-- no insert grant: rows only ever come from the event triggers below

-- ---- 4c · preferences -----------------------------------------------------
-- Defaults mirror the mock: everything pushes except reviews, which wait for
-- the inbox. `silent_while_cutting` is the rule the whole screen is built around.
create table public.notification_prefs (
  barber_id uuid primary key references public.barbers (id) on delete cascade,
  push_booking_request boolean not null default true,
  push_cancellation boolean not null default true,
  push_checked_in boolean not null default true,
  push_wallet boolean not null default true,
  push_message boolean not null default true,
  push_review boolean not null default false,
  silent_while_cutting boolean not null default true,
  quiet_outside_hours boolean not null default true,
  urgent_always boolean not null default true,   -- a cancellation inside 2h still buzzes
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;
create policy notification_prefs_all on public.notification_prefs for select to authenticated
  using (barber_id = auth.uid());
create policy notification_prefs_ins on public.notification_prefs for insert to authenticated
  with check (barber_id = auth.uid());
create policy notification_prefs_upd on public.notification_prefs for update to authenticated
  using (barber_id = auth.uid()) with check (barber_id = auth.uid());
grant select, insert, update on public.notification_prefs to authenticated;

create table public.push_tokens (
  token text primary key,
  barber_id uuid not null references public.barbers (id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);
create index push_tokens_barber_idx on public.push_tokens (barber_id);

alter table public.push_tokens enable row level security;
create policy push_tokens_own on public.push_tokens for select to authenticated
  using (barber_id = auth.uid());
create policy push_tokens_ins on public.push_tokens for insert to authenticated
  with check (barber_id = auth.uid());
create policy push_tokens_upd on public.push_tokens for update to authenticated
  using (barber_id = auth.uid()) with check (barber_id = auth.uid());
create policy push_tokens_del on public.push_tokens for delete to authenticated
  using (barber_id = auth.uid());
grant select, insert, update, delete on public.push_tokens to authenticated;

-- ---- should this one buzz? ------------------------------------------------
-- Pure predicate, no side effects: the toggle for its kind, then quiet hours,
-- then "silent while cutting" — unless it is urgent and urgent_always is on.
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
    -- no row yet = defaults; reviews stay quiet, everything else pushes
    return p_kind <> 'review';
  end if;

  if not (case p_kind
    when 'booking_request' then p.push_booking_request
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

-- ---- delivery -------------------------------------------------------------
-- Fires the Expo push in a swallow-everything block. A dead token, a missing
-- pg_net, or a network blip must never roll back the booking that triggered it.
create or replace function public.push_dispatch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  urgent boolean := false;
  starts timestamptz;
begin
  if new.kind = 'cancellation' and new.booking_id is not null then
    select b.starts_at into starts from public.bookings b where b.id = new.booking_id;
    urgent := starts is not null and starts < now() + interval '2 hours';
  end if;

  if not public.notif_should_push(new.barber_id, new.kind, urgent) then
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
        from public.push_tokens t where t.barber_id = new.barber_id
      )
    );
  exception when others then
    null; -- ponytail: best-effort. The inbox row is the durable record.
  end;
  return new;
end;
$$;

create trigger after_notification_insert
  after insert on public.notifications
  for each row execute function public.push_dispatch();

-- ---- the events themselves ------------------------------------------------
create or replace function public.notify_booking_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  who text;
  svc text;
  whenlbl text;
begin
  select coalesce(b.walk_in_name, p.full_name, 'A client') into who
    from public.bookings b left join public.profiles p on p.id = b.customer_id
    where b.id = new.id;
  select s.name into svc from public.services s where s.id = new.service_id;
  whenlbl := to_char(new.starts_at at time zone 'Africa/Casablanca', 'Dy DD Mon HH24:MI');

  -- a customer's request landing in the barber's lap
  if tg_op = 'INSERT' and new.status = 'pending' and new.customer_id <> new.barber_id then
    insert into public.notifications (barber_id, kind, title, body, booking_id, amount_cents)
    values (new.barber_id, 'booking_request',
      'New booking request',
      who || ' · ' || coalesce(svc, 'Service') || ' · ' || whenlbl,
      new.id, new.price_cents);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status = 'cancelled' and old.status <> 'cancelled' and new.customer_id <> new.barber_id then
      insert into public.notifications (barber_id, kind, title, body, booking_id)
      values (new.barber_id, 'cancellation', 'Booking cancelled',
        who || ' · ' || whenlbl || ' · slot reopened', new.id);
    elsif new.checked_in_at is not null and old.checked_in_at is null then
      insert into public.notifications (barber_id, kind, title, body, booking_id)
      values (new.barber_id, 'checked_in', who || ' checked in',
        'Waiting for ' || to_char(new.starts_at at time zone 'Africa/Casablanca', 'HH24:MI')
        || ' ' || coalesce(svc, 'Service'), new.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger after_booking_notify
  after insert or update on public.bookings
  for each row execute function public.notify_booking_event();

create or replace function public.notify_wallet_topup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  who text;
begin
  select coalesce(p.full_name, 'a customer') into who
    from public.profiles p where p.id = new.user_id;
  insert into public.notifications (barber_id, kind, title, body, amount_cents)
  values (new.created_by, 'wallet',
    'Wallet top-up · ' || (new.amount_cents / 100) || ' DH',
    'You credited ' || who, new.amount_cents);
  return new;
end;
$$;

create trigger after_wallet_notify
  after insert on public.wallet_transactions
  for each row execute function public.notify_wallet_topup();

create or replace function public.notify_message()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  b record;
  who text;
begin
  select barber_id, customer_id into b from public.bookings where id = new.booking_id;
  if b.barber_id is null or new.sender_id = b.barber_id then return new; end if;
  select coalesce(p.full_name, 'A client') into who from public.profiles p where p.id = new.sender_id;
  insert into public.notifications (barber_id, kind, title, body, booking_id)
  values (b.barber_id, 'message', 'Message from ' || who,
    left(coalesce(new.body, 'Sent a photo'), 90), new.booking_id);
  return new;
end;
$$;

create trigger after_message_notify
  after insert on public.messages
  for each row execute function public.notify_message();

create or replace function public.notify_review()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  who text;
begin
  select coalesce(p.full_name, 'A client') into who from public.profiles p where p.id = new.customer_id;
  insert into public.notifications (barber_id, kind, title, body, booking_id)
  values (new.barber_id, 'review',
    who || ' left you ' || new.rating || ' star' || case when new.rating = 1 then '' else 's' end,
    nullif(btrim(coalesce(new.comment, '')), ''), new.booking_id);
  return new;
end;
$$;

create trigger after_review_notify
  after insert on public.reviews
  for each row execute function public.notify_review();

-- ---- inbox helpers --------------------------------------------------------
create or replace function public.notif_mark_all_read()
returns void
language sql security definer set search_path = ''
as $$
  update public.notifications set read_at = now()
  where barber_id = auth.uid() and read_at is null;
$$;
grant execute on function public.notif_mark_all_read() to authenticated;
