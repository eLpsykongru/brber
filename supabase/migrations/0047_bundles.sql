-- 0047_bundles: turn 34 of "Customer App 3.dc.html" — option (a), the one-visit
-- bundle, drawn end to end. Turn 33 drew option (b), the prepaid pass; the call
-- was (a), so this is the schema (a) needs and (b) did not.
--
-- BACKLOG TRIGGER PULLED: "Packages tab + Packages step in the booking sheet —
-- DECISION PENDING: how a package books against one barber + calendar slot."
-- Turn 34 answers it: one booking, one barber, one sitting, n services. The
-- feature is named **Bundles**, not Packages, everywhere from here on.
--
-- The three things the design says fall out of (a), and where each lands:
--   · 70 min doesn't fit a 30-min grid (34c) — pure client math, `daySlots()`
--     already takes a duration, so there is no RPC here for it.
--   · a booking holds 1–n services (34e) — `booking_services`.
--   · a client can walk out after two of three (34f) — `settle_booking_services`.

-- ---- the bundle -------------------------------------------------------------
-- barber_id, not salon_id: `services` are per-barber and a bundle is made of one
-- barber's services, booked into one of his slots (34d names one barber). A
-- salon-level bundle would have to answer "whose chair" and the design doesn't.
create table public.bundles (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  name text not null,
  price_cents int not null check (price_cents >= 0),
  is_active boolean not null default true,
  -- ponytail: "Build your own" (34a/34b) is a bundle with no discount, not a
  -- second rail. One booking path, one validation path; these rows are just
  -- hidden from the listings. Give it its own table if barbers ever edit them.
  is_adhoc boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index bundles_barber_idx on public.bundles (barber_id, is_active, sort)
  where not is_adhoc;

create table public.bundle_services (
  bundle_id uuid not null references public.bundles (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  sort int not null default 0,
  primary key (bundle_id, service_id)
);

-- 34e: what the booking actually contains. Prices and durations are snapshotted
-- like `bookings.price_cents` already is — a bundle repriced next month must not
-- rewrite what someone already booked.
create table public.booking_services (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  service_id uuid not null references public.services (id),
  price_cents int not null,
  duration_min int not null,
  sort int not null default 0,
  done_at timestamptz,          -- 34f: ticked off. null after completion = skipped
  unique (booking_id, service_id)
);
create index booking_services_booking_idx on public.booking_services (booking_id, sort);

-- `service_id` stays NOT NULL and becomes the anchor (the first service).
-- ponytail: every existing consumer — queue, calendar, earnings, receipts, the
-- admin console — joins `services` through it and keeps working untouched.
-- `booking_services` is the full list. Make it nullable only if a booking ever
-- needs to exist with no service at all.
alter table public.bookings
  add column bundle_id uuid references public.bundles (id),
  add column duration_min int,
  -- set by settle_booking_services. Without it, "skipped" and "never asked" are
  -- the same NULL done_at, and the completion default below can't tell them apart.
  add column settled_at timestamptz;

-- ---- RLS --------------------------------------------------------------------
alter table public.bundles enable row level security;
alter table public.bundle_services enable row level security;
alter table public.booking_services enable row level security;

-- a real bundle is as public as the services it is made of; ad-hoc ones are private
create policy bundles_select on public.bundles for select to authenticated
  using (not is_adhoc or barber_id = auth.uid() or public.is_admin());
create policy bundles_write on public.bundles for all to authenticated
  using (barber_id = auth.uid()) with check (barber_id = auth.uid());

create policy bundle_services_select on public.bundle_services for select to authenticated
  using (exists (select 1 from public.bundles b where b.id = bundle_id
                  and (not b.is_adhoc or b.barber_id = auth.uid())));
create policy bundle_services_write on public.bundle_services for all to authenticated
  using (exists (select 1 from public.bundles b where b.id = bundle_id and b.barber_id = auth.uid()))
  with check (exists (select 1 from public.bundles b where b.id = bundle_id and b.barber_id = auth.uid()));

-- both sides of the chair see what was booked; nobody writes it by hand
create policy booking_services_select on public.booking_services for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id
                  and (b.customer_id = auth.uid() or b.barber_id = auth.uid()))
         or public.is_admin());

grant select on public.bundles, public.bundle_services, public.booking_services to authenticated;
grant insert, update, delete on public.bundles, public.bundle_services to authenticated;

-- ---- the booking path -------------------------------------------------------
-- 0046's function with one branch added: when a booking carries a bundle, price
-- and duration come off the bundle instead of off one service. Everything after
-- that — the deposit floor, the late-arrival rung, working hours, buffers — is
-- byte-for-byte 0046 and reads `new.price_cents` without caring how it got set.
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
  -- the two numbers the rest of the function runs on, whichever branch set them
  v_price_cents int;
  v_duration_min int;
  local_start timestamp;
  slot_start_min int;
  gap int;
  wanted int;
  floor_cents int;
  balance int;
  late record;
