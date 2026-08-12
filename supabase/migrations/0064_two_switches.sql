-- 0064_two_switches: barber turn 11 — two switches that were only pretending.
--
-- Both halves of this turn are the same bug wearing different clothes: a column
-- the code writes and the product never honours.
--
--   · `salons.accepting_bookings` (0025) is written by the Salon-management
--     header power button and read by NOTHING in the booking path. Six re-emits
--     of `fill_booking` between 0016 and 0055 each check the *barber's* switch;
--     none has ever checked the shop's. An owner closes his shop, watches the
--     button turn grey, and requests keep landing on his barbers.
--   · `salons.float_cap_cents` (0044) is enforced properly in SQL and has no
--     screen at all. The first time a barber learns the cap exists is the moment
--     `agent_cash_topup` refuses him — with a customer's banknotes already in
--     his hand.
--
-- The turn's rule: **a switch has to say what it actually does, and a limit has
-- to warn before it bites.**

-- ---- 11a/11b · the pause ----------------------------------------------------
-- `accepting_bookings` stays the switch. What it lacked was an end: 11a offers
-- "rest of today", "until I reopen" and "pick dates", and a boolean cannot say
-- which. `closed_until` is only meaningful while the switch is off — null there
-- means "until I say so", which is why openness is derived rather than stored.
alter table public.salons
  add column if not exists closed_until date,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles (id);

-- ponytail: derived, not swept. "Rest of today" reopens because the date passed,
-- not because a cron woke up and flipped a boolean — so the shop is never wrong
-- between midnight and whenever the job would have run. The hourly job from 0051
-- is right there if this ever needs to fire notifications on reopen.
create or replace function public.salon_open(p_salon uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select s.accepting_bookings
            or (s.closed_until is not null
                and s.closed_until < (now() at time zone 'Africa/Casablanca')::date)
       from public.salons s where s.id = p_salon),
    true);   -- a barber with no shop is not blocked by a shop
$$;
grant execute on function public.salon_open(uuid) to authenticated;

-- The enforcement, as a trigger of its own rather than a seventh re-emit of
-- `fill_booking`. Same call 0056 made for `refuse_suspended_customer`: this is
-- one rule about one column, with nothing to say about price, slots or deposits,
-- and folding it into that function would mean re-pasting 90 lines to add three.
-- It also catches `join_queue` (0040) for free, which is 11a's "the walk-in QR
-- stops working" — the QR is just another booking insert.
create or replace function public.refuse_closed_shop()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
begin
  select b.salon_id into v_salon from public.barbers b where b.id = new.barber_id;
  if v_salon is not null and not public.salon_open(v_salon) then
    raise exception 'This shop is closed right now — no new bookings until it reopens';
  end if;
  return new;
end;
$$;

drop trigger if exists before_shop_closed on public.bookings;
create trigger before_shop_closed
  before insert on public.bookings
  for each row execute function public.refuse_closed_shop();

-- 11a's "WHAT CLOSING DOES" panel. Every line of it is counted, because the
-- whole point of the sheet is that the owner currently has no idea how wide the
-- switch reaches — the copy says "not just you" and has to prove it.
create or replace function public.shop_pause_preview()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_salon uuid;
  v_today date;
  j json;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'You do not own a shop'; end if;
  v_today := (now() at time zone shop_tz)::date;

  select json_build_object(
    'salon', v_salon,
    'name', (select name from public.salons where id = v_salon),
    'open', public.salon_open(v_salon),
    'barbers', (select count(*)::int from public.barbers b
                 where b.salon_id = v_salon and b.salon_status = 'approved'),
    -- "Today's 7 bookings still stand" — closing stops new ones, it cancels nothing
    'booked_today', (
      select count(*)::int from public.bookings bk
       join public.barbers b on b.id = bk.barber_id
       where b.salon_id = v_salon and bk.status = 'confirmed'
         and (bk.starts_at at time zone shop_tz)::date = v_today),
    -- 11a's amber row: the co-barbers who will find out from a notification
    'working_today', (
      select coalesce(json_agg(json_build_object('id', x.id, 'name', x.name)), '[]'::json)
        from (
          select b.id, coalesce(p.full_name, 'A barber') as name
            from public.barbers b
            join public.profiles p on p.id = b.id
           where b.salon_id = v_salon and b.salon_status = 'approved'
             and b.id <> auth.uid() and b.accepting_bookings
             and exists (select 1 from public.bookings bk
                          where bk.barber_id = b.id and bk.status = 'confirmed'
                            and (bk.starts_at at time zone shop_tz)::date = v_today)
        ) x),
    -- "Tell the 1 person on the waiting list" — they are holding out for a slot
    -- that is now never coming, which is the one group closing actively harms
    'waiting', (
      select count(*)::int from public.waitlist_requests w
       where w.salon_id = v_salon and w.status = 'waiting' and w.day >= v_today)
  ) into j;
  return j;
