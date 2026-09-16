-- 0111_guest_join: the public queue page, step 2 — somebody with no app and no
-- account takes a ticket: a first name, a phone number, four digits.
--
-- Decided with the owner (2026-09-15):
--   · The place is held while the code is typed, five minutes. A walk-in the
--     barber adds by hand in those minutes goes after it. So the hold is a real
--     booking row — no_double_booking and every barber screen already respect
--     one — and a hold nobody confirms is DELETED, not cancelled: nothing was
--     booked, and a cancellation would count against the day in 8c and admin 8b.
--   · Leaving the line needs a fresh code. The phone number is the ticket.
--   · Nothing sends yet: there is no SMS account. Every text lands in
--     `sms_outbox` as 'queued'. Until a provider exists, read a code there in the
--     SQL editor to test.
--
-- The row a guest writes is the walk-in shape the schema already has
-- (customer_id = barber_id, walk_in_name = the first name). fill_booking (0055)
-- confirms it with no deposit, and skips the barber's pause switch, breaks and
-- buffers because it assumes the barber is typing — so walk_in_start (0110) and
-- the checks below carry those instead. notify_booking_event (0037) and
-- notify_customer_cancel (0049) both stay silent on such a row, and a booking
-- with no deposit never opens a deposit hold (0075), so deleting one is clean.
--
-- Every function here is for the page's server only (service_role). The server
-- is what knows the caller's IP, and a per-IP limit anon could spoof is not one.

-- ---- tables ----------------------------------------------------------------
create table if not exists public.guest_tickets (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  token text not null unique,              -- the ticket's address: /q/<shop>/t/<token>
  first_name text not null,
  phone text not null,                     -- +2126… / +2127…
  phone_key text not null,                 -- trailing nine digits, 0022's account match
  source text not null check (source in ('code', 'link')),
  ip_hash text,
  created_at timestamptz not null default now(),
  hold_until timestamptz,                  -- while the code is untyped; null once verified
  verified_at timestamptz,
  left_at timestamptz
);
create index if not exists guest_tickets_phone_idx on public.guest_tickets (phone_key, created_at desc);
create index if not exists guest_tickets_hold_idx on public.guest_tickets (hold_until) where verified_at is null;
alter table public.guest_tickets enable row level security;   -- no policies: server and definers only

