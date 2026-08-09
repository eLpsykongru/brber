-- 0052_make_room: barber turn 8j/8k/8l — a slot where there wasn't one.
--
-- 8j names the thing every offer screen quietly assumed: **an offer anchors to a
-- real gap in the day.** On a full day there is no gap, so `create_slot_offer`
-- (which needs a cancelled booking) has nothing to hang on. 8k makes the gap and
-- 8l offers it.
--
-- One concept carries all three of 8k's sources. A `time_blocks` row with
-- kind = 'open' is a block turned inside out: instead of taking time away it
-- gives time back, on one date, outranking the weekly hours, the breaks and the
-- buffers — the barber weighed all three when he chose to make room. The one
-- thing it never outranks is a booking: room he made can still only be taken
-- once. `src/lib/slots.ts` reads the same rows the same way, so the phone and
-- the trigger agree on what is bookable.

alter table public.time_blocks
  add column if not exists kind text not null default 'block'
    check (kind in ('block', 'open'));

-- "This Saturday only · your usual hours don't change" (8k) — an opening is
-- always one date. A recurring opening is just working hours, and those already
-- have a table.
alter table public.time_blocks drop constraint if exists time_blocks_open_needs_day;
alter table public.time_blocks add constraint time_blocks_open_needs_day
  check (kind = 'block' or day is not null);

create index if not exists time_blocks_open_idx
  on public.time_blocks (barber_id, day) where kind = 'open';

-- 0016 already grants insert/delete on this table, which is the whole API an
-- opening needs: making room is an insert, taking it back is a delete.

-- ---- the trigger, taught that an opening outranks the timetable -------------
create or replace function public.fill_booking()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca'; -- ponytail: single-city; per-barber tz when multi-city
  min_pct int := 40;                            -- 8b's hard floor, drawn as a locked track
  svc record;
  bun record;
  v_price_cents int;
  v_duration_min int;
  v_today int;
  local_start timestamp;
  slot_start_min int;
  opened boolean;
  gap int;
  wanted int;
  floor_cents int;
  balance int;
  late record;
