-- 0118_app_first: ADDENDUM-app-first (turn Q3) — the web page stops taking places.
-- Needs 0110 … 0117.
--
-- The design was reversed (2026-09-16): places are held in the app, or by the
-- barber typing a name. The page is for anonymous eyes — see the wait, then
-- install or ask the barber. So this migration mostly takes things away:
--
--   · The four-digit code is gone, with everything that kept it honest: the
--     code texts, the attempt counter, the fifteen-minute block, leaving by
--     code, switching lines, rejoining after a miss, and QL-13's two taps.
--     Their functions are dropped. `guest_codes` and `guest_misses` keep their
--     rows — nothing reads them now; drop them when nobody needs the history.
--   · The closed-line text (0116) is gone. A6: a guest gets the confirm text and
--     the you're-next text, nothing else.
--
-- What is added:
--
--   · `public_queue` says the line itself, with no names: each chair's tickets
--     as Nº, in the chair or waiting, and minutes (A3.1). And who opens next, by
--     first name, for QL-26.
--   · QL-23, the one write left on the web, for somebody not at the shop:
--     `guest_join` puts his first name on a chair and texts him a link. There is
--     no code. Until he taps it the ticket is UNCONFIRMED — `verified_at` stays
--     null, nothing sweeps it away, and the barber may call past it (the app
--     greys the row). `guest_confirm` is the tap (GET /c/:token): single use,
--     good until the end of the shop's day.
--   · BTD-02's optional number: `bookings.walk_in_phone`. A walk-in the barber
--     adds with a number gets exactly one text, ever — the you're-next one.
--   · "Next" (0113) skips a ticket nobody has confirmed, because the barber may
--     call past it; the person behind is the one told.
--
-- The 8-minute called-chair hold (0116's sweep) stays: A5 calls it barber-side.
-- Nothing sends yet — every text still waits in `sms_outbox` as 'queued'.

-- ---- what goes ---------------------------------------------------------------
drop trigger if exists after_salon_closed_tell_guests on public.salons;
drop function if exists public.guest_closed_on_salon();
drop function if exists public.guest_closed_check(uuid);

drop function if exists public.guest_request(text, text, uuid, text, text, text, text);
drop function if exists public.guest_code_view(text);
drop function if exists public.guest_resend(text, text);
drop function if exists public.guest_verify(text, text, text);
drop function if exists public.guest_drop(text);
drop function if exists public.guest_leave(text, text);
drop function if exists public.guest_switch(text, text);
drop function if exists public.guest_rejoin(text, text);
drop function if exists public.guest_coming(text);
drop function if exists public.guest_wait(text);
drop function if exists public.guest_send(uuid, text);
drop function if exists public.guest_digits();
drop function if exists public.guest_misses_now(text);
drop function if exists public.guest_limit(text, text);

-- ---- the columns -------------------------------------------------------------
alter table public.guest_tickets add column if not exists confirm_token text;    -- only ever in the text
alter table public.guest_tickets add column if not exists confirm_until timestamptz;
create unique index if not exists guest_tickets_confirm_token_key on public.guest_tickets (confirm_token);

alter table public.bookings add column if not exists walk_in_phone text;        -- BTD-02, +2126… / +2127…

alter table public.sms_outbox drop constraint if exists sms_outbox_kind_check;
alter table public.sms_outbox add constraint sms_outbox_kind_check
  check (kind in ('code', 'next', 'closed', 'hold'));   -- code and closed: rows from before Q3

-- The number a barber types is tidied the way a guest's is, and only a walk-in
-- carries one: an app customer is reached through the app. Definer, because
-- guest_phone is the server's (0111) and the barber inserts as himself.
create or replace function public.tidy_walk_in_phone()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(new.walk_in_phone, '')), '') is null then
    new.walk_in_phone := null;
    return new;
  end if;
  if new.customer_id <> new.barber_id then
    raise exception 'Only a walk-in you add carries a number';
  end if;
  new.walk_in_phone := public.guest_phone(new.walk_in_phone);
  if new.walk_in_phone is null then
    raise exception 'That is not a Moroccan mobile number';
  end if;
  return new;
end;
$$;

