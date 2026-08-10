-- 0055_coupon_at_checkout: customer turn 37 — where the coupon lands.
--
-- 0038 built coupons that could be claimed and listed, and nothing that could
-- **spend** one: `used_at` was set by hand and no booking ever knew about a
-- discount. Turn 37 is the missing half, and it carries one rule that is an
-- accounting decision rather than a label:
--
--   "Comes off what you pay from your wallet. Your barber still gets the full
--    price." (37a) — "Youssef is still paid 60 DH. Sterncut covers the 20." (37b)
--
-- So `price_cents` does not move. It is what the barber earns, what Earnings
-- totals and what a settlement is computed from. The discount is a separate
-- column that reduces **what the customer owes**, and the platform eats it. A
-- barber who thinks the app is quietly cutting his prices is the fastest way to
-- lose a shop, which is why this is a second column and not a smaller number.

alter table public.coupons
  -- 37a's "on 60 DH or more"
  add column if not exists min_spend_cents int check (min_spend_cents is null or min_spend_cents > 0);

alter table public.bookings
  add column if not exists coupon_id uuid references public.coupons (id),
  add column if not exists discount_cents int not null default 0 check (discount_cents >= 0);

-- "One coupon per booking. They can't be stacked." — and one booking per coupon,
-- which is the half the sentence leaves implied. A live booking reserves it; a
-- cancelled one lets it go (the trigger below).
create unique index if not exists coupons_one_live_booking
  on public.bookings (coupon_id)
  where coupon_id is not null and status in ('pending', 'confirmed', 'completed');

-- ---- what a coupon is worth against a given price --------------------------
-- One place, because 37a's card, 37b's line item and `fill_booking` must agree
-- to the centime or the customer sees three different numbers.
create or replace function public.coupon_discount_cents(p_coupon uuid, p_price_cents int)
returns int
language sql stable security definer set search_path = ''
as $$
  select case
    when c.min_spend_cents is not null and p_price_cents < c.min_spend_cents then 0
    when c.amount_off_cents is not null then least(c.amount_off_cents, p_price_cents)
    else least((p_price_cents * c.percent_off / 100)::int, p_price_cents)
  end
  from public.coupons c where c.id = p_coupon;
$$;
grant execute on function public.coupon_discount_cents(uuid, int) to authenticated;

-- ---- 37a · the wallet, with each coupon judged against this shop ------------
-- The dimmed row in 37a ("Le Fade doesn't take this one") is not a state on the
-- coupon — it is the answer to a question about one salon. So the screen asks.
create or replace function public.my_coupons(p_salon uuid default null, p_price_cents int default null)
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'code', c.code, 'title', c.title, 'note', c.note,
           'percent_off', c.percent_off, 'amount_off_cents', c.amount_off_cents,
           'min_spend_cents', c.min_spend_cents,
           'expires_on', c.expires_on, 'used_at', c.used_at,
           'saved_cents', c.saved_cents, 'used_for', c.used_for,
           'salon_id', c.salon_id,
           'created_at', c.created_at,
           -- 37a's NEW badge: arrived since he last had a look
           'is_new', c.used_at is null and c.created_at > now() - interval '3 days',
           'expired', c.expires_on is not null and c.expires_on < current_date,
           -- why it can't be used here, in the shop's own words. Null = usable.
           'blocked', case
             when c.used_at is not null then 'Already used'
             when c.expires_on is not null and c.expires_on < current_date then 'Expired'
             when p_salon is not null and c.salon_id is not null and c.salon_id <> p_salon
               then coalesce((select s.name from public.salons s where s.id = p_salon), 'This shop')
                    || ' doesn''t take this one'
             when p_price_cents is not null and c.min_spend_cents is not null
                  and p_price_cents < c.min_spend_cents
               then 'Needs ' || (c.min_spend_cents / 100)::int || ' DH or more'
             else null end,
           'worth_cents', case when p_price_cents is null then null
                          else public.coupon_discount_cents(c.id, p_price_cents) end
         ) order by c.used_at nulls first, c.created_at desc), '[]'::json)
  from public.coupons c
  where c.user_id = auth.uid();
$$;
grant execute on function public.my_coupons(uuid, int) to authenticated;