begin
  if new.bundle_id is not null then
    select b.price_cents, b.barber_id, b.is_active, b.max_per_day, b.morning_only, b.name
      into bun
      from public.bundles b where b.id = new.bundle_id;
    if not found then raise exception 'Bundle unavailable'; end if;
    if bun.barber_id <> new.barber_id then raise exception 'Bundle does not belong to this barber'; end if;
    if not bun.is_active then raise exception 'Bundle unavailable'; end if;

    select sum(s.duration_min)::int into v_duration_min
      from public.bundle_services bs join public.services s on s.id = bs.service_id
     where bs.bundle_id = new.bundle_id and s.is_active;
    if coalesce(v_duration_min, 0) <= 0 then raise exception 'Bundle has no services'; end if;

    select bs.service_id into new.service_id
      from public.bundle_services bs join public.services s on s.id = bs.service_id
     where bs.bundle_id = new.bundle_id and s.is_active
     order by bs.sort, s.name limit 1;

    v_price_cents := bun.price_cents;

    -- 7c's brakes. The barber's own walk-ins are exempt: he is looking at the
    -- day when he books them, and a cap he can't override is a cap he'll turn off.
    if new.customer_id <> new.barber_id then
      if bun.morning_only
         and extract(hour from (new.starts_at at time zone shop_tz))::int >= public.bundle_morning_cutoff() then
        raise exception '% is mornings only — pick a slot before %:00',
          bun.name, public.bundle_morning_cutoff();
      end if;
      if bun.max_per_day is not null then
        select count(*)::int into v_today
          from public.bookings b
         where b.bundle_id = new.bundle_id
           and b.status in ('pending', 'confirmed')
           and (b.starts_at at time zone shop_tz)::date = (new.starts_at at time zone shop_tz)::date;
        if v_today >= bun.max_per_day then
          raise exception '% is fully booked that day', bun.name;
        end if;
      end if;
    end if;
  else
    select s.price_cents, s.duration_min, s.barber_id
      into svc
      from public.services s
      where s.id = new.service_id and s.is_active;
    if not found then raise exception 'Service unavailable'; end if;
    if svc.barber_id <> new.barber_id then raise exception 'Service does not belong to this barber'; end if;
    v_price_cents := svc.price_cents;
    v_duration_min := svc.duration_min;
  end if;

  if not exists (select 1 from public.barbers b where b.id = new.barber_id and b.status = 'approved') then
    raise exception 'Barber not available';
  end if;
  if new.starts_at <= now() then raise exception 'Booking must be in the future'; end if;
  if new.customer_id <> new.barber_id
     and not (select accepting_bookings from public.barbers where id = new.barber_id) then
    raise exception 'Barber is not accepting bookings right now';
  end if;
  if new.customer_id <> new.barber_id and exists (
    select 1 from public.client_flags f
    where f.barber_id = new.barber_id and f.customer_id = new.customer_id and f.blocked
  ) then
    raise exception 'This barber is not taking bookings from you';
  end if;

  -- server-side snapshots: ignore whatever the client sent for these
  new.price_cents := v_price_cents;
  new.duration_min := v_duration_min;
  new.status := case when new.customer_id = new.barber_id then 'confirmed' else 'pending' end;
  new.ends_at := new.starts_at + make_interval(mins => v_duration_min);
  new.mode := 'shop';

  min_pct := public.customer_deposit_pct(new.customer_id);
  wanted := coalesce(new.deposit_cents, 0);
  if new.customer_id = new.barber_id or wanted <= 0 then
    new.deposit_cents := 0;
  else
    floor_cents := ceil(v_price_cents * min_pct / 100.0);
    if wanted < floor_cents then
      if min_pct > 40 then
        select m.created_at, m.minutes into late
          from public.customer_marks m
         where m.customer_id = new.customer_id and m.cleared_at is null
           and m.created_at > now() - interval '90 days'
         order by m.created_at desc limit 1;
        raise exception 'You arrived % min late on %, so this one needs paying in full until %',
          late.minutes, to_char(late.created_at, 'Mon DD'),
          to_char(late.created_at + interval '90 days', 'Mon DD');
      end if;
      raise exception 'A deposit must be at least % percent of the price', min_pct;
    end if;
    if wanted > v_price_cents then raise exception 'A deposit cannot exceed the price'; end if;
    select coalesce(sum(amount_cents), 0)::int into balance
      from public.wallet_transactions where user_id = new.customer_id;
    if wanted > balance then raise exception 'Not enough in your wallet'; end if;
    new.deposit_cents := wanted;
  end if;

  local_start := new.starts_at at time zone shop_tz;
  slot_start_min := extract(hour from local_start)::int * 60 + extract(minute from local_start)::int;

  -- 8k — room he made by hand, covering this whole sitting. It answers the next
  -- three checks at once, which is the point: the day off, the closing time and
  -- the break are exactly what he decided to override.
  opened := exists (select 1 from public.time_blocks tb
                    where tb.barber_id = new.barber_id and tb.kind = 'open'
                      and tb.day = local_start::date
                      and tb.start_min <= slot_start_min
                      and tb.end_min >= slot_start_min + v_duration_min);

  if not opened and exists (select 1 from public.days_off d
             where d.barber_id = new.barber_id and d.day = local_start::date) then
    raise exception 'Barber is off that day';
  end if;
  if not opened and not exists (select 1 from public.availability a
                 where a.barber_id = new.barber_id
                   and a.weekday = extract(dow from local_start)::int
                   and a.start_min <= slot_start_min
                   and a.end_min >= slot_start_min + v_duration_min) then
    raise exception 'Outside working hours';
  end if;
  if not opened and new.customer_id <> new.barber_id
     and exists (select 1 from public.time_blocks tb
                 where tb.barber_id = new.barber_id and tb.kind = 'block'
                   and (tb.day is null or tb.day = local_start::date)
                   and tb.start_min < slot_start_min + v_duration_min
                   and tb.end_min > slot_start_min) then
    raise exception 'Barber is unavailable at that time';
  end if;

  -- the cleaning time is 8k's third source, so an opening waives it too
  if not opened and new.customer_id <> new.barber_id then
    select buffer_before_min + buffer_after_min into gap
      from public.barbers where id = new.barber_id;
    if gap > 0 and exists (
      select 1 from public.bookings b
      where b.barber_id = new.barber_id
        and b.status in ('pending', 'confirmed')
        and new.starts_at < b.ends_at + make_interval(mins => gap)
        and new.ends_at + make_interval(mins => gap) > b.starts_at
    ) then
      raise exception 'Too close to another booking';
    end if;
  end if;

  return new;