begin
  if new.bundle_id is not null then
    -- the whole bundle, priced and timed server-side. The client proposes the
    -- bundle and the slot; it never proposes what either costs or how long it runs.
    select b.price_cents, b.barber_id, b.is_active into bun
      from public.bundles b where b.id = new.bundle_id;
    if not found then raise exception 'Bundle unavailable'; end if;
    if bun.barber_id <> new.barber_id then raise exception 'Bundle does not belong to this barber'; end if;
    if not bun.is_active then raise exception 'Bundle unavailable'; end if;

    select sum(s.duration_min)::int into v_duration_min
      from public.bundle_services bs join public.services s on s.id = bs.service_id
     where bs.bundle_id = new.bundle_id and s.is_active;
    if coalesce(v_duration_min, 0) <= 0 then raise exception 'Bundle has no services'; end if;

    -- the anchor: first item by sort, so every existing service_id join still works
    select bs.service_id into new.service_id
      from public.bundle_services bs join public.services s on s.id = bs.service_id
     where bs.bundle_id = new.bundle_id and s.is_active
     order by bs.sort, s.name limit 1;

    v_price_cents := bun.price_cents;
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
  -- barber's own walk-in → instant; customer request → barber must accept
  new.status := case when new.customer_id = new.barber_id then 'confirmed' else 'pending' end;
  new.ends_at := new.starts_at + make_interval(mins => v_duration_min);
  new.mode := 'shop';

  -- the deposit is the ONE money field the client gets to propose. Everything
  -- about it is re-checked here: floor, ceiling, and the balance behind it.
  min_pct := public.customer_deposit_pct(new.customer_id);
  wanted := coalesce(new.deposit_cents, 0);
  if new.customer_id = new.barber_id or wanted <= 0 then
    new.deposit_cents := 0;                       -- walk-ins and cash bookings
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

  -- inside working hours, not on a day off (shop-local time)
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

  -- prep/cleanup buffer: reject customer bookings too close to an existing one
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

-- Single-service bookings get their one row too, so 34e's card has exactly one
-- shape to render and `settle_booking_services` has one thing to tick.
create or replace function public.fill_booking_services()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.bundle_id is null then
    insert into public.booking_services (booking_id, service_id, price_cents, duration_min, sort)
    select new.id, s.id, new.price_cents, s.duration_min, 0
      from public.services s where s.id = new.service_id
    on conflict do nothing;
  else
    -- the bundle's own prices, which sum to MORE than the bundle price: that
    -- difference is the saving, and 34f needs the parts to reprice a broken one.
    insert into public.booking_services (booking_id, service_id, price_cents, duration_min, sort)
    select new.id, s.id, s.price_cents, s.duration_min, bs.sort
      from public.bundle_services bs join public.services s on s.id = bs.service_id
     where bs.bundle_id = new.bundle_id and s.is_active
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger after_booking_insert_services
  after insert on public.bookings
  for each row execute function public.fill_booking_services();

-- ---- booking a bundle (34b → 34d) ------------------------------------------
create or replace function public.book_bundle(
  p_bundle uuid, p_starts_at timestamptz, p_deposit_cents int default 0)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_barber uuid;
  v_id uuid;
begin
  select barber_id into v_barber from public.bundles where id = p_bundle;
  if v_barber is null then raise exception 'Bundle unavailable'; end if;

  insert into public.bookings (customer_id, barber_id, service_id, bundle_id,
                               starts_at, ends_at, price_cents, deposit_cents)
  -- service_id/ends_at/price are placeholders: fill_booking overwrites all three
  values (auth.uid(), v_barber,
          (select service_id from public.bundle_services where bundle_id = p_bundle order by sort limit 1),
          p_bundle, p_starts_at, p_starts_at, 0, p_deposit_cents)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.book_bundle(uuid, timestamptz, int) to authenticated;

-- 34b "Build your own · Any services, one sitting · no discount". An ad-hoc
-- bundle priced at the sum of its parts, so there is exactly one booking path.
create or replace function public.book_custom(
  p_barber uuid, p_services uuid[], p_starts_at timestamptz, p_deposit_cents int default 0)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_bundle uuid;
  v_total int;
  v_n int;
begin
  if array_length(p_services, 1) is null then raise exception 'Pick at least one service'; end if;

  select count(*)::int, sum(price_cents)::int into v_n, v_total
    from public.services
   where id = any (p_services) and barber_id = p_barber and is_active;
  if v_n <> array_length(p_services, 1) then
    raise exception 'Those services do not all belong to this barber';
  end if;

  insert into public.bundles (barber_id, name, price_cents, is_adhoc)
  values (p_barber, 'One sitting', v_total, true)
  returning id into v_bundle;

  insert into public.bundle_services (bundle_id, service_id, sort)
  select v_bundle, s.id, row_number() over (order by array_position(p_services, s.id))
    from public.services s where s.id = any (p_services);

  return public.book_bundle(v_bundle, p_starts_at, p_deposit_cents);
