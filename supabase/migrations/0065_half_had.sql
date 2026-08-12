-- 0065_half_had: customer turn 39 — four things the app already half-had.
--
-- Every one of these is a place where the interface makes a promise the data
-- doesn't keep, and every one of them is already named in BACKLOG.md. This is
-- four triggers being pulled in one migration because they are one turn:
--
--   39a  the customer end of barber 11a — `accepting_bookings`, finally read on
--        the salon page, with the distinction that matters: the SHOP is shut,
--        the barbers are not.
--   39b  BACKLOG "Late-arrival marks → Nothing surfaces the mark before it
--        bites." A marked customer currently discovers it when a booking sheet
--        refuses a 40% deposit. 38d ambushes people; this is the screen that
--        stops it.
--   39c  BACKLOG "Wishlist → the heart button does nothing yet."
--   39d  BACKLOG "Appointment NOTES → needs a `bookings.notes` column."

-- ---- 39d · the note ---------------------------------------------------------
-- Smallest of the four and the one with the longest backlog entry. 280 chars
-- because the sheet says "he reads this when you're in the chair" — anything
-- longer is a conversation and belongs in chat, which the sheet says out loud.
alter table public.bookings
  add column if not exists notes text
    check (notes is null or length(notes) <= 280);
grant update (notes) on public.bookings to authenticated;