end;
$$;

-- ---- 8h/8l · offer a slot with no cancellation behind it --------------------
-- `create_slot_offer` reads the service, the time and the barber off a cancelled
-- booking, which is the only kind of gap turn 8 had until now. Two of the gaps
-- in 8h and 8l have no booking behind them: an ordinary free time on a day that
-- is otherwise full, and room the barber just made. This offers either.
--
-- The checks below are `fill_booking`'s, minus the money — an offer that cannot
-- be claimed is worse than no offer, so the two must agree. Nothing is held:
-- `from_booking` stays null and the claim goes through the ordinary insert.
create or replace function public.create_open_offer(
  p_starts_at timestamptz, p_customers uuid[],
  p_public boolean default false, p_minutes int default 30)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_day date;
  v_min int;
  v_room record;
  v_opened boolean;
  v_svc record;
  v_gap int;
  v_offer uuid;
  v_who uuid;
  v_when text;
begin
  if p_starts_at <= now() then raise exception 'That slot has already passed'; end if;
  v_day := (p_starts_at at time zone 'Africa/Casablanca')::date;
  v_min := extract(hour from (p_starts_at at time zone 'Africa/Casablanca'))::int * 60
         + extract(minute from (p_starts_at at time zone 'Africa/Casablanca'))::int;

  select tb.start_min, tb.end_min into v_room
    from public.time_blocks tb
   where tb.barber_id = v_me and tb.kind = 'open' and tb.day = v_day
     and tb.start_min <= v_min and tb.end_min > v_min
   limit 1;
  v_opened := found;

  -- the same rule the phone used to size the room: the shortest thing he sells
  -- that fits. Offering a service the gap cannot hold is offering nothing.
  select s.id, s.price_cents, s.duration_min into v_svc
    from public.services s
   where s.barber_id = v_me and s.is_active
     and (not v_opened or s.duration_min <= v_room.end_min - v_min)
   order by s.duration_min, s.price_cents limit 1;
  if not found then raise exception 'Nothing you offer fits that gap'; end if;

  -- an opening answers the timetable outright; without one, the ordinary rules
  -- decide, exactly as they will when somebody claims it
  if not v_opened then
    if exists (select 1 from public.days_off d where d.barber_id = v_me and d.day = v_day) then
      raise exception 'You are off that day';
    end if;
    if not exists (select 1 from public.availability a
                   where a.barber_id = v_me and a.weekday = extract(dow from v_day)::int
                     and a.start_min <= v_min and a.end_min >= v_min + v_svc.duration_min) then
      raise exception 'That is outside your working hours';
    end if;
    if exists (select 1 from public.time_blocks tb
               where tb.barber_id = v_me and tb.kind = 'block'
                 and (tb.day is null or tb.day = v_day)
                 and tb.start_min < v_min + v_svc.duration_min and tb.end_min > v_min) then
      raise exception 'You have a break then';
    end if;
    select buffer_before_min + buffer_after_min into v_gap from public.barbers where id = v_me;
  else
    v_gap := 0;   -- he already decided the cleaning time was worth giving up
  end if;

  if exists (select 1 from public.bookings b
              where b.barber_id = v_me and b.status in ('pending', 'confirmed')
                and b.starts_at < p_starts_at
                      + make_interval(mins => v_svc.duration_min + coalesce(v_gap, 0))
                and b.ends_at + make_interval(mins => coalesce(v_gap, 0)) > p_starts_at) then
    raise exception 'Something is already booked then';
  end if;

  insert into public.slot_offers (barber_id, service_id, starts_at, from_booking, public_too, expires_at)
  values (v_me, v_svc.id, p_starts_at, null, coalesce(p_public, false),
          least(now() + make_interval(mins => greatest(p_minutes, 5)), p_starts_at))
  returning id into v_offer;

  v_when := to_char(p_starts_at at time zone 'Africa/Casablanca', 'Dy HH24:MI');

  foreach v_who in array coalesce(p_customers, '{}'::uuid[]) loop
    insert into public.slot_offer_targets (offer_id, customer_id) values (v_offer, v_who)
    on conflict do nothing;
    insert into public.notifications (user_id, kind, title, body)
    values (v_who, 'booking_answer', 'A slot opened ' || v_when,
            'First to take it gets it — nothing is held until you tap take.');
  end loop;

  return v_offer;