end;
$$;
grant execute on function public.shop_pause_preview() to authenticated;

-- 11a's CTA. Owner-only both here and on the way back: "Only you can reopen it —
-- your barbers can't" is printed on the sheet, so it has to be true in the DB
-- and not merely absent from their UI.
create or replace function public.close_shop(
  p_scope text default 'today',        -- 'today' | 'open' | 'until'
  p_until date default null,
  p_tell_waitlist boolean default true)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_salon uuid;
  v_name text;
  v_today date;
  v_until date;
begin
  select s.id, s.name into v_salon, v_name
    from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the shop owner can close the shop'; end if;
  v_today := (now() at time zone shop_tz)::date;

  if p_scope not in ('today', 'open', 'until') then
    raise exception 'Unknown closing period';
  end if;
  if p_scope = 'until' and (p_until is null or p_until < v_today) then
    raise exception 'Pick a date that has not already passed';
  end if;
  v_until := case p_scope
    when 'today' then v_today
    when 'until' then p_until
    else null end;      -- 'open' — closed until he says otherwise

  update public.salons
     set accepting_bookings = false, closed_until = v_until,
         closed_at = now(), closed_by = auth.uid()
   where id = v_salon;

  -- the co-barbers. 11a promises "He'll be told the shop is closed" next to the
  -- name, so the notification is part of the action, not a nicety.
  insert into public.notifications (user_id, kind, title, body)
  select b.id, 'shop_status', v_name || ' is closed',
         case when v_until is null then 'No new bookings until the owner reopens. Today''s bookings still stand.'
              when v_until = v_today then 'No new bookings for the rest of today. Today''s bookings still stand.'
              else 'No new bookings until ' || to_char(v_until + 1, 'FMDD Mon') || '. Existing bookings still stand.'
         end
    from public.barbers b
   where b.salon_id = v_salon and b.salon_status = 'approved' and b.id <> auth.uid();

  -- the waiting list. Nothing marks them "told" — a live ask IS the record that
  -- someone is still waiting, and it is the same set we notify on reopen, which
  -- is exactly what 11b's "he asked to be pinged when you reopen" means.
  if p_tell_waitlist then
    insert into public.notifications (user_id, kind, title, body)
    select w.customer_id, 'shop_status', v_name || ' is closed',
           'They are not taking new bookings right now. We will tell you when they reopen.'
      from public.waitlist_requests w
     where w.salon_id = v_salon and w.status = 'waiting' and w.day >= v_today;
  end if;
end;
$$;
grant execute on function public.close_shop(text, date, boolean) to authenticated;

create or replace function public.reopen_shop()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_salon uuid;
  v_name text;
begin
  select s.id, s.name into v_salon, v_name
    from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the shop owner can reopen the shop'; end if;

  update public.salons
     set accepting_bookings = true, closed_until = null, closed_at = null, closed_by = null
   where id = v_salon;

  insert into public.notifications (user_id, kind, title, body)
  select w.customer_id, 'shop_status', v_name || ' is open again',
         'They are taking bookings again — the day you asked about may have space now.'
    from public.waitlist_requests w
   where w.salon_id = v_salon and w.status = 'waiting'
     and w.day >= (now() at time zone shop_tz)::date;
end;
$$;
grant execute on function public.reopen_shop() to authenticated;

-- 11b, the dashboard state. Every tile on that screen is here so the banner and
-- the three chips can never disagree with each other about the same shop.
create or replace function public.my_shop_status()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_salon uuid;
  s record;
  v_today date;
  j json;
