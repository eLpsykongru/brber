-- 0119_barber_line: ADDENDUM-app-first, turn B10 (the barber managing the line)
-- and turn T9 (the owner's live lines). Needs 0118 — apply the two together.
--
-- A place in the line has no date and nothing to accept, so this adds no inbox.
-- It adds what the queue genuinely lacked:
--
--   · No invisible timers (A10). 0116's sweep turned a called web guest into a
--     no-show when his eight minutes ran out. The eight minutes stay, but they
--     now end in a question on the barber's screen (BTD-15), not in a row that
--     quietly disappears. The sweep keeps only 0111's pre-confirm hold, which
--     0118 no longer writes.
--   · BTD-15, "CALL THE NEXT MAN": a called man who never sat down drops to the
--     end — `bookings.dropped_at`. His Nº is kept (numbers are counted off
--     starts_at, and moving it would renumber everybody behind him), he is
--     called last, the you're-next text passes him over, and he stops counting
--     as "ahead" of anyone. Minutes are still read off each row's own start, as
--     they always were: nothing in the line re-flows when a chair frees early.
--   · BTD-15 "Take him off" and BTD-17 "Drop him": `queue_take_off`, the no-show
--     the barber's DROP always wrote, allowed as soon as somebody was called or
--     walked in (mark_no_show refuses an estimated start that is still ahead).
--     A web guest dropped this way reads QL-27 when he taps his text.
--   · BTD-14's "Held his own place in the app": `bookings.joined_line`, set by
--     join_queue's own mark (0112). Rows from before 0119 read as bookings.
--   · BTD-16 "Come back tomorrow" is a conversion, not a move. `line_offers`
--     holds the offered time and a tap-to-confirm token; nothing is written to
--     `bookings` until he taps, so the slot stays bookable by anyone else
--     (A3.9). The time is checked against fill_booking, the closed shop and
--     no_double_booking by writing the booking and rolling it back. Today's row
--     leaves the line at once — cancelled with nobody as the canceller, so no
--     barber's or client's cancellation count moves. One text, English and ASCII
--     like the others; it waits in `sms_outbox` as 'queued' like every other.
--     The tap goes through the same /c/:token as QL-24 (`guest_confirm`).
--   · OSH-19: `shop_lines_today`, every chair's line for the owner — a read, not
--     a lever. bookings' own policy shows a barber only his own rows.

-- ---- no invisible timers -------------------------------------------------------
create or replace function public.guest_sweep()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  -- 0111: a place held while a code was untyped, past its five minutes. 0118 writes
  -- no such hold; this only finishes rows from before it.
  with gone as (
    delete from public.bookings b
     using public.guest_tickets gt
     where gt.booking_id = b.id
       and gt.verified_at is null and gt.hold_until < now()
       and b.started_at is null
    returning b.id
  )
  select count(*)::int into n from gone;
  -- a called chair nobody sat in is BTD-15's question now, asked of the barber
  return n;
end;
$$;

-- ---- the columns ---------------------------------------------------------------
alter table public.bookings add column if not exists dropped_at timestamptz;             -- BTD-15
alter table public.bookings add column if not exists joined_line boolean not null default false;  -- BTD-14

alter table public.sms_outbox drop constraint if exists sms_outbox_kind_check;
alter table public.sms_outbox add constraint sms_outbox_kind_check
  check (kind in ('code', 'next', 'closed', 'hold', 'offer'));

-- 0112's mark, now also remembered on the row
create or replace function public.confirm_queue_join()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if current_setting('sterncut.queue_join', true) is distinct from
     new.customer_id::text || ':' || new.barber_id::text then
    return new;
  end if;
  -- one row per mark: nothing else inserted in the same transaction rides on it
  perform set_config('sterncut.queue_join', '', true);
  new.status := 'confirmed';
  new.deposit_cents := 0;
  new.joined_line := true;
  return new;
end;
$$;

-- ---- BTD-15 · called, held eight minutes, he isn't there -------------------------
create or replace function public.queue_drop_to_end(p_booking uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  b record;
begin
  select bk.barber_id, bk.status, bk.checked_in_at, bk.started_at, bk.completed_at into b
    from public.bookings bk where bk.id = p_booking
   for update;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() is distinct from b.barber_id then raise exception 'Not your booking'; end if;
  if b.status <> 'confirmed' or b.completed_at is not null then raise exception 'Booking is not active'; end if;
  if b.started_at is not null then raise exception 'He is already in the chair'; end if;
  if b.checked_in_at is null then raise exception 'Call him first'; end if;
  -- no longer called: calling him again from the end starts a new eight minutes
  update public.bookings set dropped_at = now(), checked_in_at = null where id = p_booking;
end;
$$;

-- BTD-15 "Take him off", BTD-17 "Drop him". A walk-in, a web guest, or anybody
-- already called; an app client whose time has not come and who was never called
-- is a cancellation, not a no-show, and keeps mark_no_show's refusal.
create or replace function public.queue_take_off(p_booking uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  b record;
begin
  select bk.barber_id, bk.customer_id, bk.status, bk.starts_at, bk.checked_in_at, bk.dropped_at,
         bk.started_at, bk.completed_at into b
    from public.bookings bk where bk.id = p_booking
   for update;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() is distinct from b.barber_id then raise exception 'Not your booking'; end if;
  if b.status <> 'confirmed' or b.completed_at is not null then raise exception 'Booking is not active'; end if;
  if b.started_at is not null then raise exception 'He is already in the chair'; end if;
  if b.customer_id <> b.barber_id and b.checked_in_at is null and b.dropped_at is null
     and b.starts_at > now() then
    raise exception 'Booking has not started yet';
  end if;
  update public.bookings set status = 'no_show' where id = p_booking;
end;
$$;

-- ---- who is next, past the dropped as well as the unconfirmed ---------------------
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

  -- a web name nobody confirmed may be called past, so it is never "next"; a man
  -- dropped to the end is next only when nobody else is left
  select b.id into v_next
    from public.bookings b
    left join public.guest_tickets gt on gt.booking_id = b.id
   where b.barber_id = p_barber and b.status = 'confirmed'
     and b.started_at is null and b.completed_at is null
     and (b.starts_at at time zone shop_tz)::date = v_today
     and (gt.id is null or gt.verified_at is not null)
   order by b.dropped_at is not null, b.dropped_at, b.starts_at, b.id
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

-- 0113's trigger, also asking again when somebody drops to the end
create or replace function public.guest_next_on_booking()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.guest_next_check(old.barber_id);
    return old;
  end if;
  if new.started_at is distinct from old.started_at
     or new.completed_at is distinct from old.completed_at
     or new.status is distinct from old.status
     or new.starts_at is distinct from old.starts_at
     or new.dropped_at is distinct from old.dropped_at then
    perform public.guest_next_check(new.barber_id);
  end if;
  return new;
end;
$$;

-- ---- the page's read: a dropped man is at the end, with no minutes ----------------
-- 0118's public_queue; only `day` and `line` change.
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
    select bk.barber_id, bk.starts_at, bk.started_at, bk.completed_at, bk.dropped_at,
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
           -- QL-18's THE LINE: numbers and minutes, and nothing about anyone. A man
           -- dropped to the end (BTD-15) is listed last and quotes no minutes.
           (select coalesce(json_agg(json_build_object(
                     'no', d.no,
                     'in_chair', d.started_at is not null,
                     'dropped', d.started_at is null and d.dropped_at is not null,
                     'wait_min', case when d.started_at is null and d.dropped_at is null
                                      then greatest(0, ceil(extract(epoch from (d.starts_at - now())) / 60))::int
                                 end)
                   order by d.started_at is null, d.dropped_at is not null, d.dropped_at, d.starts_at, d.no), '[]'::json)
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

-- ---- the ticket: a dropped man is nobody's "ahead" --------------------------------
-- 0116's queue_ticket_json; only `t`, `day` and 'ahead' change.
create or replace function public.queue_ticket_json(p_booking uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  with t as (
    select b.id, b.barber_id, b.starts_at, b.started_at, b.completed_at, b.status, b.price_cents,
           b.service_id, b.created_at as booked_at, b.checked_in_at, b.dropped_at,
           gt.token, gt.first_name, gt.phone, gt.created_at as joined_at, gt.hold_until,
           gt.verified_at, gt.left_at, gt.missed_at, gt.rejoined_as, gt.coming_at, gt.extended_at,
           sa.id as salon_id, sa.short_code as shop_code, sa.name as shop_name, sa.address, sa.closed_at,
           bb.short_code as barber_code, bb.accepting_bookings, bb.paused_at,
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
    select d.id, d.starts_at, d.started_at, d.completed_at, d.created_at, d.dropped_at,
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
    -- counted from the rows before it, so a ticket that left the day keeps its number
    'no', (select count(*) from day where (day.starts_at, day.id) < (t.starts_at, t.id))::int + 1,
    -- BTD-15: nobody dropped to the end is ahead of anyone still in their place;
    -- a dropped man has everybody ahead who is not behind him at the end
    'ahead', (select count(*) from day
               where day.completed_at is null and day.id <> t.id
                 and case when t.dropped_at is null
                          then day.dropped_at is null and day.starts_at < t.starts_at
                          else day.dropped_at is null or day.dropped_at < t.dropped_at
                     end)::int,
    'behind', (select count(*) from day
                where (day.starts_at, day.id) > (t.starts_at, t.id) and day.completed_at is null)::int,
    'wait_min', greatest(0, ceil(extract(epoch from (t.starts_at - now())) / 60))::int,
    'in_chair', (select json_build_object(
                          'label', c.label,
                          'no', (select count(*) from day d2 where (d2.starts_at, d2.id) <= (c.starts_at, c.id)))
                   from day c
                  where c.started_at is not null and c.completed_at is null and c.id <> t.id
                  order by c.started_at desc limit 1),
    'paused', not t.accepting_bookings or not public.salon_open(t.salon_id),
    'paused_at', case when not t.accepting_bookings then t.paused_at
                      when not public.salon_open(t.salon_id) then t.closed_at end,
    'called_at', t.checked_in_at,
    'called_until', case when t.token is not null
                         then public.guest_called_until(t.checked_in_at, t.extended_at) end,
    'coming', t.coming_at is not null,
    'extended', t.extended_at is not null,
    'texted', exists (select 1 from public.sms_outbox o where o.booking_id = t.id and o.kind = 'next'),
    'missed_at', t.missed_at,
    'since_call', (select count(*) from day
                    where t.checked_in_at is not null and day.created_at > t.checked_in_at and day.id <> t.id)::int,
    'rejoined', (select r.token from public.guest_tickets r where r.id = t.rejoined_as),
    'stage', case
               when t.status = 'cancelled' and t.left_at is not null then 'left'
               when t.status = 'no_show' and t.token is not null then 'missed'
               when t.status <> 'confirmed' then 'cancelled'
               when t.completed_at is not null then 'done'
               when t.started_at is not null then 'in_chair'
               when t.token is not null and t.verified_at is null then 'held'
               when t.token is not null and t.checked_in_at is not null
                    and public.guest_called_until(t.checked_in_at, t.extended_at) > now() then 'called'
               else 'waiting'
             end)
  from t;
$$;

-- ---- BTD-16 · out of the line, into the book ----------------------------------------
create table if not exists public.line_offers (
  id uuid primary key default gen_random_uuid(),
  from_booking uuid not null references public.bookings (id) on delete cascade,
  barber_id uuid not null references public.barbers (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  service_id uuid not null references public.services (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  first_name text,
  phone text not null,
  token text not null unique,          -- only ever in the text
  confirm_until timestamptz not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  booking_id uuid references public.bookings (id) on delete set null
);
-- one offer per place in the line: the place leaves the line when it is offered
create unique index if not exists line_offers_once on public.line_offers (from_booking);
create index if not exists line_offers_barber_idx on public.line_offers (barber_id, starts_at);
alter table public.line_offers enable row level security;
drop policy if exists line_offers_barber on public.line_offers;
-- BDY-01 shows his own provisional offers; every write goes through the functions below
create policy line_offers_barber on public.line_offers for select to authenticated
  using (barber_id = auth.uid());

create or replace function public.queue_offer_day(p_booking uuid, p_starts timestamptz)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_today date := (now() at time zone shop_tz)::date;
  b record;
  v_ticket uuid;
  v_phone text;
  v_name text;
  v_minutes int;
  v_token text := public.guest_token();
  v_day text;
  v_body text;
begin
  select bk.id, bk.barber_id, bk.customer_id, bk.service_id, bk.status, bk.starts_at,
         bk.started_at, bk.completed_at, bk.walk_in_name, bk.walk_in_phone,
         sa.id as salon_id, sa.name as shop,
         split_part(coalesce(nullif(btrim(p.full_name), ''), 'Your barber'), ' ', 1) as barber
    into b
    from public.bookings bk
    join public.barbers bb on bb.id = bk.barber_id
    join public.salons sa on sa.id = bb.salon_id
    join public.profiles p on p.id = bk.barber_id
   where bk.id = p_booking
   for update of bk;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() is distinct from b.barber_id then raise exception 'Not your booking'; end if;
  if b.status <> 'confirmed' or b.started_at is not null or b.completed_at is not null
     or (b.starts_at at time zone shop_tz)::date <> v_today then
    raise exception 'He is not waiting in today''s line';
  end if;
  if b.customer_id <> b.barber_id then
    raise exception 'A client with the app moves his own booking';
  end if;

  select gt.id, gt.phone, gt.first_name into v_ticket, v_phone, v_name
    from public.guest_tickets gt
   where gt.booking_id = b.id and gt.left_at is null;
  v_phone := coalesce(v_phone, b.walk_in_phone);
  v_name := coalesce(nullif(btrim(v_name), ''), nullif(btrim(b.walk_in_name), ''));
  if v_phone is null then raise exception 'There is no number to text him on'; end if;

  if p_starts is null or (p_starts at time zone shop_tz)::date <= v_today then
    raise exception 'Pick a time on another day';
  end if;

  -- The time has to be one his book really takes. fill_booking (hours, days off,
  -- breaks, cleaning time), the closed shop and no_double_booking decide, on a
  -- booking written here and rolled straight back — so the check can never drift
  -- from the insert the tap will make.
  begin
    insert into public.bookings (customer_id, barber_id, service_id, starts_at, walk_in_name, deposit_cents)
    values (b.barber_id, b.barber_id, b.service_id, p_starts, v_name, 0);
    raise exception using errcode = 'SC119', message = 'fits';
  exception
    when sqlstate 'SC119' then null;
    when exclusion_violation then raise exception 'Somebody already has that time';
  end;

  select sv.duration_min into v_minutes from public.services sv where sv.id = b.service_id;

  insert into public.line_offers
    (from_booking, barber_id, salon_id, service_id, starts_at, ends_at, first_name, phone, token, confirm_until)
  values (b.id, b.barber_id, b.salon_id, b.service_id, p_starts,
          p_starts + make_interval(mins => v_minutes), v_name, v_phone, v_token, p_starts);

  -- Out of today's line. Nobody cancelled anything, so nobody is the canceller:
  -- neither the barber's cancellations (0066) nor a client's move.
  update public.bookings set status = 'cancelled', cancel_reason = 'Given another day'
   where id = b.id;

  -- Messages Out's shape for the barber's offer, in English and ASCII like the
  -- other queue texts, so it is one send
  v_day := case when (p_starts at time zone shop_tz)::date = v_today + 1 then 'tomorrow'
                else to_char(p_starts at time zone shop_tz, 'Dy DD Mon') end
        || ' ' || to_char(p_starts at time zone shop_tz, 'HH24:MI');
  v_body := 'Sterncut: ' || b.barber || ' offers you ' || v_day || ' at ' || b.shop
         || '. Confirm with one tap: https://sterncut.ma/c/' || v_token;
  insert into public.sms_outbox (kind, to_phone, phone_key, body, booking_id)
  values ('offer', v_phone, right(v_phone, 9), v_body, b.id);

  return json_build_object('state', 'offered', 'starts_at', p_starts, 'text', v_body);
end;
$$;

-- The tap on an offer. Writing the booking IS the confirmation: if somebody booked
-- that time first, or the shop closed it, there is nothing to confirm (QL-27's
-- cousin — the page says so and shows the line).
create or replace function public.offer_confirm(p_token text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  o record;
  v_booking uuid;
  v_status text;
begin
  select lo.id, lo.barber_id, lo.service_id, lo.starts_at, lo.first_name, lo.phone,
         lo.confirm_until, lo.confirmed_at, lo.booking_id,
         sa.short_code as shop_code, sa.name as shop, sa.address,
         split_part(coalesce(nullif(btrim(p.full_name), ''), 'Your barber'), ' ', 1) as barber,
         sv.name as service, sv.price_cents
    into o
    from public.line_offers lo
    join public.salons sa on sa.id = lo.salon_id
    join public.profiles p on p.id = lo.barber_id
    join public.services sv on sv.id = lo.service_id
   where lo.token = btrim(coalesce(p_token, ''))
   for update of lo;
  if not found then return json_build_object('state', 'unknown'); end if;

  if o.confirmed_at is not null then
    select b.status into v_status from public.bookings b where b.id = o.booking_id;
    if v_status is distinct from 'confirmed' then
      return json_build_object('state', 'gone', 'kind', 'offer', 'shop', o.shop_code,
                             'barber', o.barber, 'starts_at', o.starts_at);
    end if;
  else
    if o.confirm_until < now() then
      return json_build_object('state', 'expired', 'kind', 'offer', 'shop', o.shop_code,
                               'barber', o.barber, 'starts_at', o.starts_at);
    end if;
    begin
      insert into public.bookings
        (customer_id, barber_id, service_id, starts_at, walk_in_name, walk_in_phone, deposit_cents)
      values (o.barber_id, o.barber_id, o.service_id, o.starts_at, o.first_name, o.phone, 0)
      returning id into v_booking;
    exception
      when exclusion_violation or raise_exception then
        return json_build_object('state', 'taken', 'kind', 'offer', 'shop', o.shop_code,
                                 'barber', o.barber, 'starts_at', o.starts_at);
    end;
    update public.line_offers set confirmed_at = now(), booking_id = v_booking where id = o.id;
  end if;

  return json_build_object(
    'state', 'booked', 'kind', 'offer', 'again', o.confirmed_at is not null,
    'shop', o.shop_code, 'shop_name', o.shop, 'address', o.address,
    'barber', o.barber, 'service', o.service, 'price_cents', o.price_cents,
    'first_name', o.first_name, 'starts_at', o.starts_at);
end;
$$;

-- 0118's GET /c/:token, now also the offer's tap. A guest ticket's token is looked
-- for first; anything else is an offer or nothing.
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
  if not found then return public.offer_confirm(p_token); end if;
  if t.verified_at is not null then
    return json_build_object('state', 'confirmed', 'ticket', t.token, 'shop', t.shop, 'again', true);
  end if;
  -- QL-27 reads the ticket to say whose line it was and what became of it
  if t.confirm_until < now() then
    return json_build_object('state', 'expired', 'ticket', t.token, 'shop', t.shop);
  end if;
  if t.left_at is not null or t.status <> 'confirmed' or t.completed_at is not null then
    return json_build_object('state', 'gone', 'ticket', t.token, 'shop', t.shop);
  end if;
  -- 0113's trigger asks "who is next" again from here
  update public.guest_tickets set verified_at = now() where id = t.id;
  return json_build_object('state', 'confirmed', 'ticket', t.token, 'shop', t.shop, 'again', false);
end;
$$;

-- ---- OSH-19 · all chairs, the live lines ------------------------------------------
-- A diagnosis, not a control panel: every chair's line, read for the shop's owner.
-- Waiting excludes whoever is in the chair, the same count as each barber's board.
create or replace function public.shop_lines_today()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_today date := (now() at time zone shop_tz)::date;
  v_dow int := extract(dow from (now() at time zone shop_tz))::int;
  v_salon uuid;
  v_out json;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the shop''s owner sees every chair'; end if;

  with team as (
    select b.id, b.accepting_bookings, b.paused_at,
           coalesce(nullif(btrim(p.full_name), ''), 'Barber') as full_name,
           (exists (select 1 from public.time_blocks tb
                     where tb.barber_id = b.id and tb.kind = 'open' and tb.day = v_today)
            or (not exists (select 1 from public.days_off d where d.barber_id = b.id and d.day = v_today)
                and exists (select 1 from public.availability a
                             where a.barber_id = b.id and a.weekday = v_dow))) as working
      from public.barbers b
      join public.profiles p on p.id = b.id
     where b.salon_id = v_salon and b.status = 'approved' and b.salon_status = 'approved'
  ),
  day as (
    select bk.id, bk.barber_id, bk.starts_at, bk.started_at, bk.completed_at,
           bk.checked_in_at, bk.dropped_at,
           row_number() over (partition by bk.barber_id order by bk.starts_at, bk.id)::int as no,
           case when bk.walk_in_name is not null then bk.walk_in_name
                when bk.customer_id = bk.barber_id then 'Walk-in'
                else split_part(coalesce(nullif(btrim(cp.full_name), ''), 'Client'), ' ', 1)
           end as label,
           (gt.id is not null and gt.verified_at is null) as unconfirmed
      from public.bookings bk
      join team t on t.id = bk.barber_id
      left join public.profiles cp on cp.id = bk.customer_id
      left join public.guest_tickets gt on gt.booking_id = bk.id and gt.left_at is null
     where bk.status = 'confirmed'
       and (bk.starts_at at time zone shop_tz)::date = v_today
  )
  select coalesce(json_agg(json_build_object(
           'barber_id', t.id,
           'name', t.full_name,
           'me', t.id = auth.uid(),
           'working', t.working,
           'paused', not t.accepting_bookings,
           'paused_at', case when not t.accepting_bookings then t.paused_at end,
           'in_chair', (select d.label from day d
                         where d.barber_id = t.id and d.started_at is not null and d.completed_at is null
                         order by d.started_at desc limit 1),
           'waiting', (select count(*) from day d
                        where d.barber_id = t.id and d.started_at is null and d.completed_at is null)::int,
           'unconfirmed', (select count(*) from day d
                            where d.barber_id = t.id and d.started_at is null and d.completed_at is null
                              and d.unconfirmed)::int,
           -- the wait of the last man still in his place: "longest wait"
           'wait_min', (select greatest(0, ceil(extract(epoch from (max(d.starts_at) - now())) / 60))::int
                          from day d
                         where d.barber_id = t.id and d.started_at is null and d.completed_at is null
                           and d.dropped_at is null),
           'line', (select coalesce(json_agg(json_build_object(
                             'no', d.no, 'label', d.label,
                             'in_chair', d.started_at is not null,
                             'called', d.started_at is null and d.checked_in_at is not null,
                             'dropped', d.started_at is null and d.dropped_at is not null,
                             'unconfirmed', d.unconfirmed,
                             'wait_min', case when d.started_at is null and d.dropped_at is null
                                              then greatest(0, ceil(extract(epoch from (d.starts_at - now())) / 60))::int
                                         end)
                           order by d.started_at is null, d.dropped_at is not null, d.dropped_at, d.starts_at, d.no), '[]'::json)
                      from day d where d.barber_id = t.id and d.completed_at is null))
         order by t.full_name), '[]'::json)
    into v_out
    from team t;
  return v_out;
end;
$$;

-- ---- who may call what -------------------------------------------------------
-- The project's default privileges give anon EXECUTE on anything new (0117), so
-- each grant below is paired with its revoke.
do $$
declare f text;
begin
  foreach f in array array[
    'queue_drop_to_end(uuid)', 'queue_take_off(uuid)',
    'queue_offer_day(uuid, timestamptz)', 'shop_lines_today()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['offer_confirm(text)', 'guest_confirm(text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on public.line_offers from anon;

-- ---- checked at apply time ---------------------------------------------------
do $$
declare
  v_body text;
begin
  assert public.guest_sweep() >= 0, 'the sweep still runs';
  assert (public.guest_confirm('nope') ->> 'state') = 'unknown', 'junk confirms nothing';
  assert (public.offer_confirm('nope') ->> 'state') = 'unknown', 'junk books nothing';
  assert (public.public_queue('not a code') ->> 'found')::boolean is false, 'junk still finds no shop';

  begin
    perform public.queue_drop_to_end('00000000-0000-0000-0000-000000000000');
    raise exception 'dropped a booking that does not exist';
  exception when raise_exception then
    assert sqlerrm = 'Booking not found', 'nothing to drop: ' || sqlerrm;
  end;
  begin
    perform public.queue_offer_day('00000000-0000-0000-0000-000000000000', now() + interval '1 day');
    raise exception 'offered a booking that does not exist';
  exception when raise_exception then
    assert sqlerrm = 'Booking not found', 'nothing to offer: ' || sqlerrm;
  end;
  begin
    perform public.shop_lines_today();
    raise exception 'read every chair with nobody signed in';
  exception when raise_exception then
    assert sqlerrm like 'Only the shop%', 'nobody signed in, no chairs: ' || sqlerrm;
  end;

  -- the offer text is one send: 160 GSM-7 characters, all of them ASCII
  v_body := 'Sterncut: Youssef offers you Sat 19 Sep 10:00 at Le Fade Tanger. '
         || 'Confirm with one tap: https://sterncut.ma/c/0123456789ab';
  assert length(v_body) <= 160, 'the offer text is one send: ' || length(v_body);
  assert v_body ~ '^[ -~]+$', 'and nothing in it is outside the GSM alphabet';

  if exists (select 1 from pg_roles where rolname = 'anon') then
    assert not exists (
      select 1 from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace,
        aclexplode(p.proacl) a
       where ns.nspname = 'public'
         and p.proname in ('queue_drop_to_end', 'queue_take_off', 'queue_offer_day',
                           'shop_lines_today', 'offer_confirm', 'guest_confirm')
         and a.privilege_type = 'EXECUTE'
         and (a.grantee = 0 or a.grantee = 'anon'::regrole)),
      'nothing added here is callable without signing in';
  end if;
end $$;