end;
$$;
grant execute on function public.create_open_offer(timestamptz, uuid[], boolean, int) to authenticated;

-- ---- 8l · why each person is on the list, on a day that isn't today ---------
-- 0050's wording ("Asked about this day at 08:50") only reads right for today.
-- 8l offers a Saturday, and there the useful fact is what they said they'd take.
create or replace function public.offer_candidates(p_barber uuid, p_starts_at timestamptz)
returns json
language sql stable security definer set search_path = ''
as $$
  with tz as (select 'Africa/Casablanca'::text as z),
  slot as (
    select (p_starts_at at time zone (select z from tz))::date as d,
           extract(hour from (p_starts_at at time zone (select z from tz)))::int * 60
             + extract(minute from (p_starts_at at time zone (select z from tz)))::int as min
  ),
  shop as (select salon_id from public.barbers where id = p_barber),
  asks as (
    select w.customer_id, w.created_at, w.earliest_min
      from public.waitlist_requests w
     where w.status = 'waiting' and w.day = (select d from slot)
       and (w.barber_id = p_barber
            or (w.barber_id is null and w.salon_id = (select salon_id from shop)))
       and (w.earliest_min is null or w.earliest_min <= (select min from slot))
  ),
  people as (
    select distinct b.customer_id as id from public.bookings b
     where b.barber_id = p_barber and b.customer_id <> p_barber
       and b.starts_at > now() - interval '180 days'
    union
    select a.customer_id from asks a
  )
  select coalesce(json_agg(x order by x.rank, x.name), '[]'::json) from (
    select
      p.id,
      coalesce(pr.full_name, 'Client') as name,
      case
        when a.created_at is not null then 'asked'
        when nxt.starts_at is not null then 'move'
        when cur.id is not null then 'in_chair'
        else 'regular'
      end as kind,
      case
        when a.created_at is not null then
          case when (select d from slot) = (now() at time zone (select z from tz))::date
            then 'Asked about this day at ' || to_char(a.created_at at time zone (select z from tz), 'HH24:MI')
            else 'Asked for ' || to_char((select d from slot), 'Dy')
                 || coalesce(' after ' || to_char(
                      make_time((a.earliest_min / 60)::int, (a.earliest_min % 60)::int, 0), 'HH24:MI'),
                    ' · any time')
          end
        when nxt.starts_at is not null
          then 'Booked ' || to_char(nxt.starts_at at time zone (select z from tz), 'Dy HH24:MI') || ' · would move up'
        when cur.id is not null then 'In your chair right now'
        else 'Regular · ' || vis.n || ' visits'
      end as why,
      (select count(*)::int from public.bookings b
        where b.barber_id = p_barber and b.customer_id = p.id and b.status = 'no_show') as no_shows,
      case when a.created_at is not null then 0
           when nxt.starts_at is not null then 1
           when cur.id is not null then 2 else 3 end as rank
    from people p
    left join public.profiles pr on pr.id = p.id
    left join asks a on a.customer_id = p.id
    left join lateral (
      select b.starts_at from public.bookings b
       where b.barber_id = p_barber and b.customer_id = p.id
         and b.status in ('pending', 'confirmed') and b.starts_at > p_starts_at
       order by b.starts_at limit 1) nxt on true
    left join lateral (
      select b.id from public.bookings b
       where b.barber_id = p_barber and b.customer_id = p.id
         and b.started_at is not null and b.completed_at is null limit 1) cur on true
    left join lateral (
      select count(*)::int as n from public.bookings b
       where b.barber_id = p_barber and b.customer_id = p.id and b.status = 'completed') vis on true
  ) x;