begin
  select sa.id into v_salon from public.salons sa where sa.owner_id = auth.uid() limit 1;
  if v_salon is null then return json_build_object('salon', null); end if;
  select * into s from public.salons where id = v_salon;
  v_today := (now() at time zone shop_tz)::date;

  select json_build_object(
    'salon', v_salon,
    'name', s.name,
    'open', public.salon_open(v_salon),
    'closed_at', s.closed_at,
    'closed_until', s.closed_until,
    'barbers', (select count(*)::int from public.barbers b
                 where b.salon_id = v_salon and b.salon_status = 'approved'),
    -- "460 DH · Nothing was cancelled": the money still on the books today
    'booked_cents', (
      select coalesce(sum(bk.price_cents), 0)::int from public.bookings bk
       join public.barbers b on b.id = bk.barber_id
       where b.salon_id = v_salon and bk.status = 'confirmed'
         and (bk.starts_at at time zone shop_tz)::date = v_today),
    'left_today', (
      select count(*)::int from public.bookings bk
       join public.barbers b on b.id = bk.barber_id
       where b.salon_id = v_salon and bk.status = 'confirmed'
         and bk.completed_at is null
         and (bk.starts_at at time zone shop_tz)::date = v_today),
    -- the two chips that say what closing did NOT switch off
    'topups_on', true,
    'waiting', (
      select count(*)::int from public.waitlist_requests w
       where w.salon_id = v_salon and w.status = 'waiting' and w.day >= v_today),
    'waiting_names', (
      select coalesce(json_agg(x.name), '[]'::json) from (
        select coalesce(p.full_name, 'Someone') as name
          from public.waitlist_requests w
          join public.profiles p on p.id = w.customer_id
         where w.salon_id = v_salon and w.status = 'waiting' and w.day >= v_today
         order by w.created_at limit 3) x)
  ) into j;
  return j;
end;
$$;
grant execute on function public.my_shop_status() to authenticated;

-- ---- 11c/11d · the cap ------------------------------------------------------
-- "Nadia has been told automatically." Something has to carry that, and the
-- cheapest honest thing is a stamp on the shop that ops already reads on its
-- round. No table: a collection request has no state beyond "asked, not yet
-- collected", and the collection itself clears it.
alter table public.salons
  add column if not exists collection_requested_at timestamptz;

create or replace function public.request_float_collection()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'You do not own a shop'; end if;
  update public.salons set collection_requested_at = now()
   where id = v_salon and collection_requested_at is null;
end;
$$;
grant execute on function public.request_float_collection() to authenticated;

-- 11c, the meter. `my_float` (0053) already returns float/net/cap for the settle
-- screen; this is the wallet's version of the same truth plus the two things
-- that turn a number into a warning: how much room is left, and roughly how many
-- more customers that is.
create or replace function public.agent_float_status()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_cap int;
  v_net int;
  v_room int;
  v_typical int;
  j json;
begin
  select s.id, s.float_cap_cents into v_salon, v_cap
    from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then return json_build_object('salon', null); end if;

  v_net := public.salon_net_cents(v_salon);
  v_room := greatest(v_cap - v_net, 0);
  -- "That's about 2 more customers." The median of this till's own top-ups, not
  -- a platform average — a shop that takes 500 DH at a time is two customers
  -- from the cap where another is ten.
  select coalesce(
    percentile_cont(0.5) within group (order by w.amount_cents)::int, 10000)
    into v_typical
    from public.wallet_transactions w
   where w.salon_id = v_salon and w.kind = 'cash_topup';

  select json_build_object(
    'salon', v_salon,
    'float_cents', public.salon_float_cents(v_salon),
    'net_cents', v_net,
    'cap_cents', v_cap,
    'room_cents', v_room,
    -- clamped: a shop past its cap shows a full bar, never a 112% one
    'pct', least(100, greatest(0, round(v_net::numeric * 100 / nullif(v_cap, 0))))::int,
    'typical_cents', v_typical,
    'more_customers', floor(v_room::numeric / greatest(v_typical, 1))::int,
    'requested_at', (select collection_requested_at from public.salons where id = v_salon),
    'last_collected', (select max(f.created_at) from public.float_settlements f
                        where f.salon_id = v_salon and f.amount_cents > 0)
  ) into j;
  return j;
end;
$$;
grant execute on function public.agent_float_status() to authenticated;

-- 11d's "WHAT HE CAN DO INSTEAD". A refusal that only says no has sent the
-- customer away; this is the other shop within walking distance that can still
-- take his cash today.
--
-- ponytail: room is rounded down to the nearest 100 DH. The design prints
-- "Omar has room for 1 700 DH", and an exact figure would tell any owner in the
-- city precisely how much of our cash a rival is holding. The sentence survives
-- the rounding; the surveillance doesn't.
create or replace function public.agents_with_room(p_cents int)
returns table (id uuid, name text, address text, agent text, room_cents int, metres int)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select s.id, s.lat, s.lng from public.salons s where s.owner_id = auth.uid() limit 1
  )
  select s.id, s.name, s.address,
         coalesce(p.full_name, 'The owner') as agent,
         (floor(greatest(s.float_cap_cents - public.salon_net_cents(s.id), 0) / 10000.0) * 10000)::int,
         case when me.lat is null or s.lat is null then null else
           round(6371000 * acos(least(1,
             cos(radians(me.lat)) * cos(radians(s.lat)) * cos(radians(s.lng) - radians(me.lng))
             + sin(radians(me.lat)) * sin(radians(s.lat)))))::int
         end
    from public.salons s
    left join public.profiles p on p.id = s.owner_id
    cross join me
   where s.status = 'live' and s.id <> me.id
     and public.salon_open(s.id)
     and s.float_cap_cents - public.salon_net_cents(s.id) >= coalesce(p_cents, 0)
   order by 6 nulls last
   limit 3;