-- One row per four-digit conversation: joining, leaving, or proving a number
-- that already holds a ticket before QL-10 says anything about it.
create table if not exists public.guest_codes (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,              -- the code page's address: /q/<shop>/code/<token>
  purpose text not null check (purpose in ('join', 'leave', 'lookup')),
  ticket_id uuid references public.guest_tickets (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,   -- lookup of an app booking
  salon_id uuid not null references public.salons (id) on delete cascade,
  phone text not null,
  phone_key text not null,
  code_hash text not null default '',
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  -- what he was doing, so an expired hold re-quotes the same chair and service
  want jsonb not null default '{}'::jsonb
);
alter table public.guest_codes enable row level security;

-- Every text the product sends. Also the send log the limits count, so a hold
-- that was deleted still counts against the phone that asked for it.
create table if not exists public.sms_outbox (
  id bigserial primary key,
  kind text not null check (kind in ('code', 'next', 'closed')),
  to_phone text not null,
  phone_key text not null,
  ip_hash text,
  body text not null,
  booking_id uuid references public.bookings (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_ref text,
  error text
);
create index if not exists sms_outbox_phone_idx on public.sms_outbox (phone_key, created_at desc);
create index if not exists sms_outbox_ip_idx on public.sms_outbox (ip_hash, created_at desc);
create index if not exists sms_outbox_queued_idx on public.sms_outbox (created_at) where status = 'queued';
alter table public.sms_outbox enable row level security;
drop policy if exists sms_outbox_admin on public.sms_outbox;
create policy sms_outbox_admin on public.sms_outbox for select to authenticated using (public.is_admin());

-- ---- small parts -----------------------------------------------------------
-- A Moroccan mobile as +2126…/+2127…, or null. A landline cannot get the text.
create or replace function public.guest_phone(p_raw text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when d ~ '^(00212|212)[67][0-9]{8}$' then '+212' || right(d, 9)
    when d ~ '^0[67][0-9]{8}$' then '+212' || right(d, 9)
    when d ~ '^[67][0-9]{8}$' then '+212' || d
  end
  from (select regexp_replace(coalesce(p_raw, ''), '\D', '', 'g') as d) x;
$$;

create or replace function public.guest_hash(p text)
returns text
language sql immutable set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex');
$$;

-- gen_random_uuid() rather than random(): a token and a code are credentials,
-- where 0110's shop code is printed on a wall. The first 12 hex characters of a
-- v4 uuid are all random (the version nibble is the 13th).
create or replace function public.guest_token()
returns text
language sql volatile set search_path = ''
as $$
  select left(replace(gen_random_uuid()::text, '-', ''), 12);
$$;

create or replace function public.guest_digits()
returns text
language sql volatile set search_path = ''
as $$
  select lpad(((('x' || left(replace(gen_random_uuid()::text, '-', ''), 7))::bit(28)::int) % 10000)::text, 4, '0');
$$;

-- An unconfirmed hold past its five minutes leaves the barber's day.
create or replace function public.guest_sweep()
returns int
language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  with gone as (
    delete from public.bookings b
     using public.guest_tickets gt
     where gt.booking_id = b.id
       and gt.verified_at is null and gt.hold_until < now()
       and b.started_at is null
    returning b.id
  )
  select count(*)::int into n from gone;
  return n;
end;
$$;

-- When the next text to this phone (and from this address) is allowed; null for
-- now. Guesses, like 0046's 90 days — nothing has tuned them: a phone gets three
-- codes in fifteen minutes and eight a day; an address ten an hour, to at most
-- four different numbers.
create or replace function public.guest_limit(p_phone_key text, p_ip_hash text)
returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
declare v timestamptz;
begin
  select min(o.created_at) + interval '15 minutes' into v from (
    select created_at from public.sms_outbox
     where kind = 'code' and phone_key = p_phone_key and created_at > now() - interval '15 minutes'
     order by created_at desc limit 3) o
  having count(*) >= 3;
  if v is not null then return v; end if;

  select min(o.created_at) + interval '1 day' into v from (
    select created_at from public.sms_outbox
     where kind = 'code' and phone_key = p_phone_key and created_at > now() - interval '1 day'
     order by created_at desc limit 8) o
  having count(*) >= 8;
  if v is not null or p_ip_hash is null then return v; end if;

  select min(o.created_at) + interval '1 hour' into v from (
    select created_at from public.sms_outbox
     where kind = 'code' and ip_hash = p_ip_hash and created_at > now() - interval '1 hour'
     order by created_at desc limit 10) o
  having count(*) >= 10;
  if v is not null then return v; end if;

  if (select count(distinct phone_key) from public.sms_outbox
       where kind = 'code' and ip_hash = p_ip_hash and phone_key <> p_phone_key
         and created_at > now() - interval '1 hour') >= 4 then
    return now() + interval '1 hour';
  end if;
  return null;
end;
$$;

-- Mint a code for a conversation and queue the text. The copy is Public -
-- Messages Out's "Sign-in code" in French: no link, ever. Its apostrophe is a
-- straight one, decided with the owner: the curly ’ is outside the GSM alphabet
-- and would make every code two sends instead of one.
create or replace function public.guest_send(p_session uuid, p_ip_hash text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_digits text := public.guest_digits();
  v_phone text;
  v_key text;
begin
  update public.guest_codes
     set code_hash = public.guest_hash(v_digits || ':' || id::text), sent_at = now(), attempts = 0
   where id = p_session
   returning phone, phone_key into v_phone, v_key;
  insert into public.sms_outbox (kind, to_phone, phone_key, ip_hash, body)
  values ('code', v_phone, v_key, p_ip_hash,
          'Sterncut : votre code est ' || v_digits || '. Valable 5 min. Si vous n''avez rien demandé, ignorez ce message.');
end;
$$;

-- A ticket as QL-05, QL-06 and QL-10 draw it. One builder for a guest ticket and
-- for an app booking, so the two cannot count the line differently. Nº and
-- "ahead" are barber_day_queue's (0029): the position in the barber's confirmed day.
create or replace function public.queue_ticket_json(p_booking uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  with t as (
    select b.id, b.barber_id, b.starts_at, b.started_at, b.completed_at, b.status, b.price_cents,
           b.service_id, b.created_at as booked_at,
           gt.token, gt.first_name, gt.phone, gt.created_at as joined_at, gt.hold_until,
           gt.verified_at, gt.left_at,
           sa.short_code as shop_code, sa.name as shop_name, sa.address,
           bb.short_code as barber_code,
           split_part(coalesce(nullif(btrim(p.full_name), ''), 'Barber'), ' ', 1) as barber_first,
           s.name as service_name
      from public.bookings b
      join public.barbers bb on bb.id = b.barber_id
      join public.salons sa on sa.id = bb.salon_id
      join public.profiles p on p.id = b.barber_id
      left join public.services s on s.id = b.service_id
      left join public.guest_tickets gt on gt.booking_id = b.id
     where b.id = p_booking
  ),
  day as (
    select d.id, d.starts_at, d.started_at, d.completed_at,
           case when d.walk_in_name is not null then d.walk_in_name
                when d.customer_id = d.barber_id then 'Walk-in'
                else split_part(coalesce(dp.full_name, 'Client'), ' ', 1)
                  || case when split_part(coalesce(dp.full_name, ''), ' ', 2) <> ''
                          then ' ' || left(split_part(dp.full_name, ' ', 2), 1) || '.' else '' end
           end as label
      from public.bookings d
      join t on t.barber_id = d.barber_id
      left join public.profiles dp on dp.id = d.customer_id
     where d.status = 'confirmed'
       and (d.starts_at at time zone 'Africa/Casablanca')::date
           = (t.starts_at at time zone 'Africa/Casablanca')::date
  )
  select json_build_object(
    'token', t.token,
    'shop_code', t.shop_code, 'shop', t.shop_name, 'address', t.address,
    'barber_code', t.barber_code, 'barber', t.barber_first,
    'service_id', t.service_id, 'service', t.service_name, 'price_cents', t.price_cents,
    'first_name', t.first_name, 'phone', t.phone,
    'joined_at', coalesce(t.joined_at, t.booked_at), 'hold_until', t.hold_until,
    'no', (select count(*) from day where (day.starts_at, day.id) <= (t.starts_at, t.id))::int,
    'ahead', (select count(*) from day where day.completed_at is null and day.starts_at < t.starts_at)::int,
    'wait_min', greatest(0, ceil(extract(epoch from (t.starts_at - now())) / 60))::int,
    'in_chair', (select json_build_object(
                          'label', c.label,
                          'no', (select count(*) from day d2 where (d2.starts_at, d2.id) <= (c.starts_at, c.id)))
                   from day c
                  where c.started_at is not null and c.completed_at is null and c.id <> t.id
                  order by c.started_at desc limit 1),
    'stage', case
               when t.status = 'cancelled' and t.left_at is not null then 'left'
               when t.status <> 'confirmed' then 'cancelled'
               when t.completed_at is not null then 'done'
               when t.started_at is not null then 'in_chair'
               when t.token is not null and t.verified_at is null then 'held'
               else 'waiting'
             end)
  from t;
$$;

-- Put a guest into the back of a chair's line. Null when the chair can no longer
-- take him. Verified straight away only when the number was just proven (QL-10's
-- "leave it and join"); otherwise held for five minutes.
create or replace function public.guest_hold(
  p_salon uuid, p_barber uuid, p_service uuid, p_name text, p_phone text,
  p_source text, p_ip_hash text, p_verified boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_minutes int;
  v_start timestamptz;
  v_booking uuid;
  v_ticket uuid;
begin
  select sv.duration_min into v_minutes from public.services sv
   where sv.id = p_service and sv.barber_id = p_barber and sv.is_active;
  if v_minutes is null then return null; end if;
  if not public.salon_open(p_salon) then return null; end if;
  if not exists (select 1 from public.barbers b
                  where b.id = p_barber and b.salon_id = p_salon and b.status = 'approved'
                    and b.salon_status = 'approved' and b.accepting_bookings) then
    return null;
  end if;

  for attempt in 1..3 loop
    v_start := public.walk_in_start(p_barber, v_minutes);
    if v_start is null then return null; end if;
    begin
      insert into public.bookings (customer_id, barber_id, service_id, starts_at, walk_in_name, deposit_cents)
      values (p_barber, p_barber, p_service, v_start, p_name, 0)
      returning id into v_booking;
      exit;
    exception
      -- somebody took that place a moment ago: the next one is behind them
      when exclusion_violation then v_booking := null;
      -- fill_booking or the closed-shop trigger refused it
      when raise_exception then return null;
    end;
  end loop;
  if v_booking is null then return null; end if;

  insert into public.guest_tickets
    (booking_id, salon_id, token, first_name, phone, phone_key, source, ip_hash, hold_until, verified_at)
  values (v_booking, p_salon, public.guest_token(), p_name, p_phone, right(p_phone, 9),
          case when p_source = 'link' then 'link' else 'code' end, p_ip_hash,
          case when p_verified then null else now() + interval '5 minutes' end,
          case when p_verified then now() end)
  returning id into v_ticket;
  return v_ticket;
end;
$$;

-- ---- the page's calls --------------------------------------------------------
-- QL-04 → QL-05. Always answers 'code' when a text went out, whether the number
-- is joining or already holds a ticket, so typing somebody else's number learns
-- nothing until the code proves it is yours.
create or replace function public.guest_request(
  p_shop text, p_barber text, p_service uuid, p_first_name text, p_phone text,
  p_ip text, p_source text default 'code')
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_today date := (now() at time zone shop_tz)::date;
  v_name text := left(btrim(regexp_replace(coalesce(p_first_name, ''), '\s+', ' ', 'g')), 30);
  v_phone text := public.guest_phone(p_phone);
  v_key text;
  v_ip text := case when nullif(btrim(coalesce(p_ip, '')), '') is null then null
                    else public.guest_hash(btrim(p_ip)) end;
  v_want jsonb;
  v_salon uuid;
  v_code text;
  v_barber uuid;
  v_retry timestamptz;
  v_existing uuid;
  v_app_booking uuid;
  v_ticket uuid;
  v_session uuid;
  v_token text;
begin
  perform public.guest_sweep();

  if v_name = '' then return json_build_object('state', 'invalid', 'field', 'name'); end if;
  if v_phone is null then return json_build_object('state', 'invalid', 'field', 'phone'); end if;
  v_key := right(v_phone, 9);

  select sa.id, sa.short_code into v_salon, v_code from public.salons sa
   where sa.short_code = upper(btrim(coalesce(p_shop, ''))) and sa.status in ('live', 'suspended');
  select b.id into v_barber from public.barbers b
   where b.short_code = upper(btrim(coalesce(p_barber, ''))) and b.salon_id = v_salon;
  v_want := jsonb_build_object('shop', coalesce(v_code, upper(btrim(coalesce(p_shop, '')))),
                               'barber', upper(btrim(coalesce(p_barber, ''))),
                               'service', p_service, 'first_name', v_name, 'source', p_source);
  if v_salon is null or v_barber is null or p_service is null then
    return json_build_object('state', 'gone', 'want', v_want);
  end if;

  v_retry := public.guest_limit(v_key, v_ip);
  if v_retry is not null then return json_build_object('state', 'limited', 'retry_at', v_retry); end if;

  -- QL-10: one line at a time — a guest ticket on this number, or a booking on
  -- an account with it (join_queue's own rule, keyed on the phone instead)
  select gt.id into v_existing
    from public.guest_tickets gt
    join public.bookings b on b.id = gt.booking_id
   where gt.phone_key = v_key and gt.verified_at is not null and gt.left_at is null
     and b.status = 'confirmed' and b.completed_at is null
     and (b.starts_at at time zone shop_tz)::date = v_today
   limit 1;
  if v_existing is null then
    -- ponytail: a scan over profiles per request. An index on the trailing nine
    -- digits when accounts number in the tens of thousands.
    select b.id into v_app_booking
      from public.profiles p
      join public.bookings b on b.customer_id = p.id
     where right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) = v_key
       and b.customer_id <> b.barber_id
       and b.status = 'confirmed' and b.completed_at is null
       and (b.starts_at at time zone shop_tz)::date = v_today
     limit 1;
  end if;

  if v_existing is not null or v_app_booking is not null then
    insert into public.guest_codes (token, purpose, ticket_id, booking_id, salon_id, phone, phone_key, expires_at, want)
    values (public.guest_token(), 'lookup', v_existing, v_app_booking, v_salon, v_phone, v_key,
            now() + interval '5 minutes', v_want)
    returning id, token into v_session, v_token;
    perform public.guest_send(v_session, v_ip);
    return json_build_object('state', 'code', 'token', v_token);
  end if;

  -- the same number starting again (the back button, a typo) replaces its own
  -- unconfirmed hold rather than holding two places
  delete from public.bookings b
   using public.guest_tickets gt
   where gt.booking_id = b.id and gt.phone_key = v_key
     and gt.verified_at is null and b.started_at is null;

  v_ticket := public.guest_hold(v_salon, v_barber, p_service, v_name, v_phone, p_source, v_ip, false);
  if v_ticket is null then return json_build_object('state', 'gone', 'want', v_want); end if;

  insert into public.guest_codes (token, purpose, ticket_id, salon_id, phone, phone_key, expires_at, want)
  values (public.guest_token(), 'join', v_ticket, v_salon, v_phone, v_key,
          (select hold_until from public.guest_tickets where id = v_ticket), v_want)
  returning id, token into v_session, v_token;
  perform public.guest_send(v_session, v_ip);
  return json_build_object('state', 'code', 'token', v_token);
end;
$$;

-- QL-05 as it stands: which conversation, the countdowns, and for a join the
-- place being held (without the ticket's own token — that comes with the code).
create or replace function public.guest_code_view(p_token text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  c public.guest_codes;
  v_hold jsonb;
begin
  select * into c from public.guest_codes where token = btrim(coalesce(p_token, ''));
  if not found then return json_build_object('found', false); end if;
  if c.purpose = 'join' and c.ticket_id is not null then
    v_hold := public.queue_ticket_json((select booking_id from public.guest_tickets where id = c.ticket_id))::jsonb - 'token';
  end if;
  return json_build_object(
    'found', true,
    'purpose', c.purpose,
    'phone', c.phone,
    'resend_at', c.sent_at + interval '30 seconds',
    'expires_at', c.expires_at,
    'expired', c.expires_at < now() or (c.purpose = 'join' and c.ticket_id is null),
    'used', c.used_at is not null,
    'attempts_left', greatest(0, 5 - c.attempts),
    'hold', v_hold,
    'want', c.want,
    'now', now());
end;
$$;

create or replace function public.guest_resend(p_token text, p_ip text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  c public.guest_codes;
  v_ip text := case when nullif(btrim(coalesce(p_ip, '')), '') is null then null
                    else public.guest_hash(btrim(p_ip)) end;
  v_retry timestamptz;
begin
  select * into c from public.guest_codes where token = btrim(coalesce(p_token, '')) for update;
  if not found then return json_build_object('state', 'gone'); end if;
  if c.used_at is not null or c.expires_at < now() or (c.purpose = 'join' and c.ticket_id is null) then
    return json_build_object('state', 'expired', 'want', c.want);
  end if;
  -- the 30 seconds on the page is a courtesy; this is the rule
  if c.sent_at > now() - interval '30 seconds' then
    return json_build_object('state', 'wait', 'resend_at', c.sent_at + interval '30 seconds');
  end if;
  v_retry := public.guest_limit(c.phone_key, v_ip);
  if v_retry is not null then return json_build_object('state', 'limited', 'retry_at', v_retry); end if;
  perform public.guest_send(c.id, v_ip);
  return json_build_object('state', 'sent');
end;
$$;

-- The four digits. Five wrong tries end the conversation.
create or replace function public.guest_verify(p_token text, p_code text, p_ip text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  c public.guest_codes;
  v_ticket_token text;
  v_booking uuid;
  v_started timestamptz;
begin
  perform public.guest_sweep();
  select * into c from public.guest_codes where token = btrim(coalesce(p_token, '')) for update;
  if not found then return json_build_object('state', 'gone'); end if;

  if c.used_at is not null then
    if c.purpose = 'join' and c.ticket_id is not null then
      select token into v_ticket_token from public.guest_tickets where id = c.ticket_id;
      return json_build_object('state', 'joined', 'ticket', v_ticket_token, 'shop', c.want ->> 'shop');
    end if;
    return json_build_object('state', 'expired', 'want', c.want);
  end if;
  if c.expires_at < now() or (c.purpose = 'join' and c.ticket_id is null) then
    return json_build_object('state', 'expired', 'want', c.want);
  end if;
  if c.attempts >= 5 then return json_build_object('state', 'locked', 'want', c.want); end if;

  if public.guest_hash(regexp_replace(coalesce(p_code, ''), '\D', '', 'g') || ':' || c.id::text) <> c.code_hash then
    update public.guest_codes set attempts = attempts + 1 where id = c.id;
    return json_build_object('state', 'wrong', 'attempts_left', greatest(0, 4 - c.attempts), 'want', c.want);
  end if;
  update public.guest_codes set used_at = now() where id = c.id;

  if c.purpose = 'join' then
    update public.guest_tickets set verified_at = now(), hold_until = null
     where id = c.ticket_id
     returning token, booking_id into v_ticket_token, v_booking;
    if not exists (select 1 from public.bookings where id = v_booking and status = 'confirmed') then
      return json_build_object('state', 'expired', 'want', c.want);
    end if;
    return json_build_object('state', 'joined', 'ticket', v_ticket_token, 'shop', c.want ->> 'shop');
  end if;

  if c.purpose = 'leave' then
    select gt.booking_id, b.started_at into v_booking, v_started
      from public.guest_tickets gt join public.bookings b on b.id = gt.booking_id
     where gt.id = c.ticket_id;
    if v_started is not null then return json_build_object('state', 'started', 'want', c.want); end if;
    update public.bookings
       set status = 'cancelled', cancel_reason = 'Left the queue'
     where id = v_booking and status = 'confirmed';
    update public.guest_tickets set left_at = now() where id = c.ticket_id;
    return json_build_object('state', 'left', 'want', c.want);
  end if;

  -- lookup: the number is proven, so now QL-10 may show what it holds
  v_booking := coalesce((select booking_id from public.guest_tickets where id = c.ticket_id), c.booking_id);
  return json_build_object(
    'state', 'already',
    'ticket', public.queue_ticket_json(v_booking),
    'guest', c.ticket_id is not null,
    'want', c.want);
end;
$$;

-- QL-05's "Wrong number — change it": the hold goes, nothing else happens.
create or replace function public.guest_drop(p_token text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare c public.guest_codes;
begin
  select * into c from public.guest_codes where token = btrim(coalesce(p_token, '')) for update;
  if not found then return json_build_object('state', 'gone'); end if;
  if c.purpose = 'join' and c.used_at is null and c.ticket_id is not null then
    delete from public.bookings b
     using public.guest_tickets gt
     where gt.id = c.ticket_id and gt.booking_id = b.id
       and gt.verified_at is null and b.started_at is null;
  end if;
  delete from public.guest_codes where id = c.id;
  return json_build_object('state', 'dropped', 'want', c.want);
end;
$$;

-- QL-06's "Leave the queue": a fresh code to the ticket's number first.
create or replace function public.guest_leave(p_ticket text, p_ip text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
  v_ip text := case when nullif(btrim(coalesce(p_ip, '')), '') is null then null
                    else public.guest_hash(btrim(p_ip)) end;
  v_retry timestamptz;
  v_session uuid;
  v_token text;
begin
  select gt.id, gt.salon_id, gt.phone, gt.phone_key, gt.first_name, b.started_at, b.completed_at, b.status,
         sa.short_code as shop, bb.short_code as barber, b.service_id
    into t
    from public.guest_tickets gt
    join public.bookings b on b.id = gt.booking_id
    join public.salons sa on sa.id = gt.salon_id
    join public.barbers bb on bb.id = b.barber_id
   where gt.token = btrim(coalesce(p_ticket, '')) and gt.verified_at is not null and gt.left_at is null;
  if not found then return json_build_object('state', 'gone'); end if;
  if t.status <> 'confirmed' or t.completed_at is not null then
    return json_build_object('state', 'gone');
  end if;
  if t.started_at is not null then return json_build_object('state', 'started'); end if;

  v_retry := public.guest_limit(t.phone_key, v_ip);
  if v_retry is not null then return json_build_object('state', 'limited', 'retry_at', v_retry); end if;

  insert into public.guest_codes (token, purpose, ticket_id, salon_id, phone, phone_key, expires_at, want)
  values (public.guest_token(), 'leave', t.id, t.salon_id, t.phone, t.phone_key, now() + interval '5 minutes',
          jsonb_build_object('shop', t.shop, 'barber', t.barber, 'service', t.service_id,
                             'first_name', t.first_name, 'ticket', p_ticket))
  returning id, token into v_session, v_token;
  perform public.guest_send(v_session, v_ip);
  return json_build_object('state', 'code', 'token', v_token);
end;
$$;

-- QL-10's "Leave it and join <barber>": the number was proven minutes ago, so
-- the old ticket goes and the new one is confirmed without a second code. An
-- app booking is never cancelled from a web page.
create or replace function public.guest_switch(p_token text, p_ip text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  c public.guest_codes;
  v_ip text := case when nullif(btrim(coalesce(p_ip, '')), '') is null then null
                    else public.guest_hash(btrim(p_ip)) end;
  v_old uuid;
  v_started timestamptz;
  v_salon uuid;
  v_barber uuid;
  v_ticket uuid;
  v_ticket_token text;
begin
  perform public.guest_sweep();
  select * into c from public.guest_codes where token = btrim(coalesce(p_token, '')) for update;
  if not found or c.purpose <> 'lookup' or c.used_at is null or c.used_at < now() - interval '10 minutes'
     or c.ticket_id is null then
    return json_build_object('state', 'gone', 'want', coalesce(c.want, '{}'::jsonb));
  end if;

  select gt.booking_id, b.started_at into v_old, v_started
    from public.guest_tickets gt join public.bookings b on b.id = gt.booking_id
   where gt.id = c.ticket_id and gt.left_at is null and b.status = 'confirmed';
  if v_old is null then return json_build_object('state', 'gone', 'want', c.want); end if;
  if v_started is not null then return json_build_object('state', 'started', 'want', c.want); end if;

  select sa.id into v_salon from public.salons sa
   where sa.short_code = c.want ->> 'shop' and sa.status in ('live', 'suspended');
  select b.id into v_barber from public.barbers b
   where b.short_code = c.want ->> 'barber' and b.salon_id = v_salon;
  if v_salon is null or v_barber is null then return json_build_object('state', 'gone', 'want', c.want); end if;

  update public.bookings set status = 'cancelled', cancel_reason = 'Left the queue'
   where id = v_old and status = 'confirmed';
  update public.guest_tickets set left_at = now() where id = c.ticket_id;

  v_ticket := public.guest_hold(v_salon, v_barber, (c.want ->> 'service')::uuid, c.want ->> 'first_name',
                                c.phone, c.want ->> 'source', v_ip, true);
  delete from public.guest_codes where id = c.id;
  if v_ticket is null then return json_build_object('state', 'gone', 'want', c.want); end if;
  select token into v_ticket_token from public.guest_tickets where id = v_ticket;
  return json_build_object('state', 'joined', 'ticket', v_ticket_token, 'shop', c.want ->> 'shop');
end;
$$;

-- QL-06, re-opened from its link in any browser: the address is the credential
-- for reading, the phone (through a code) for anything that changes the ticket.
create or replace function public.guest_ticket(p_token text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_booking uuid;
begin
  select booking_id into v_booking from public.guest_tickets
   where token = btrim(coalesce(p_token, '')) and verified_at is not null;
  if v_booking is null then return json_build_object('found', false); end if;
  return (public.queue_ticket_json(v_booking)::jsonb || jsonb_build_object('found', true))::json;
end;
$$;

-- ---- who may call what -------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'guest_phone(text)', 'guest_hash(text)', 'guest_token()', 'guest_digits()', 'guest_sweep()',
    'guest_limit(text, text)', 'guest_send(uuid, text)', 'queue_ticket_json(uuid)',
    'guest_hold(uuid, uuid, uuid, text, text, text, text, boolean)',
    'guest_request(text, text, uuid, text, text, text, text)', 'guest_code_view(text)',
    'guest_resend(text, text)', 'guest_verify(text, text, text)', 'guest_drop(text)',
    'guest_leave(text, text)', 'guest_switch(text, text)', 'guest_ticket(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Every minute when pg_cron exists; otherwise the sweep at the top of every
-- guest call is what clears a stale hold.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sterncut-guest-holds', '* * * * *', 'select public.guest_sweep()');
  else
    raise notice 'pg_cron not installed — an unconfirmed hold leaves the barber''s day at the next '
      'guest request rather than at five minutes exactly.';
  end if;
end $$;

-- ---- checked at apply time ---------------------------------------------------
do $$
begin
  assert public.guest_phone('0661341290') = '+212661341290', 'a local mobile';
  assert public.guest_phone('+212 6 61 34 12 90') = '+212661341290', 'an international mobile';
  assert public.guest_phone('00212661341290') = '+212661341290', 'with 00';
  assert public.guest_phone('761341290') = '+212761341290', 'nine digits on a 07 number';
  assert public.guest_phone('0539123456') is null, 'a landline cannot receive the text';
  assert public.guest_phone('12345') is null, 'junk is not a phone';
  assert length(public.guest_token()) = 12, 'a token is twelve characters';
  assert public.guest_digits() ~ '^[0-9]{4}$', 'a code is four digits';
  assert (public.guest_ticket('nope') ->> 'found')::boolean is false, 'junk opens no ticket';
  assert (public.guest_code_view('nope') ->> 'found')::boolean is false, 'junk opens no code page';
  assert (public.guest_request('ZZZZZZ', 'ZZZZ', null, 'Rachid', '0661341290', null) ->> 'state') = 'gone',
    'no shop, no hold';
  assert (public.guest_request('ZZZZZZ', 'ZZZZ', null, '  ', '0661341290', null) ->> 'field') = 'name',
    'a name is needed';
end $$;
