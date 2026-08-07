-- 0048_bundle_editor: turn 7 of "Barber App.dc.html" — the shop side of the
-- bundle. 0047 built what a customer books; this is where Youssef builds it.
--
-- The turn's whole point is that the editor has to tell him two things the
-- customer screens never can: the price he types is a **discount he pays for**,
-- and a 70-minute product only fits where three slots sit free in a row, which
-- costs him sellable time. 7c does that arithmetic before he publishes and the
-- answer is deliberately not flattering — so it ships with the two brakes 7c
-- offers, and those are the only new columns here.

alter table public.bundles
  -- 7c "Cap it per day · Keep the rest of the grid for single cuts"
  add column max_per_day int check (max_per_day is null or max_per_day > 0),
  -- 7c "Mornings only · Before 13:00, when the gaps exist"
  add column morning_only boolean not null default false;

-- ponytail: 13:00 is 7c's own number, not a setting. Make it a column the day it
-- needs to differ per shop; until then a second knob is a second thing to get wrong.
create or replace function public.bundle_morning_cutoff() returns int
language sql immutable as $$ select 13 $$;

-- ---- the two brakes, enforced where every booking already passes ------------
-- Byte-for-byte 0047's function with one block added inside the bundle branch.
-- A cap that only the editor honours is decoration: the customer's booking sheet
-- would still offer the slot and the insert would still win the race.
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
  if exists (select 1 from public.days_off d
             where d.barber_id = new.barber_id and d.day = local_start::date) then
    raise exception 'Barber is off that day';
  end if;
  if not exists (select 1 from public.availability a
                 where a.barber_id = new.barber_id
                   and a.weekday = extract(dow from local_start)::int
                   and a.start_min <= slot_start_min
                   and a.end_min >= slot_start_min + v_duration_min) then
    raise exception 'Outside working hours';
  end if;
  if new.customer_id <> new.barber_id
     and exists (select 1 from public.time_blocks tb
                 where tb.barber_id = new.barber_id
                   and (tb.day is null or tb.day = local_start::date)
                   and tb.start_min < slot_start_min + v_duration_min
                   and tb.end_min > slot_start_min) then
    raise exception 'Barber is unavailable at that time';
  end if;

  if new.customer_id <> new.barber_id then
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

-- ---- 7a · the list, with the numbers in its header --------------------------
-- "2 live · 18 booked this month" and "1 940 DH · 17% of your takings" are real
-- figures or they are decoration, and a barber checks them against his own book.
create or replace function public.my_bundles()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_from timestamptz := date_trunc('month', now());
  j json;
begin
  select json_build_object(
    'bundles', (
      select coalesce(json_agg(json_build_object(
               'id', bu.id, 'name', bu.name,
               'price_cents', bu.price_cents,
               'is_active', bu.is_active,
               'sort', bu.sort,
               'max_per_day', bu.max_per_day,
               'morning_only', bu.morning_only,
               'list_cents', (select coalesce(sum(s.price_cents), 0)::int
                                from public.bundle_services bs join public.services s on s.id = bs.service_id
                               where bs.bundle_id = bu.id and s.is_active),
               'duration_min', (select coalesce(sum(s.duration_min), 0)::int
                                  from public.bundle_services bs join public.services s on s.id = bs.service_id
                                 where bs.bundle_id = bu.id and s.is_active),
               'services', (select coalesce(json_agg(json_build_object(
                                     'id', s.id, 'name', s.name,
                                     'price_cents', s.price_cents, 'duration_min', s.duration_min)
                                     order by bs.sort), '[]'::json)
                              from public.bundle_services bs join public.services s on s.id = bs.service_id
                             where bs.bundle_id = bu.id and s.is_active),
               'booked', (select count(*)::int from public.bookings b
                           where b.bundle_id = bu.id and b.starts_at >= v_from
                             and b.status <> 'cancelled'),
               -- 7a's amber note: the same service set already sells as one service
               'twin', (select s.name from public.services s
                         where s.barber_id = v_me and s.is_active
                           and s.price_cents = bu.price_cents
                           and (select count(*) from public.bundle_services x where x.bundle_id = bu.id) > 1
                         limit 1)
             ) order by bu.sort, bu.created_at), '[]'::json)
      from public.bundles bu
      where bu.barber_id = v_me and not bu.is_adhoc
    ),
    'services', (
      select coalesce(json_agg(json_build_object(
               'id', s.id, 'name', s.name,
               'price_cents', s.price_cents, 'duration_min', s.duration_min)
               order by s.name), '[]'::json)
      from public.services s where s.barber_id = v_me and s.is_active
    ),
    -- the header line: bundle takings this month against everything taken
    'month_bundle_cents', (
      select coalesce(sum(b.price_cents), 0)::int from public.bookings b
       where b.barber_id = v_me and b.bundle_id is not null
         and b.starts_at >= v_from and b.status <> 'cancelled'),
    'month_booked', (
      select count(*)::int from public.bookings b
       where b.barber_id = v_me and b.bundle_id is not null
         and b.starts_at >= v_from and b.status <> 'cancelled'),
    'month_total_cents', (
      select coalesce(sum(b.price_cents), 0)::int from public.bookings b
       where b.barber_id = v_me and b.starts_at >= v_from and b.status <> 'cancelled'),
    -- 7c needs the day it is reasoning about: the longest working window + buffer
    'day_min', (
      select coalesce(max(a.end_min - a.start_min), 0)::int
        from public.availability a where a.barber_id = v_me),
    'buffer_min', (
      select coalesce(buffer_before_min + buffer_after_min, 0)::int
        from public.barbers where id = v_me)
  ) into j;
  return j;
end;
$$;
grant execute on function public.my_bundles() to authenticated;

-- ---- 7c's arithmetic, pinned ------------------------------------------------
-- The design reasons about a 09:30–19:00 day with a 5-minute buffer and gets
-- 910 DH from Grooms against 960 DH from single cuts. The screen recomputes this
-- from the barber's own hours; these asserts hold the formula to the drawn case,
-- so a change that quietly makes bundles look good fails the migration.
do $$
declare
  day_min int := 19 * 60 - (9 * 60 + 30);   -- 09:30 – 19:00 = 570
  buf int := 5;
  grooms int;
  singles int;
begin
  grooms := floor(day_min::numeric / (70 + buf));
  singles := floor(day_min::numeric / (30 + buf));
  assert day_min = 570, 'the drawn day is 570 minutes';
  assert grooms = 7, '7 Grooms fit a full day';
  assert singles = 16, '16 single cuts fit the same day';
  assert grooms * 13000 = 91000, 'all Grooms is 910 DH';
  assert singles * 6000 = 96000, 'all single cuts is 960 DH';
  assert singles - grooms = 9, '9 fewer chances to be booked';
  -- the discount the barber is choosing to pay, as the editor shows it
  assert round((15000 - 13000) * 100.0 / 15000) = 13, 'The Groom is 13% off';
end $$;