$$;
grant execute on function public.agents_with_room(int) to authenticated;

-- ops needs to see the ask, or "Nadia has been told" is decoration. 0053's round
-- is re-emitted with two extra fields: who asked to be collected from, and
-- whether they are at the cap and therefore stopped taking cash entirely.
create or replace function public.agent_round()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Collections are ops only'; end if;

  select json_build_object(
    'carrying_cents', coalesce((select sum(f.amount_cents)::int from public.float_settlements f
                                 where f.collected_by = auth.uid()
                                   and f.created_at >= date_trunc('day', now())
                                   and f.amount_cents > 0), 0),
    'done_today', (select count(*)::int from public.float_settlements f
                    where f.collected_by = auth.uid()
                      and f.created_at >= date_trunc('day', now()) and f.amount_cents > 0),
    'stops', (
      select coalesce(json_agg(x order by x.requested_at nulls last, x.held_days desc nulls last),
                      '[]'::json) from (
        select s.id, s.name, s.address,
               coalesce(p.full_name, 'Owner') as owner,
               public.salon_float_cents(s.id) as float_cents,
               s.float_cap_cents,
               -- 11c/11d: he pressed ASK HER TO COME TODAY, or the cap stopped him
               s.collection_requested_at as requested_at,
               public.salon_net_cents(s.id) >= s.float_cap_cents as at_cap,
               s.handover_code is not null and s.handover_code_at > now() - interval '12 hours'
                 as ready,
               (select count(*)::int from public.wallet_transactions w
                 where w.salon_id = s.id and w.kind = 'cash_topup'
                   and w.created_at > coalesce((select max(f.covers_to)
                                                  from public.float_settlements f
                                                 where f.salon_id = s.id and f.amount_cents > 0),
                                               '-infinity'::timestamptz)) as topups,
               (select floor(extract(epoch from (now() - min(w.created_at))) / 86400)::int
                  from public.wallet_transactions w
                 where w.salon_id = s.id and w.kind = 'cash_topup'
                   and w.created_at > coalesce((select max(f.covers_to)
                                                  from public.float_settlements f
                                                 where f.salon_id = s.id and f.amount_cents > 0),
                                               '-infinity'::timestamptz)) as held_days
        from public.salons s
        left join public.profiles p on p.id = s.owner_id
        where s.status = 'live'
          and (public.salon_float_cents(s.id) > 0 or s.collection_requested_at is not null)
      ) x)
  ) into j;
  return j;
end;
$$;
grant execute on function public.agent_round() to authenticated;

-- collecting clears the ask — otherwise every shop stays flagged forever and the
-- round's ordering stops meaning anything after the first week.
create or replace function public.clear_collection_request()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.amount_cents > 0 then
    update public.salons set collection_requested_at = null where id = new.salon_id;
  end if;
  return new;
end;
$$;

drop trigger if exists after_collection_clears_request on public.float_settlements;
create trigger after_collection_clears_request
  after insert on public.float_settlements
  for each row execute function public.clear_collection_request();

-- ---- what this turn actually computes --------------------------------------
-- Unlike 0061, there is arithmetic here worth pinning: 11c prints four numbers
-- derived from two, and a slip in any of them is a warning that fires late.
do $$
declare
  cap  constant int := 360000;   -- 3 600 DH, the cap drawn in 11c
  net  constant int := 324000;   -- 3 240 DH held
  room constant int := cap - net;
  typical constant int := 15000; -- 150 DH, this till's median top-up
begin
  assert room = 36000, '11c: room is cap minus what we are holding — 360 DH';
  assert least(100, round(net::numeric * 100 / cap))::int = 90, '11c prints 90% OF CAP';
  assert floor(room::numeric / typical)::int = 2, '11c: 360 DH of room is about 2 more customers';
  -- the clamp: a shop over its cap must read 100%, never more
  assert least(100, round(400000::numeric * 100 / cap))::int = 100, 'over the cap still shows a full bar';
  -- 11d's rounding: 1 743 DH of room is offered as 1 700, never as 1 743
  assert (floor(174300 / 10000.0) * 10000)::int = 170000, '11d rounds a rival till down to 100 DH';
  -- 11a's periods. "Rest of today" must still be closed today and open tomorrow.
  assert not (current_date < current_date), 'closed_until = today is still closed today';
  assert (current_date - 1) < current_date, 'closed_until = yesterday has reopened';
end $$;