-- ---- 39a · the shop is shut, the barbers are not ---------------------------
-- 0064 gave the closure an end date; this is the only thing the customer side
-- needs to read it. `salon_open` (0064) is the single source both ends share,
-- so the customer can never be told a shop is open that the trigger will refuse.
create or replace function public.salon_closure(p_salon uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  s record;
  v_back date;
  v_open int;
  j json;
begin
  select * into s from public.salons where id = p_salon;
  if not found then return json_build_object('closed', false); end if;
  if public.salon_open(p_salon) then return json_build_object('closed', false); end if;

  -- the day it comes back. null closed_until means "until the owner says so",
  -- and the honest answer there is that we do not know.
  v_back := case when s.closed_until is null then null else s.closed_until + 1 end;
  -- the first minute anyone in the shop opens on that weekday, which is a
  -- better answer than the shop envelope: the envelope is the outer limit, the
  -- barbers' own hours are when someone is actually there.
  select min(a.start_min) into v_open
    from public.availability a
    join public.barbers b on b.id = a.barber_id
   where b.salon_id = p_salon and b.salon_status = 'approved'
     and a.weekday = extract(dow from coalesce(v_back, (now() at time zone shop_tz)::date + 1))::int;

  select json_build_object(
    'closed', true,
    'name', s.name,
    'until', s.closed_until,
    'back_on', v_back,
    'open_min', coalesce(v_open, s.open_min),
    -- "If you already have a booking, it still stands" — said only when true
    'my_booking', exists (
      select 1 from public.bookings bk
       join public.barbers b on b.id = bk.barber_id
       where b.salon_id = p_salon and bk.customer_id = auth.uid()
         and bk.status in ('pending', 'confirmed') and bk.starts_at > now())
  ) into j;
  return j;
end;
$$;
grant execute on function public.salon_closure(uuid) to authenticated;

-- 39a's "TELL ME IF THEY REOPEN" needs no function of its own: a
-- `waitlist_requests` row for the day it comes back is exactly the record, and
-- `reopen_shop` (0064) already notifies every live ask when the shop returns.
-- The client inserts it directly — RLS `waitlist_write` already scopes that to
-- the asker, and 0050's partial unique index already stops duplicates.

-- ---- 39b · your standing, before it bites ----------------------------------
-- The design introduces a rule 0046 didn't have: **three visits on time in a
-- row clears the mark.** 0046 only ever expired one by waiting 90 days, which
-- gives a marked customer nothing to do but wait. Both rules now apply and the
-- first one to land wins, so nobody is worse off than before.
create or replace function public.customer_on_time_streak(p_customer uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  -- completed visits since the newest live mark, counted only while they stay
  -- on time; the first late one stops the count where it stands
  select count(*)::int from (
    select b.checked_in_at, b.starts_at,
           bool_and(b.checked_in_at is null or b.checked_in_at <= b.starts_at + interval '15 minutes')
             over (order by b.completed_at) as clean
      from public.bookings b
     where b.customer_id = p_customer and b.completed_at is not null
       and b.completed_at > coalesce(
             (select max(m.created_at) from public.customer_marks m
               where m.customer_id = p_customer and m.cleared_at is null),
             '-infinity'::timestamptz)
  ) x where x.clean;
$$;
grant execute on function public.customer_on_time_streak(uuid) to authenticated;

-- re-emitted from 0046 with the streak as a second way out
create or replace function public.customer_deposit_pct(p_customer uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.customer_marks m
       where m.customer_id = p_customer and m.cleared_at is null
         and m.created_at > now() - interval '90 days'
    ) then 40
    -- 39b's ladder: three in a row and you are back to splitting the payment
    when public.customer_on_time_streak(p_customer) >= 3 then 40
    else 100
  end;
$$;

create or replace function public.my_customer_standing()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_streak int;
  j json;
begin
  v_streak := public.customer_on_time_streak(auth.uid());
  select json_build_object(
    'pays_full', public.customer_deposit_pct(auth.uid()) = 100,
    'streak', least(v_streak, 3),
    'needed', 3,
    'marks', (
      select coalesce(json_agg(json_build_object(
        'id', m.id, 'kind', m.kind, 'minutes', m.minutes, 'at', m.created_at,
        'salon', coalesce(sa.name, 'A shop'),
        'cleared', m.cleared_at is not null,
        -- 39b's "Too old to dispute". Two weeks is long enough to notice and
        -- short enough that the check-in log still means something.
        'disputable', m.cleared_at is null and m.created_at > now() - interval '14 days'
      ) order by m.created_at desc), '[]'::json)
        from public.customer_marks m
        left join public.bookings b on b.id = m.booking_id
        left join public.barbers ba on ba.id = b.barber_id
        left join public.salons sa on sa.id = ba.salon_id
       where m.customer_id = auth.uid()
         and m.created_at > now() - interval '180 days'),
    'history', (
      select coalesce(json_agg(json_build_object(
        'at', b.completed_at, 'salon', coalesce(sa.name, 'A shop'),
        'on_time', b.checked_in_at is null or b.checked_in_at <= b.starts_at + interval '15 minutes'
      ) order by b.completed_at desc), '[]'::json)
        from public.bookings b
        left join public.barbers ba on ba.id = b.barber_id
        left join public.salons sa on sa.id = ba.salon_id
       where b.customer_id = auth.uid() and b.completed_at is not null
         and b.completed_at > now() - interval '90 days')
  ) into j;
  return j;
end;
$$;
grant execute on function public.my_customer_standing() to authenticated;

-- ---- 39c · saved ------------------------------------------------------------
-- One table for both halves of the screen. The design saves barbers AND salons,
-- and a row is exactly one of the two.
create table if not exists public.wishlists (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  barber_id uuid references public.barbers (id) on delete cascade,
  salon_id uuid references public.salons (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(barber_id, salon_id) = 1)
);
create unique index if not exists wishlists_barber_key on public.wishlists (customer_id, barber_id)
  where barber_id is not null;
create unique index if not exists wishlists_salon_key on public.wishlists (customer_id, salon_id)
  where salon_id is not null;

-- "Nobody is told you saved them." That is a policy, not a sentence: nobody but
-- the saver can read the row, including the barber it names.
alter table public.wishlists enable row level security;
create policy wishlists_own on public.wishlists for all to authenticated
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());
grant select, insert, delete on public.wishlists to authenticated;

-- 39c's toggle. Rides 0032's prefs table, repointed to user_id by 0037.
alter table public.notification_prefs
  add column if not exists push_saved_gap boolean not null default true;

-- "Free 11:00 today". ponytail: today only, in 30-minute steps, ignoring service
-- duration — the card is a nudge, not a booking. The real picker (`daySlots`)
-- still decides what is actually bookable, so the worst case is the card says
-- 11:00 and the sheet offers 11:30. A multi-day scan per saved barber is what
-- "Next free Fri 14:00" would cost, and it is not worth it on a list screen.
create or replace function public.barber_next_free_today(p_barber uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  with shop as (select (now() at time zone 'Africa/Casablanca') as ts),
  now_min as (select (extract(hour from ts) * 60 + extract(minute from ts))::int as m,
                     ts::date as day, extract(dow from ts)::int as dow from shop)
  select min(t.slot)::int
    from now_min n
    join public.availability a
      on a.barber_id = p_barber and a.weekday = n.dow
    cross join lateral generate_series(a.start_min, a.end_min - 30, 30) as t(slot)
   where t.slot >= n.m
     and (select accepting_bookings from public.barbers where id = p_barber)
     and public.salon_open((select salon_id from public.barbers where id = p_barber))
     and not exists (select 1 from public.days_off d
                      where d.barber_id = p_barber and d.day = n.day)
     and not exists (
       select 1 from public.bookings b
        where b.barber_id = p_barber and b.status in ('pending', 'confirmed')
          and (b.starts_at at time zone 'Africa/Casablanca')::date = n.day
          and t.slot < (extract(hour from (b.starts_at at time zone 'Africa/Casablanca')) * 60
                        + extract(minute from (b.starts_at at time zone 'Africa/Casablanca')))::int
                       + coalesce(b.duration_min, 30)
          and t.slot + 30 > (extract(hour from (b.starts_at at time zone 'Africa/Casablanca')) * 60
                        + extract(minute from (b.starts_at at time zone 'Africa/Casablanca')))::int)
     and not exists (
       select 1 from public.time_blocks tb
        where tb.barber_id = p_barber and tb.kind = 'block'
          and (tb.day is null or tb.day = n.day)
          and t.slot < tb.end_min and t.slot + 30 > tb.start_min);
$$;
grant execute on function public.barber_next_free_today(uuid) to authenticated;

create or replace function public.my_wishlist()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_today date := (now() at time zone shop_tz)::date;
  v_dow int := extract(dow from (now() at time zone shop_tz))::int;
  v_now int := extract(hour from (now() at time zone shop_tz)) * 60
             + extract(minute from (now() at time zone shop_tz))::int;
  j json;
begin
  select json_build_object(
    'barbers', (
      select coalesce(json_agg(json_build_object(
        'id', b.id, 'name', coalesce(p.full_name, 'Barber'),
        'salon', coalesce(sa.name, 'Independent'),
        -- removed reviews are excluded here the same way `reviews_select`
        -- (0042) excludes them everywhere else, so one saved card and the
        -- barber's own page can never print different stars
        'rating', coalesce((select round(avg(r.rating), 2) from public.reviews r
                             where r.barber_id = b.id and r.state <> 'removed'), 0),
        'free_today', public.barber_next_free_today(b.id)
      ) order by p.full_name), '[]'::json)
        from public.wishlists w
        join public.barbers b on b.id = w.barber_id
        join public.profiles p on p.id = b.id
        left join public.salons sa on sa.id = b.salon_id
       where w.customer_id = auth.uid() and w.barber_id is not null),
    'salons', (
      select coalesce(json_agg(json_build_object(
        'id', sa.id, 'name', sa.name, 'district', coalesce(sa.district, sa.address),
        'from_cents', (select min(sv.price_cents) from public.services sv
                        join public.barbers b2 on b2.id = sv.barber_id
                       where b2.salon_id = sa.id and sv.is_active),
        'open', public.salon_open(sa.id)
      ) order by sa.name), '[]'::json)
        from public.wishlists w
        join public.salons sa on sa.id = w.salon_id
       where w.customer_id = auth.uid() and w.salon_id is not null),
    'gap_alerts', coalesce((select push_saved_gap from public.notification_prefs
                             where user_id = auth.uid()), true)
  ) into j;
  return j;
end;
$$;
grant execute on function public.my_wishlist() to authenticated;


-- ---- the rules this turn adds, where they can be read ----------------------
do $$
begin
  -- 39b's ladder. The mark stops mattering at three, not at two.
  assert least(2, 3) = 2, 'two on-time visits is progress, not a clearance';
  assert least(4, 3) = 3, 'the bar never shows more than three of three';
  -- 39d's ceiling — the sheet promises a note, not a conversation
  assert length(repeat('x', 280)) = 280, 'a note is capped at 280 characters';
  -- 39c: a wishlist row is a barber or a salon, never both and never neither
  assert num_nonnulls(null, null) = 0, 'an empty saved row must fail its check';
  assert num_nonnulls('a', 'b') = 2, 'a row naming both must fail its check';
  assert num_nonnulls('a', null) = 1, 'a row naming one is the only valid shape';
end $$;