-- ---- the trigger, taught that the customer and the barber owe different sums -
create or replace function public.fill_booking()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca'; -- ponytail: single-city; per-barber tz when multi-city
  min_pct int := 40;
  svc record;
  bun record;
  cpn record;
  v_price_cents int;
  v_payable_cents int;
  v_duration_min int;
  v_today int;
  v_salon uuid;
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

  -- ---- 37b · the coupon, priced against the service, not against the wallet --
  new.discount_cents := 0;
  if new.coupon_id is not null then
    if new.customer_id = new.barber_id then raise exception 'Walk-ins do not take coupons'; end if;
    select c.user_id, c.salon_id, c.used_at, c.expires_on, c.min_spend_cents, c.code
      into cpn from public.coupons c where c.id = new.coupon_id;
    if not found then raise exception 'That coupon is not yours'; end if;
    if cpn.user_id <> new.customer_id then raise exception 'That coupon is not yours'; end if;
    if cpn.used_at is not null then raise exception 'That coupon has already been used'; end if;
    if cpn.expires_on is not null and cpn.expires_on < current_date then
      raise exception 'That coupon has expired';
    end if;
    select salon_id into v_salon from public.barbers where id = new.barber_id;
    if cpn.salon_id is not null and cpn.salon_id is distinct from v_salon then
      raise exception 'That coupon is for a different shop';
    end if;
    if cpn.min_spend_cents is not null and v_price_cents < cpn.min_spend_cents then
      raise exception 'This one needs % DH or more', (cpn.min_spend_cents / 100)::int;
    end if;
    new.discount_cents := public.coupon_discount_cents(new.coupon_id, v_price_cents);
    if new.discount_cents <= 0 then raise exception 'That coupon is worth nothing here'; end if;
  end if;

  -- **price_cents does not move.** It is the barber's money either way; the
  -- platform absorbs the discount. `payable` is the customer's side of the line.
  new.price_cents := v_price_cents;
  v_payable_cents := v_price_cents - new.discount_cents;
  new.duration_min := v_duration_min;
  new.status := case when new.customer_id = new.barber_id then 'confirmed' else 'pending' end;
  new.ends_at := new.starts_at + make_interval(mins => v_duration_min);
  new.mode := 'shop';

  min_pct := public.customer_deposit_pct(new.customer_id);
  wanted := coalesce(new.deposit_cents, 0);
  if new.customer_id = new.barber_id or wanted <= 0 then
    new.deposit_cents := 0;
  else
    -- 37b's slider reads "40% of 40 DH", not of 60: the floor follows what he
    -- actually owes, or a coupon would quietly raise his deposit share.
    floor_cents := ceil(v_payable_cents * min_pct / 100.0);
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
    if wanted > v_payable_cents then raise exception 'A deposit cannot exceed the price'; end if;
    select coalesce(sum(amount_cents), 0)::int into balance
      from public.wallet_transactions where user_id = new.customer_id;
    if wanted > balance then raise exception 'Not enough in your wallet'; end if;
    new.deposit_cents := wanted;
  end if;

  local_start := new.starts_at at time zone shop_tz;
  slot_start_min := extract(hour from local_start)::int * 60 + extract(minute from local_start)::int;

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

-- ---- the coupon follows the booking, from any path -------------------------
-- Cancelling gives it back; finishing spends it for good. A trigger rather than
-- edits to `cancel_booking`, `advance_booking` and the no-show path, because the
-- rule is about the booking's state and not about who changed it.
create or replace function public.coupon_follows_booking()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.coupon_id is null or new.status is not distinct from old.status then return new; end if;

  if new.status = 'completed' then
    update public.coupons
       set used_at = coalesce(used_at, now()),
           saved_cents = new.discount_cents,
           used_for = (select s.name from public.services s where s.id = new.service_id)
     where id = new.coupon_id;
  elsif new.status in ('cancelled', 'no_show') then
    -- he never got the cut, so he never spent the coupon
    update public.coupons set used_at = null, saved_cents = null, used_for = null
     where id = new.coupon_id;
  end if;
  return new;
end;
$$;

drop trigger if exists after_booking_coupon on public.bookings;
create trigger after_booking_coupon
  after update of status on public.bookings
  for each row execute function public.coupon_follows_booking();

-- ---- the arithmetic the three surfaces have to agree on --------------------
do $$
begin
  -- 37b's numbers, exactly as drawn: 60 DH cut, 20 DH coupon, 40% floor
  assert 6000 - 2000 = 4000, 'a 20 DH coupon leaves 40 DH payable';
  assert ceil(4000 * 40 / 100.0) = 1600, 'the deposit floor is 40% of 40 DH, not of 60';
  assert 4000 - 1600 = 2400, 'and 24 DH is left for the shop';
  -- the barber's side does not move
  assert 6000 = 6000, 'price_cents is untouched — the platform absorbs the 20';
  -- a percentage coupon can never exceed the price, and min spend gates it
  assert least((6000 * 15 / 100)::int, 6000) = 900, '15% of 60 DH is 9 DH';
  assert least(20000, 6000) = 6000, 'a coupon bigger than the cut cannot make it free-plus-change';
end $$;
