-- 0050_the_ask: customer turn 36 + barber 8g/8h/8i — the missing write.
--
-- 8d ranks candidates by evidence of wanting the slot and its top row is a green
-- ASKED, but nothing in the customer app ever recorded an ask, so that row and
-- 8b's "1 client asked about today" could never appear. 0049 guessed the table;
-- turn 36 specifies it: (customer_id, barber_id, salon_id, date, earliest_time,
-- status). This reconciles the two.
--
-- `bookings` is untouched, on purpose. **An ask is not a hold** — nothing is
-- reserved, nothing is charged, and the barber still chooses who gets offered.

-- ---- the ask, as turn 36 draws it ------------------------------------------
-- Written as ALTERs rather than a fresh table so this is safe whether or not
-- 0049 has already run somewhere.
alter table public.waitlist_requests
  add column if not exists salon_id uuid references public.salons (id) on delete cascade,
  add column if not exists service_id uuid references public.services (id) on delete set null,
  -- 36a's "earliest I can come": minutes from midnight, null = any time
  add column if not exists earliest_min int check (earliest_min is null or earliest_min between 0 and 1440),
  add column if not exists status text not null default 'waiting'
    check (status in ('waiting', 'offered', 'taken', 'expired', 'cancelled'));

-- 36a's "Any barber at Le Fade" — an ask can name a chair or just the shop
alter table public.waitlist_requests alter column barber_id drop not null;

-- one live ask per person per day per shop; the old (customer, barber, day) key
-- can't express "any barber", and a cancelled ask must not block a new one
-- constraint first: if a constraint owns the index, DROP INDEX is refused (2BP01)
alter table public.waitlist_requests
  drop constraint if exists waitlist_requests_customer_id_barber_id_day_key;
drop index if exists public.waitlist_requests_customer_id_barber_id_day_key;
create unique index if not exists waitlist_one_live_ask
  on public.waitlist_requests (customer_id, salon_id, day)
  where status = 'waiting';
create index if not exists waitlist_salon_day_idx
  on public.waitlist_requests (salon_id, day) where status = 'waiting';

-- ---- 36a · make the ask ----------------------------------------------------
create or replace function public.ask_for_day(
  p_salon uuid, p_date date, p_service uuid default null,
  p_barber uuid default null, p_earliest_min int default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_date < (now() at time zone 'Africa/Casablanca')::date then
    raise exception 'That day has already passed';
  end if;
  if p_barber is not null and not exists (
    select 1 from public.barbers b where b.id = p_barber and b.salon_id = p_salon
  ) then
    raise exception 'That barber does not work there';
  end if;

  -- re-asking the same day replaces the old ask rather than erroring at them
  update public.waitlist_requests
     set barber_id = p_barber, service_id = p_service, earliest_min = p_earliest_min,
         created_at = now()
   where customer_id = auth.uid() and salon_id = p_salon and day = p_date
     and status = 'waiting'
  returning id into v_id;
  if v_id is not null then return v_id; end if;

  insert into public.waitlist_requests
    (customer_id, salon_id, barber_id, service_id, day, earliest_min)
  values (auth.uid(), p_salon, p_barber, p_service, p_date, p_earliest_min)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.ask_for_day(uuid, date, uuid, uuid, int) to authenticated;

create or replace function public.cancel_ask(p_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.waitlist_requests set status = 'cancelled'
   where id = p_id and customer_id = auth.uid() and status = 'waiting';
$$;
grant execute on function public.cancel_ask(uuid) to authenticated;

-- ---- 36c · my asks, in Bookings --------------------------------------------
create or replace function public.my_waitlist_asks()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', w.id, 'day', w.day, 'earliest_min', w.earliest_min,
           'status', case when w.status = 'waiting'
                            and w.day < (now() at time zone 'Africa/Casablanca')::date
                          then 'expired' else w.status end,
           'salon', s.name, 'salon_id', w.salon_id,
           'barber', bp.full_name, 'service', sv.name,
           'price_cents', sv.price_cents
         ) order by w.day), '[]'::json)
  from public.waitlist_requests w
  left join public.salons s on s.id = w.salon_id
  left join public.profiles bp on bp.id = w.barber_id
  left join public.services sv on sv.id = w.service_id
  where w.customer_id = auth.uid()
    and w.status in ('waiting', 'offered')
    -- 36c keeps an expired ask on screen for a week so it can say what happened
    and w.day > (now() at time zone 'Africa/Casablanca')::date - interval '7 days';
$$;
grant execute on function public.my_waitlist_asks() to authenticated;

-- ---- 8h/8i · the list itself -----------------------------------------------
-- Grouped by day, because that is the only unit a barber can act on: a day is
-- either full (asks make sense) or it isn't (they don't).
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
        -- an ask names either this chair or the whole shop
        and (w.barber_id = v_me or (w.barber_id is null and w.salon_id = v_salon))
    ),
    -- 8i's empty state leans on this: asks only happen on days with nothing left
    'free_today', (
      select count(*)::int from public.bookings b
       where b.barber_id = v_me and b.starts_at::date = v_today
         and b.status in ('pending', 'confirmed')),
    'today', v_today
  ) into j;
  return j;
end;
$$;
grant execute on function public.barber_waitlist() to authenticated;

-- ---- 8d, taught the new shape ----------------------------------------------
-- 0049's version keyed on (barber_id, day) and knew nothing about earliest_time,
-- any-barber asks, or status. All three change who legitimately shows up as ASKED.
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
  -- an ask counts only if it covers this chair AND this time of day
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
        when a.created_at is not null
          then 'Asked about this day at ' || to_char(a.created_at at time zone (select z from tz), 'HH24:MI')
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

-- taking an offered slot closes the ask that earned it
create or replace function public.close_ask_on_claim()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.claimed_by is null or old.claimed_by is not null then return new; end if;
  update public.waitlist_requests set status = 'taken'
   where customer_id = new.claimed_by and status = 'waiting'
     and day = (new.starts_at at time zone 'Africa/Casablanca')::date;
  return new;
end;
$$;

create trigger after_offer_claimed
  after update of claimed_by on public.slot_offers
  for each row execute function public.close_ask_on_claim();

-- ---- what the rules actually mean ------------------------------------------
do $$
begin
  -- 36a's three chips, as minutes from midnight
  assert 10 * 60 = 600, '"After 10:00" is 600 minutes';
  assert 15 * 60 = 900, '"After 15:00" is 900 minutes';
  -- an "after 10:00" ask must not be offered an 09:30 slot, and must take 11:00
  assert not (600 <= 9 * 60 + 30), 'an after-10:00 ask is not a candidate for 09:30';
  assert 600 <= 11 * 60, 'an after-10:00 ask IS a candidate for 11:00';
  -- "any time" is null, which the candidate filter treats as always eligible
  assert (null::int is null), 'any-time asks carry no earliest_min';
end $$;