drop trigger if exists before_booking_walk_in_phone on public.bookings;
create trigger before_booking_walk_in_phone
  before insert or update of walk_in_phone on public.bookings
  for each row execute function public.tidy_walk_in_phone();

-- ---- the page's read: the line, nameless -----------------------------------------
-- 0115's public_queue with two additions: each chair's `line` (Nº, in the chair,
-- minutes — never a name) and `opens.barbers` (who works the next open day).
create or replace function public.public_queue(p_shop text, p_barber text default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_today date := (now() at time zone shop_tz)::date;
  v_dow int := extract(dow from (now() at time zone shop_tz))::int;
  v_now_min int := extract(hour from (now() at time zone shop_tz))::int * 60
                 + extract(minute from (now() at time zone shop_tz))::int;
  v_shop text := btrim(coalesce(p_shop, ''));
  v_pick text := btrim(coalesce(p_barber, ''));
  s record;
  v_open boolean;
  v_chosen text;
  v_chairs json;
  v_shut boolean;
  v_week json;
  v_open_days int;
  v_opens json;
begin
  if v_shop ~* uuid_re then
    select sa.id, sa.short_code, sa.name, sa.address, sa.close_min, sa.closed_at
      into s from public.salons sa
     where sa.id = lower(v_shop)::uuid and sa.status in ('live', 'suspended');
  else
    select sa.id, sa.short_code, sa.name, sa.address, sa.close_min, sa.closed_at
      into s from public.salons sa
     where sa.short_code = upper(v_shop) and sa.status in ('live', 'suspended');
  end if;
  if not found then
    return json_build_object('found', false);
  end if;

  v_open := public.salon_open(s.id);

  if v_pick ~* uuid_re then
    select b.short_code into v_chosen from public.barbers b
     where b.id = lower(v_pick)::uuid and b.salon_id = s.id;
  elsif v_pick <> '' then
    select b.short_code into v_chosen from public.barbers b
     where b.short_code = upper(v_pick) and b.salon_id = s.id;
  end if;

  with team as (
    select b.id, b.short_code, b.accepting_bookings,
           regexp_split_to_array(coalesce(nullif(btrim(p.full_name), ''), 'Barber'), '\s+') as words
      from public.barbers b
      join public.profiles p on p.id = b.id
     where b.salon_id = s.id and b.status = 'approved' and b.salon_status = 'approved'
  ),
  menu as (
    select sv.barber_id, sv.id, sv.name, sv.price_cents, sv.duration_min, sv.created_at,
           public.walk_in_start(sv.barber_id, sv.duration_min) as starts
      from public.services sv
      join team t on t.id = sv.barber_id
     where sv.is_active
  ),
  -- the day as 0029 numbers it: every confirmed booking today, done ones included
  day as (
    select bk.barber_id, bk.starts_at, bk.started_at, bk.completed_at,
           row_number() over (partition by bk.barber_id order by bk.starts_at, bk.id)::int as no
      from public.bookings bk
      join team t on t.id = bk.barber_id
     where bk.status = 'confirmed'
       and (bk.starts_at at time zone shop_tz)::date = v_today
  ),
  booked as (
    select d.barber_id,
           (count(*) filter (where d.completed_at is null))::int as waiting,
           count(*)::int as tickets
      from day d
     group by d.barber_id
  ),
  stars as (
    select r.barber_id, round(avg(r.rating)::numeric, 1) as rating
      from public.reviews r
      join team t on t.id = r.barber_id
     where r.state = 'public'
     group by r.barber_id
  ),
  cuts as (
    select bk.barber_id, count(*)::int as n
      from public.bookings bk
      join team t on t.id = bk.barber_id
     where bk.completed_at is not null
     group by bk.barber_id
  ),
  chair as (
    select t.short_code as code,
           t.words[1] || case when array_length(t.words, 1) > 1
                              then ' ' || left(t.words[2], 1) || '.' else '' end as name,
           upper(left(t.words[1], 1) || coalesce(left(t.words[2], 1), '')) as initials,
           coalesce(bd.waiting, 0) as waiting,
           coalesce(bd.tickets, 0) + 1 as next_no,
           st.rating,
           coalesce(cu.n, 0) as cuts,
           case
             when not v_open then 'closed'
             when not (exists (select 1 from public.time_blocks tb
                                where tb.barber_id = t.id and tb.kind = 'open' and tb.day = v_today)
                       or (not exists (select 1 from public.days_off d
                                        where d.barber_id = t.id and d.day = v_today)
                           and exists (select 1 from public.availability a
                                        where a.barber_id = t.id and a.weekday = v_dow)))
               then 'off'
             when not t.accepting_bookings then 'paused'
             when not exists (select 1 from menu m where m.barber_id = t.id) then 'no_services'
             when not exists (select 1 from menu m where m.barber_id = t.id and m.starts is not null)
               then 'full'
             else 'taking'
           end as state,
           (select coalesce(json_agg(json_build_object(
                     'id', m.id,
                     'name', m.name,
                     'price_cents', m.price_cents,
                     'duration_min', m.duration_min,
                     'wait_min', case when m.starts is not null
                                      then greatest(0, ceil(extract(epoch from (m.starts - now())) / 60))::int
                                 end)
                   order by m.created_at, m.name), '[]'::json)
              from menu m where m.barber_id = t.id) as services,
           -- QL-18's THE LINE: numbers and minutes, and nothing about anyone
           (select coalesce(json_agg(json_build_object(
                     'no', d.no,
                     'in_chair', d.started_at is not null,
                     'wait_min', case when d.started_at is null
                                      then greatest(0, ceil(extract(epoch from (d.starts_at - now())) / 60))::int
                                 end)
                   order by d.starts_at, d.no), '[]'::json)
              from day d where d.barber_id = t.id and d.completed_at is null) as line
      from team t
      left join booked bd on bd.barber_id = t.id
      left join stars st on st.barber_id = t.id
      left join cuts cu on cu.barber_id = t.id
  )
  select coalesce(json_agg(json_build_object(
           'code', c.code,
           'name', c.name,
           'initials', c.initials,
           'waiting', c.waiting,
           'next_no', c.next_no,
           'rating', c.rating,
           'cuts', c.cuts,
           'state', c.state,
           'services', c.services,
           'line', c.line)
         order by (c.state = 'taking') desc, c.name), '[]'::json)
    into v_chairs
    from chair c;

  v_shut := (s.close_min < 1440 and v_now_min >= s.close_min)
    or not exists (
      select 1 from public.barbers b
       where b.salon_id = s.id and b.status = 'approved' and b.salon_status = 'approved'
         and (exists (select 1 from public.availability a
                       where a.barber_id = b.id and a.weekday = v_dow and a.end_min > v_now_min
                         and not exists (select 1 from public.days_off d
                                          where d.barber_id = b.id and d.day = v_today))
              or exists (select 1 from public.time_blocks tb
                          where tb.barber_id = b.id and tb.kind = 'open' and tb.day = v_today
                            and tb.end_min > v_now_min)));

  select json_agg(json_build_object('dow', w.dow, 'open_min', h.open_min, 'close_min', h.close_min)
                  order by w.dow)
    into v_week
    from generate_series(0, 6) w(dow)
    left join lateral (
      select min(a.start_min) as open_min, max(a.end_min) as close_min
        from public.availability a
        join public.barbers b on b.id = a.barber_id
       where b.salon_id = s.id and b.status = 'approved' and b.salon_status = 'approved'
         and a.weekday = w.dow
    ) h on true;

  -- QL-26: the next day a chair works, when, and who ("Youssef, Hamza and Sami")
  select min(d.days) into v_open_days
    from generate_series(1, 7) d(days)
   where exists (
     select 1 from public.availability a
       join public.barbers b on b.id = a.barber_id
      where b.salon_id = s.id and b.status = 'approved' and b.salon_status = 'approved'
        and a.weekday = extract(dow from (v_today + d.days))::int
        and not exists (select 1 from public.days_off o
                         where o.barber_id = b.id and o.day = v_today + d.days));

  if v_open_days is not null then
    with who as (
      select split_part(coalesce(nullif(btrim(p.full_name), ''), 'Barber'), ' ', 1) as first,
             min(a.start_min) as start_min
        from public.availability a
        join public.barbers b on b.id = a.barber_id
        join public.profiles p on p.id = b.id
       where b.salon_id = s.id and b.status = 'approved' and b.salon_status = 'approved'
         and a.weekday = extract(dow from (v_today + v_open_days))::int
         and not exists (select 1 from public.days_off o
                          where o.barber_id = b.id and o.day = v_today + v_open_days)
       group by b.id, p.full_name
    )
    select json_build_object(
             'days', v_open_days,
             'start_min', min(w.start_min),
             'barber', (array_agg(w.first order by w.start_min, w.first))[1],
             'barbers', json_agg(w.first order by w.start_min, w.first))
      into v_opens
      from who w;
  end if;

  return json_build_object(
    'found', true,
    'code', s.short_code,
    'name', s.name,
    'address', s.address,
    'close_min', case when s.close_min < 1440 then s.close_min end,
    'open', v_open,
    'closed_at', case when not v_open then s.closed_at end,
    'shut', v_shut,
    'week', v_week,
    'opens', v_opens,
    'chosen', v_chosen,
    'now', now(),
    'chairs', v_chairs);
end;
$$;

-- ---- QL-23 · a name on the line from somewhere else --------------------------------
-- 0111's limits, counted on the confirm texts: a phone gets three in fifteen
-- minutes and eight a day; an address ten an hour, to at most four numbers.
-- Still guesses nothing has tuned.
create or replace function public.guest_join_limit(p_phone_key text, p_ip_hash text)
returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
declare v timestamptz;
begin
  select min(o.created_at) + interval '15 minutes' into v from (
    select created_at from public.sms_outbox
     where kind = 'hold' and phone_key = p_phone_key and created_at > now() - interval '15 minutes'
     order by created_at desc limit 3) o
  having count(*) >= 3;
  if v is not null then return v; end if;

  select min(o.created_at) + interval '1 day' into v from (
    select created_at from public.sms_outbox
     where kind = 'hold' and phone_key = p_phone_key and created_at > now() - interval '1 day'
     order by created_at desc limit 8) o
  having count(*) >= 8;
  if v is not null or p_ip_hash is null then return v; end if;

  select min(o.created_at) + interval '1 hour' into v from (
    select created_at from public.sms_outbox
     where kind = 'hold' and ip_hash = p_ip_hash and created_at > now() - interval '1 hour'
     order by created_at desc limit 10) o
  having count(*) >= 10;
  if v is not null then return v; end if;

  if (select count(distinct phone_key) from public.sms_outbox
       where kind = 'hold' and ip_hash = p_ip_hash and phone_key <> p_phone_key
         and created_at > now() - interval '1 hour') >= 4 then
    return now() + interval '1 hour';
  end if;
  return null;
end;
$$;

-- The chair and the service are the ones QL-23 named (the form carries both), so
-- what the page said is what is written. `p_base` is the page's own origin, for
-- the link in the text.
create or replace function public.guest_join(
  p_shop text, p_barber text, p_service uuid, p_first_name text, p_phone text,
  p_ip text, p_source text default 'code', p_base text default null)
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
  v_base text := case when coalesce(p_base, '') ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$' then p_base
                      else 'https://sterncut.ma' end;
  v_salon uuid;
  v_code text;
  v_barber uuid;
  v_service uuid;
  v_retry timestamptz;
  v_ticket uuid;
  t record;
  v_confirm text := public.guest_token();
begin
  perform public.guest_sweep();

  if v_name = '' then return json_build_object('state', 'invalid', 'field', 'name'); end if;
  if v_phone is null then return json_build_object('state', 'invalid', 'field', 'phone'); end if;
  v_key := right(v_phone, 9);

  select sa.id, sa.short_code into v_salon, v_code from public.salons sa
   where sa.short_code = upper(btrim(coalesce(p_shop, ''))) and sa.status in ('live', 'suspended');
  select b.id into v_barber from public.barbers b
   where b.short_code = upper(btrim(coalesce(p_barber, ''))) and b.salon_id = v_salon;
  if v_salon is null or v_barber is null then
    return json_build_object('state', 'gone', 'shop', coalesce(v_code, upper(btrim(coalesce(p_shop, '')))));
  end if;

  -- the named service, or the chair's first that still fits today (QL-18's default)
  select sv.id into v_service from public.services sv
   where sv.barber_id = v_barber and sv.is_active
     and (p_service is null or sv.id = p_service)
     and public.walk_in_start(v_barber, sv.duration_min) is not null
   order by sv.created_at, sv.name
   limit 1;
  if v_service is null then return json_build_object('state', 'gone', 'shop', v_code); end if;

  v_retry := public.guest_join_limit(v_key, v_ip);
  if v_retry is not null then return json_build_object('state', 'limited', 'retry_at', v_retry); end if;

  -- one line at a time: a confirmed web ticket, an app booking, or a walk-in the
  -- barber already added with this number. Says only that, never where.
  if exists (select 1 from public.guest_tickets gt
               join public.bookings b on b.id = gt.booking_id
              where gt.phone_key = v_key and gt.verified_at is not null and gt.left_at is null
                and b.status = 'confirmed' and b.completed_at is null
                and (b.starts_at at time zone shop_tz)::date = v_today)
     or exists (select 1 from public.bookings b
                 where right(coalesce(b.walk_in_phone, ''), 9) = v_key
                   and b.status = 'confirmed' and b.completed_at is null
                   and (b.starts_at at time zone shop_tz)::date = v_today)
     -- ponytail: a scan over profiles per request (0111's note)
     or exists (select 1 from public.profiles p
                  join public.bookings b on b.customer_id = p.id
                 where right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) = v_key
                   and b.customer_id <> b.barber_id
                   and b.status = 'confirmed' and b.completed_at is null
                   and (b.starts_at at time zone shop_tz)::date = v_today) then
    return json_build_object('state', 'already');
  end if;

  -- the same number starting again replaces its own unconfirmed name
  delete from public.bookings b
   using public.guest_tickets gt
   where gt.booking_id = b.id and gt.phone_key = v_key
     and gt.verified_at is null and b.started_at is null
     and (b.starts_at at time zone shop_tz)::date = v_today;

  v_ticket := public.guest_hold(v_salon, v_barber, v_service, v_name, v_phone,
                                case when p_source = 'link' then 'link' else 'code' end, v_ip, false);
  if v_ticket is null then return json_build_object('state', 'gone', 'shop', v_code); end if;

  -- unconfirmed is a standing state now, not a five-minute hold: nothing sweeps it
  update public.guest_tickets
     set hold_until = null,
         confirm_token = v_confirm,
         confirm_until = (v_today + 1)::timestamp at time zone shop_tz
   where id = v_ticket
   returning token, booking_id into t;

  -- Messages Out's qhold, in English like the page that quotes it, and ASCII so
  -- it is one send: "Ticket 07" and "about", not "Nº" and "~"
  insert into public.sms_outbox (kind, to_phone, phone_key, ip_hash, body, booking_id)
  select 'hold', v_phone, v_key, v_ip,
         'Sterncut: Ticket ' || lpad(q.j ->> 'no', 2, '0') || ' at ' || (q.j ->> 'shop')
           || ' with ' || (q.j ->> 'barber') || ', about ' || (q.j ->> 'wait_min') || ' min. '
           || 'Confirm with one tap: ' || v_base || '/c/' || v_confirm,
         t.booking_id
    from (select public.queue_ticket_json(t.booking_id) as j) q;

  return json_build_object('state', 'joined', 'ticket', t.token, 'shop', v_code);