$$;

-- ---- 8j · MESSAGE HIM needs a thread ----------------------------------------
-- Chat hangs off a booking. Someone who only asked has no booking for that day,
-- so the thread to reopen is the last one they had with him.
create or replace function public.barber_waitlist()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_salon uuid;
  v_today date := (now() at time zone 'Africa/Casablanca')::date;
  j json;
begin
  select salon_id into v_salon from public.barbers where id = v_me;

  select json_build_object(
    'asks', (
      select coalesce(json_agg(json_build_object(
               'id', w.id, 'day', w.day,
               'customer_id', w.customer_id,
               'name', coalesce(p.full_name, 'Client'),
               'asked_at', w.created_at,
               'earliest_min', w.earliest_min,
               'mine_only', w.barber_id is not null,
               'service', sv.name,
               'last_booking', (select b.id from public.bookings b
                                 where b.barber_id = v_me and b.customer_id = w.customer_id
                                 order by b.starts_at desc limit 1),
               'visits', (select count(*)::int from public.bookings b
                           where b.barber_id = v_me and b.customer_id = w.customer_id
                             and b.status = 'completed'),
               'no_shows', (select count(*)::int from public.bookings b
                             where b.barber_id = v_me and b.customer_id = w.customer_id
                               and b.status = 'no_show')
             ) order by w.day, w.created_at), '[]'::json)
      from public.waitlist_requests w
      left join public.profiles p on p.id = w.customer_id
      left join public.services sv on sv.id = w.service_id
      where w.status = 'waiting' and w.day >= v_today
        and (w.barber_id = v_me or (w.barber_id is null and w.salon_id = v_salon))
    ),
    'free_today', (
      select count(*)::int from public.bookings b
       where b.barber_id = v_me and b.starts_at::date = v_today
         and b.status in ('pending', 'confirmed')),
    'today', v_today
  ) into j;
  return j;
end;
$$;

-- ---- hygiene ---------------------------------------------------------------
-- Same function name, so 0051's hourly cron entry picks this up untouched.
-- Room for a day that is over is no more use than an ask for it.
create or replace function public.expire_stale_asks()
returns int
language sql security definer set search_path = ''
as $$
  with gone as (
    update public.waitlist_requests set status = 'expired'
     where status = 'waiting'
       and day < (now() at time zone 'Africa/Casablanca')::date
    returning 1),
  swept as (
    delete from public.time_blocks
     where kind = 'open' and day < (now() at time zone 'Africa/Casablanca')::date
    returning 1)
  select ((select count(*) from gone) + (select count(*) from swept))::int;
$$;

-- ---- what an opening actually means ----------------------------------------
do $$
begin
  -- an opening covers a sitting only if it contains the whole sitting
  assert 1140 <= 1140 and 1170 >= 1140 + 30, '19:00-19:30 open covers a 30-min 19:00 booking';
  assert not (1170 >= 1140 + 45), 'it does not cover a 45-min one';
  -- 8k's break option: a 60-min lunch cut to 15 leaves 45, which holds a 30
  assert 780 - (720 + 15) >= 30, 'a 60-min lunch cut to 15 min can hold a 30-min slot';
  assert not (750 - (720 + 15) >= 30), 'a 30-min break cannot';
  -- and it opens the time after the shortened break, not the break itself
  assert 720 + 15 = 735, 'the slot starts when the 15-min break ends';
end $$;