end;
$$;
grant execute on function public.book_custom(uuid, uuid[], timestamptz, int) to authenticated;

-- ---- 34f · he skipped the shave --------------------------------------------
-- "Two of three done, so it's charged as two separate services. The 20 DH
-- bundle saving doesn't apply." The bundle price is a discount for taking the
-- whole thing; take part of it and you pay the parts.
create or replace function public.settle_booking_services(p_booking uuid, p_done uuid[])
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  b record;
  v_total int;
  v_all boolean;
  v_price int;
begin
  select bk.id, bk.barber_id, bk.bundle_id, bk.deposit_cents into b
    from public.bookings bk where bk.id = p_booking;
  if not found then raise exception 'Not found'; end if;
  if b.barber_id is distinct from auth.uid() then raise exception 'Not your booking'; end if;

  update public.booking_services
     set done_at = case when service_id = any (coalesce(p_done, '{}'::uuid[])) then now() else null end
   where booking_id = p_booking;

  select coalesce(sum(price_cents) filter (where done_at is not null), 0)::int,
         -- count(*) = 0 would make an empty booking read as "all done" and quietly
         -- charge the bundle price for nothing
         count(*) > 0 and count(*) = count(*) filter (where done_at is not null)
    into v_total, v_all
    from public.booking_services where booking_id = p_booking;

  -- whole bundle done → the bundle price; anything less → the parts, at list
  if b.bundle_id is not null and v_all then
    select price_cents into v_price from public.bundles where id = b.bundle_id;
  else
    v_price := v_total;
  end if;

  update public.bookings set price_cents = v_price, settled_at = now() where id = p_booking;

  return json_build_object(
    'price_cents', v_price,
    'deposit_cents', b.deposit_cents,
    'collect_cents', greatest(v_price - b.deposit_cents, 0),
    'bundle_broken', b.bundle_id is not null and not v_all);
end;
$$;
grant execute on function public.settle_booking_services(uuid, uuid[]) to authenticated;

-- A booking can be completed from three screens (dashboard, calendar, day
-- timeline) and only the dashboard raises 34f. Rather than thread a sheet
-- through the other two — both wrap completion in an undo toast — the default
-- lands here, once: completing without settling means everything was done.
-- The price is already the bundle price, so nothing is repriced; this only stops
-- `done_at` reading as "none of it happened" on the other two paths.
create or replace function public.default_settle_on_complete()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.completed_at is not null and old.completed_at is null and new.settled_at is null then
    update public.booking_services set done_at = now()
     where booking_id = new.id and done_at is null;
  end if;
  return new;
end;
$$;

create trigger after_booking_completed
  after update of completed_at on public.bookings
  for each row execute function public.default_settle_on_complete();

-- ---- 34a · what the salon page reads ---------------------------------------
create or replace function public.salon_bundles(p_salon uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', bu.id, 'barber_id', bu.barber_id,
           'barber', coalesce(p.full_name, 'Barber'),
           'name', bu.name,
           'price_cents', bu.price_cents,
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
                         where bs.bundle_id = bu.id and s.is_active)
         ) order by bu.sort, bu.created_at), '[]'::json)
  from public.bundles bu
  join public.barbers ba on ba.id = bu.barber_id
  left join public.profiles p on p.id = bu.barber_id
  where ba.salon_id = p_salon and ba.salon_status = 'approved'
    and bu.is_active and not bu.is_adhoc;
$$;
grant execute on function public.salon_bundles(uuid) to authenticated;

-- ---- the money, checked -----------------------------------------------------
-- The Groom, exactly as turn 34 prices it: three services at 60/40/50 = 150 DH
-- list, 130 DH as a bundle, 40% deposit = 52 DH, and the walk-out case at 34f.
do $$
begin
  assert 6000 + 4000 + 5000 = 15000, 'the parts of The Groom are 150 DH';
  assert ceil(13000 * 40 / 100.0) = 5200, '40% of a 130 DH bundle is 52 DH';
  assert 13000 - 5200 = 7800, '78 DH is left at the shop';
  -- 34f: haircut + beard done, shave skipped → parts, not bundle
  assert 6000 + 4000 = 10000, 'two of three is charged at list: 100 DH';
  assert greatest(10000 - 5200, 0) = 4800, 'collect 48 DH in cash when the bundle breaks';
  assert 15000 - 13000 = 2000, 'the saving that disappears is 20 DH';
end $$;