end;
$$;

-- GET /c/:token — the tap. Single use: a second tap reads the ticket it confirmed.
create or replace function public.guest_confirm(p_token text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare t record;
begin
  perform public.guest_sweep();
  select gt.id, gt.token, gt.verified_at, gt.left_at, gt.confirm_until,
         b.status, b.completed_at, sa.short_code as shop
    into t
    from public.guest_tickets gt
    join public.bookings b on b.id = gt.booking_id
    join public.salons sa on sa.id = gt.salon_id
   where gt.confirm_token = btrim(coalesce(p_token, ''))
   for update of gt;
  if not found then return json_build_object('state', 'unknown'); end if;
  if t.verified_at is not null then
    return json_build_object('state', 'confirmed', 'ticket', t.token, 'shop', t.shop, 'again', true);
  end if;
  if t.confirm_until < now() then return json_build_object('state', 'expired', 'shop', t.shop); end if;
  if t.left_at is not null or t.status <> 'confirmed' or t.completed_at is not null then
    return json_build_object('state', 'gone', 'shop', t.shop);
  end if;
  -- 0113's trigger asks "who is next" again from here
  update public.guest_tickets set verified_at = now() where id = t.id;
  return json_build_object('state', 'confirmed', 'ticket', t.token, 'shop', t.shop, 'again', false);
end;
$$;

-- QL-25's "Give up my place". The ticket's address is enough: the code that used
-- to guard it is gone with the rest.
create or replace function public.guest_give_up(p_ticket text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare t record;
begin
  select gt.id, gt.booking_id, gt.left_at, b.status, b.started_at, b.completed_at, sa.short_code as shop
    into t
    from public.guest_tickets gt
    join public.bookings b on b.id = gt.booking_id
    join public.salons sa on sa.id = gt.salon_id
   where gt.token = btrim(coalesce(p_ticket, ''))
   for update of gt;
  if not found then return json_build_object('state', 'gone'); end if;
  if t.left_at is not null then return json_build_object('state', 'left', 'shop', t.shop); end if;
  if t.started_at is not null or t.completed_at is not null then
    return json_build_object('state', 'started', 'shop', t.shop);
  end if;
  if t.status <> 'confirmed' then return json_build_object('state', 'gone', 'shop', t.shop); end if;
  update public.bookings set status = 'cancelled', cancel_reason = 'Left the queue'
   where id = t.booking_id and status = 'confirmed';
  update public.guest_tickets set left_at = now() where id = t.id;
  return json_build_object('state', 'left', 'shop', t.shop);
end;
$$;

-- QL-24 and QL-25 read the same ticket; an unconfirmed one reads too now. For
-- QL-24's "We just texted you", the text — with its link blanked, because this
-- page's own address must never be enough to confirm.
create or replace function public.guest_ticket(p_token text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
  v_text text;
begin
  perform public.guest_sweep();
  select gt.booking_id, gt.verified_at into t
    from public.guest_tickets gt
   where gt.token = btrim(coalesce(p_token, ''));
  if not found then return json_build_object('found', false); end if;
  if t.verified_at is null then
    select regexp_replace(o.body, '/c/[0-9a-f]+', '/c/…') into v_text
      from public.sms_outbox o
     where o.booking_id = t.booking_id and o.kind = 'hold'
     order by o.created_at desc
     limit 1;
  end if;
  return (public.queue_ticket_json(t.booking_id)::jsonb
          || jsonb_build_object('found', true, 'hold_text', v_text))::json;
end;
$$;

-- ---- who is next (0113), past the unconfirmed, and the barber's typed numbers ------
create or replace function public.guest_next_check(p_barber uuid, p_joined uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_today date := (now() at time zone shop_tz)::date;
  v_next uuid;
  t record;
  v_no int;
begin
  if p_barber is null then return; end if;

  -- a web name nobody confirmed may be called past, so it is never "next"
  select b.id into v_next
    from public.bookings b
    left join public.guest_tickets gt on gt.booking_id = b.id
   where b.barber_id = p_barber and b.status = 'confirmed'
     and b.started_at is null and b.completed_at is null
     and (b.starts_at at time zone shop_tz)::date = v_today
     and (gt.id is null or gt.verified_at is not null)
   order by b.starts_at, b.id
   limit 1;
  if v_next is null then return; end if;

  if v_next = p_joined and not exists (
       select 1 from public.bookings b
        where b.barber_id = p_barber and b.status = 'confirmed'
          and b.started_at is not null and b.completed_at is null
          and (b.starts_at at time zone shop_tz)::date = v_today) then
    return;
  end if;

  -- a confirmed web ticket, or a walk-in whose number the barber typed
  select coalesce(gt.phone, b.walk_in_phone) as phone, b.starts_at, sa.name as shop, sa.address,
         split_part(coalesce(nullif(btrim(p.full_name), ''), 'Your barber'), ' ', 1) as barber
    into t
    from public.bookings b
    join public.barbers bb on bb.id = b.barber_id
    join public.salons sa on sa.id = bb.salon_id
    join public.profiles p on p.id = b.barber_id
    left join public.guest_tickets gt
      on gt.booking_id = b.id and gt.verified_at is not null and gt.left_at is null
   where b.id = v_next
     and (gt.id is not null or (b.customer_id = b.barber_id and b.walk_in_phone is not null));
  if not found or t.phone is null then return; end if;

  select count(*)::int into v_no from public.bookings d
   where d.barber_id = p_barber and d.status = 'confirmed'
     and (d.starts_at at time zone shop_tz)::date = v_today
     and (d.starts_at, d.id) <= (t.starts_at, v_next);

  insert into public.sms_outbox (kind, to_phone, phone_key, body, booking_id)
  values ('next', t.phone, right(t.phone, 9),
          'You''re next at ' || t.shop || '. ' || t.barber || ' is finishing up - come to the chair now. '
            || coalesce(nullif(btrim(t.address), '') || '. ', '')
            || 'Ticket ' || lpad(v_no::text, 2, '0') || '.',
          v_next)
  on conflict (booking_id) where kind = 'next' do nothing;
end;
$$;

-- ---- who may call what -------------------------------------------------------
-- Every new function here is the page server's (service_role) or a trigger's.
-- The project's default privileges give anon and authenticated EXECUTE on
-- anything new (0117), so each one is taken back by name.
do $$
declare f text;
begin
  foreach f in array array[
    'guest_join_limit(text, text)',
    'guest_join(text, text, uuid, text, text, text, text, text)',
    'guest_confirm(text)', 'guest_give_up(text)', 'guest_ticket(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke execute on function public.tidy_walk_in_phone() from public, anon, authenticated;

-- ---- checked at apply time ---------------------------------------------------
do $$
declare
  v_body text;
begin
  assert (public.public_queue('not a code') ->> 'found')::boolean is false, 'junk still finds no shop';
  assert (public.guest_confirm('nope') ->> 'state') = 'unknown', 'junk confirms nothing';
  assert (public.guest_give_up('nope') ->> 'state') = 'gone', 'junk gives up nothing';
  assert (public.guest_ticket('nope') ->> 'found')::boolean is false, 'junk opens no ticket';
  assert (public.guest_join('ZZZZZZ', 'ZZZZ', null, '  ', '0661341290', null) ->> 'field') = 'name',
    'a name is needed';
  assert (public.guest_join('ZZZZZZ', 'ZZZZ', null, 'Karim', '12345', null) ->> 'field') = 'phone',
    'a mobile is needed';
  assert (public.guest_join('ZZZZZZ', 'ZZZZ', null, 'Karim', '0661341290', null) ->> 'state') = 'gone',
    'no shop, no name on any line';

  assert to_regprocedure('public.guest_verify(text, text, text)') is null, 'the four digits are gone';
  assert to_regprocedure('public.guest_request(text, text, uuid, text, text, text, text)') is null,
    'and the request that sent them';
  assert not exists (select 1 from pg_trigger where tgname = 'after_salon_closed_tell_guests'),
    'closing the line texts nobody';

  -- the confirm text is one send: 160 GSM-7 characters, all of them ASCII
  v_body := 'Sterncut: Ticket 07 at Le Fade Tanger with Youssef, about 40 min. '
         || 'Confirm with one tap: https://sterncut.ma/c/0123456789ab';
  assert length(v_body) <= 160, 'the confirm text is one send: ' || length(v_body);
  assert v_body ~ '^[ -~]+$', 'and nothing in it is outside the GSM alphabet';

  if exists (select 1 from pg_roles where rolname = 'anon') then
    assert not exists (
      select 1 from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace,
        aclexplode(p.proacl) a
       where ns.nspname = 'public'
         and p.proname in ('guest_join', 'guest_join_limit', 'guest_confirm', 'guest_give_up',
                           'guest_ticket', 'tidy_walk_in_phone')
         and a.privilege_type = 'EXECUTE'
         and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))),
      'nothing added here is callable without the server';
  end if;
end $$;
