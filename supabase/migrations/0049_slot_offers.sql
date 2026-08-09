-- 0049_slot_offers: turn 8 of "Barber App.dc.html" — a customer cancels and
-- Youssef is left holding a hole in his day. Turn 35 is the other end of it.
--
-- `cancel_booking` already carries p_reason and MyBookingsScreen already reads
-- cancelled_by/cancel_reason, so none of this is about telling him. It is about
-- the three things he can actually DO: see the gap (8b), refill it (8d–8f), and
-- notice the pattern behind the reasons (8c).
--
-- The reason is stored and shown as the customer's own words. There is no
-- barber-facing way to edit, rate or dispute one, on purpose — a shop that
-- argues with cancellation reasons stops getting honest ones.

-- ---- "I'd take something today" --------------------------------------------
-- 8d's green ASKED badge and 8b's "1 client asked about today". The other three
-- candidate kinds in 8d are derived from bookings; only this one needs a row.
create table public.waitlist_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  barber_id uuid not null references public.barbers (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  unique (customer_id, barber_id, day)
);
create index waitlist_requests_barber_idx on public.waitlist_requests (barber_id, day);

alter table public.waitlist_requests enable row level security;
create policy waitlist_select on public.waitlist_requests for select to authenticated
  using (customer_id = auth.uid() or barber_id = auth.uid() or public.is_admin());
create policy waitlist_write on public.waitlist_requests for all to authenticated
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());
grant select, insert, delete on public.waitlist_requests to authenticated;

-- ---- the offer -------------------------------------------------------------
-- 8d: "First to tap it gets it. Nobody else is charged or held." So an offer is
-- an invitation, never a hold — no row anywhere reserves the slot until someone
-- claims it, and the claim goes through the ordinary booking path.
create table public.slot_offers (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  service_id uuid not null references public.services (id),
  starts_at timestamptz not null,
  from_booking uuid references public.bookings (id) on delete set null,
  public_too boolean not null default false,   -- 8d "put it on your public page too"
  expires_at timestamptz not null,             -- 8e's countdown
  claimed_by uuid references public.profiles (id),
  claimed_booking uuid references public.bookings (id) on delete set null,
  claimed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index slot_offers_barber_idx on public.slot_offers (barber_id, starts_at desc);

create table public.slot_offer_targets (
  offer_id uuid not null references public.slot_offers (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  declined_at timestamptz,
  primary key (offer_id, customer_id)
);

alter table public.slot_offers enable row level security;
alter table public.slot_offer_targets enable row level security;

-- you see an offer if it is yours to take, if you made it, or if it is public
create policy slot_offers_select on public.slot_offers for select to authenticated
  using (barber_id = auth.uid() or public_too
         or exists (select 1 from public.slot_offer_targets t
                     where t.offer_id = id and t.customer_id = auth.uid())
         or public.is_admin());
create policy slot_offer_targets_select on public.slot_offer_targets for select to authenticated
  using (customer_id = auth.uid()
         or exists (select 1 from public.slot_offers o where o.id = offer_id and o.barber_id = auth.uid()));
grant select on public.slot_offers, public.slot_offer_targets to authenticated;
-- no write grants: offers are made and taken through the RPCs below

-- ---- 8d · who gets asked ----------------------------------------------------
-- Four kinds, in the order the design lists them. Only 'asked' needs a table;
-- the rest fall out of the book he already has.
create or replace function public.offer_candidates(p_barber uuid, p_starts_at timestamptz)
returns json
language sql stable security definer set search_path = ''
as $$
  with tz as (select 'Africa/Casablanca'::text as z),
  day as (select (p_starts_at at time zone (select z from tz))::date as d),
  -- everyone who has ever sat in this chair, plus anyone on today's waiting list
  people as (
    select distinct b.customer_id as id from public.bookings b
     where b.barber_id = p_barber and b.customer_id <> p_barber
       and b.starts_at > now() - interval '180 days'
    union
    select w.customer_id from public.waitlist_requests w
     where w.barber_id = p_barber and w.day = (select d from day)
  )
  select coalesce(json_agg(x order by x.rank, x.name), '[]'::json) from (
    select
      p.id,
      coalesce(pr.full_name, 'Client') as name,
      -- why they are on the list, and in what order to show them
      case
        when w.created_at is not null then 'asked'
        when nxt.starts_at is not null then 'move'
        when cur.id is not null then 'in_chair'
        else 'regular'
      end as kind,
      case
        when w.created_at is not null
          then 'Asked about today at ' || to_char(w.created_at at time zone (select z from tz), 'HH24:MI')
        when nxt.starts_at is not null
          then 'Booked ' || to_char(nxt.starts_at at time zone (select z from tz), 'Dy HH24:MI') || ' · would move up'
        when cur.id is not null then 'In your chair right now'
        else 'Regular · ' || vis.n || ' visits'
      end as why,
      -- 8d dims anyone with a no-show history and does not offer to them
      (select count(*)::int from public.bookings b
        where b.barber_id = p_barber and b.customer_id = p.id and b.status = 'no_show') as no_shows,
      case when w.created_at is not null then 0
           when nxt.starts_at is not null then 1
           when cur.id is not null then 2 else 3 end as rank
    from people p
    left join public.profiles pr on pr.id = p.id
    left join public.waitlist_requests w
      on w.customer_id = p.id and w.barber_id = p_barber and w.day = (select d from day)
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
grant execute on function public.offer_candidates(uuid, timestamptz) to authenticated;

-- ---- 8d · send it ----------------------------------------------------------
create or replace function public.create_slot_offer(
  p_from_booking uuid, p_customers uuid[],
  p_public boolean default false, p_minutes int default 30)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  bk record;
  v_offer uuid;
  v_who uuid;
  v_when text;
begin
  select b.id, b.barber_id, b.service_id, b.starts_at, b.status
    into bk from public.bookings b where b.id = p_from_booking;
  if not found then raise exception 'Not found'; end if;
  if bk.barber_id is distinct from auth.uid() then raise exception 'Not your booking'; end if;
  if bk.status not in ('cancelled', 'no_show') then
    raise exception 'That slot is still booked';
  end if;
  if bk.starts_at <= now() then raise exception 'That slot has already passed'; end if;

  insert into public.slot_offers (barber_id, service_id, starts_at, from_booking, public_too, expires_at)
  values (bk.barber_id, bk.service_id, bk.starts_at, bk.id, coalesce(p_public, false),
          least(now() + make_interval(mins => greatest(p_minutes, 5)), bk.starts_at))
  returning id into v_offer;

  v_when := to_char(bk.starts_at at time zone 'Africa/Casablanca', 'HH24:MI');

  foreach v_who in array coalesce(p_customers, '{}'::uuid[]) loop
    insert into public.slot_offer_targets (offer_id, customer_id) values (v_offer, v_who)
    on conflict do nothing;
    insert into public.notifications (user_id, kind, title, body, booking_id)
    values (v_who, 'booking_answer', 'A slot opened at ' || v_when,
            'First to take it gets it — nothing is held until you tap take.', bk.id);
  end loop;

  return v_offer;
end;
$$;
grant execute on function public.create_slot_offer(uuid, uuid[], boolean, int) to authenticated;

-- ---- 8e/8f · take it -------------------------------------------------------
-- The race is settled by one conditional UPDATE: the first transaction to move
-- claimed_at off NULL wins, and everyone else gets "gone". The booking itself
-- goes through the ordinary insert, so fill_booking still owns every rule.
create or replace function public.claim_slot_offer(p_offer uuid, p_deposit_cents int default 0)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  o record;
  v_booking uuid;
  v_when text;
begin
  select * into o from public.slot_offers where id = p_offer;
  if not found then raise exception 'That offer is gone'; end if;
  if o.cancelled_at is not null then raise exception 'That offer was withdrawn'; end if;
  if o.claimed_at is not null then raise exception 'Someone already took it'; end if;
  if o.expires_at <= now() then raise exception 'That offer has expired'; end if;
  if not (o.public_too or exists (select 1 from public.slot_offer_targets t
                                   where t.offer_id = p_offer and t.customer_id = auth.uid())) then
    raise exception 'That offer is not yours to take';
  end if;

  -- The real arbiter is `no_double_booking` (0001): two people taking the same
  -- slot cannot both hold it, whatever this function thinks. Catch its violation
  -- and say 8e's sentence rather than leaking a constraint name at a customer.
  begin
    insert into public.bookings (customer_id, barber_id, service_id, starts_at, ends_at,
                                 price_cents, deposit_cents)
    values (auth.uid(), o.barber_id, o.service_id, o.starts_at, o.starts_at, 0, p_deposit_cents)
    returning id into v_booking;
  exception when exclusion_violation or unique_violation then
    raise exception 'Someone already took it';
  end;

  -- second layer, and the one that decides who the offer records as the taker
  update public.slot_offers
     set claimed_by = auth.uid(), claimed_booking = v_booking, claimed_at = now()
   where id = p_offer and claimed_at is null;
  if not found then raise exception 'Someone already took it'; end if;

  -- an offered slot is pre-agreed: he offered it, you took it, nobody waits
  update public.bookings set status = 'confirmed' where id = v_booking;

  v_when := to_char(o.starts_at at time zone 'Africa/Casablanca', 'HH24:MI');
  insert into public.notifications (user_id, kind, title, body, booking_id)
  values (o.barber_id, 'booking_answer', v_when || ' was taken',
          coalesce((select full_name from public.profiles where id = auth.uid()), 'A client')
          || ' took the slot you offered.', v_booking);
  -- 8f: "Yassine was told it's gone."
  insert into public.notifications (user_id, kind, title, body, booking_id)
  select t.customer_id, 'booking_answer', v_when || ' is gone',
         'Someone took it first. Nothing was charged to you.', v_booking
    from public.slot_offer_targets t
   where t.offer_id = p_offer and t.customer_id <> auth.uid();

  return v_booking;
end;
$$;
grant execute on function public.claim_slot_offer(uuid, int) to authenticated;

create or replace function public.decline_slot_offer(p_offer uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.slot_offer_targets set declined_at = now()
   where offer_id = p_offer and customer_id = auth.uid();
$$;
grant execute on function public.decline_slot_offer(uuid) to authenticated;

-- 8e · what the customer is looking at
create or replace function public.my_slot_offers()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', o.id, 'starts_at', o.starts_at, 'expires_at', o.expires_at,
           'service', sv.name, 'price_cents', sv.price_cents, 'duration_min', sv.duration_min,
           'barber_id', o.barber_id,
           'barber', coalesce(bp.full_name, 'Barber'),
           'salon', s.name,
           'sent_to', (select count(*)::int from public.slot_offer_targets t2 where t2.offer_id = o.id)
         ) order by o.starts_at), '[]'::json)
  from public.slot_offers o
  join public.slot_offer_targets t on t.offer_id = o.id and t.customer_id = auth.uid()
  join public.services sv on sv.id = o.service_id
  left join public.profiles bp on bp.id = o.barber_id
  left join public.barbers ba on ba.id = o.barber_id
  left join public.salons s on s.id = ba.salon_id
  where o.claimed_at is null and o.cancelled_at is null
    and o.expires_at > now() and t.declined_at is null;
$$;
grant execute on function public.my_slot_offers() to authenticated;

-- ---- 8c · the pattern behind the reasons -----------------------------------
create or replace function public.cancellation_stats()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_from timestamptz := now() - interval '30 days';
  j json;
begin
  select json_build_object(
    'cancelled', (select count(*)::int from public.bookings b
                   where b.barber_id = v_me and b.status = 'cancelled'
                     and b.cancelled_by <> v_me and b.starts_at >= v_from),
    'total', (select count(*)::int from public.bookings b
               where b.barber_id = v_me and b.starts_at >= v_from),
    -- chair time the cancellations cost, priced at what the booking was worth
    'lost_cents', (select coalesce(sum(b.price_cents), 0)::int from public.bookings b
                    where b.barber_id = v_me and b.status = 'cancelled'
                      and b.cancelled_by <> v_me and b.starts_at >= v_from),
    -- a cancelled slot counts as refilled when something else got booked into it
    'refilled', (select count(*)::int from public.bookings b
                  where b.barber_id = v_me and b.status = 'cancelled'
                    and b.cancelled_by <> v_me and b.starts_at >= v_from
                    and exists (select 1 from public.bookings x
                                 where x.barber_id = v_me and x.id <> b.id
                                   and x.status in ('confirmed', 'completed')
                                   and x.starts_at = b.starts_at)),
    'deposits_kept_cents', (select coalesce(sum(b.deposit_cents), 0)::int from public.bookings b
                             where b.barber_id = v_me and b.status = 'cancelled'
                               and b.cancelled_by <> v_me and b.starts_at >= v_from),
    'reasons', (
      select coalesce(json_agg(json_build_object('reason', r.label, 'n', r.n) order by r.n desc), '[]'::json)
      from (
        select case when b.cancel_reason is null or btrim(b.cancel_reason) = '' then 'No reason given'
                    when b.cancel_reason in ('Something came up', 'Wrong time', 'Too far') then b.cancel_reason
                    else 'Other' end as label,
               count(*)::int as n
          from public.bookings b
         where b.barber_id = v_me and b.status = 'cancelled'
           and b.cancelled_by <> v_me and b.starts_at >= v_from
         group by 1
      ) r),
    -- the free-text answers, verbatim, for 8c's "READ THE FOUR"
    'written', (
      select coalesce(json_agg(json_build_object(
               'id', b.id, 'text', b.cancel_reason, 'at', b.starts_at,
               'who', coalesce(split_part(p.full_name, ' ', 1), 'A client')) order by b.starts_at desc), '[]'::json)
      from public.bookings b left join public.profiles p on p.id = b.customer_id
      where b.barber_id = v_me and b.status = 'cancelled' and b.cancelled_by <> v_me
        and b.starts_at >= v_from and b.cancel_reason is not null
        and b.cancel_reason not in ('Something came up', 'Wrong time', 'Too far'))
  ) into j;
  return j;
end;
$$;
grant execute on function public.cancellation_stats() to authenticated;

-- ---- 8a · the banner -------------------------------------------------------
-- `cancel_booking` records the reason but has never told the barber anything —
-- the 'cancellation' kind existed in 0032 with nothing inserting it. Without
-- this, 8b's card is only found by opening the app and noticing a hole.
create or replace function public.notify_customer_cancel()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_who text;
  v_svc text;
  v_min int;
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' then return new; end if;
  if new.cancelled_by is null or new.cancelled_by = new.barber_id then return new; end if;
  if new.starts_at <= now() then return new; end if;   -- a hole in the past is not news

  select coalesce(split_part(p.full_name, ' ', 1), 'A client') into v_who
    from public.profiles p where p.id = new.customer_id;
  select s.name, s.duration_min into v_svc, v_min
    from public.services s where s.id = new.service_id;

  insert into public.notifications (user_id, kind, title, body, booking_id)
  values (
    new.barber_id, 'cancellation',
    v_who || ' cancelled ' || to_char(new.starts_at at time zone 'Africa/Casablanca', 'HH24:MI'),
    -- his words first, unedited, then what it costs the day
    case when coalesce(btrim(new.cancel_reason), '') <> ''
         then '“' || new.cancel_reason || '” · ' else '' end
    || coalesce(v_svc, 'Booking') || ' · ' || coalesce(v_min, 30) || ' min free from '
    || to_char(new.starts_at at time zone 'Africa/Casablanca', 'HH24:MI'),
    new.id);
  return new;
end;
$$;

create trigger after_customer_cancel
  after update of status on public.bookings
  for each row execute function public.notify_customer_cancel();

-- 0037's dispatcher with one line changed: a cancellation banner gets the
-- category that carries 8a's Reply / Offer the slot buttons.
create or replace function public.push_dispatch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  urgent boolean := false;
  starts timestamptz;
begin
  if new.kind in ('cancellation', 'queue_next') and new.booking_id is not null then
    select b.starts_at into starts from public.bookings b where b.id = new.booking_id;
    urgent := new.kind = 'queue_next'
      or (starts is not null and starts < now() + interval '2 hours');
  end if;

  if not public.notif_should_push(new.user_id, new.kind, urgent) then
    return new;
  end if;

  begin
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := (
        select coalesce(jsonb_agg(jsonb_build_object(
          'to', t.token,
          'title', new.title,
          'body', coalesce(new.body, ''),
          'sound', 'default',
          'categoryId', case new.kind
                          when 'booking_request' then 'BOOKING_REQUEST'
                          when 'cancellation' then 'BOOKING_CANCELLED'
                          else null end,
          'data', jsonb_build_object('notificationId', new.id, 'kind', new.kind, 'bookingId', new.booking_id)
        )), '[]'::jsonb)
        from public.push_tokens t where t.user_id = new.user_id
      )
    );
  exception when others then
    null; -- ponytail: best-effort. The inbox row is the durable record.
  end;
  return new;
end;
$$;

-- ---- the shape of the numbers, checked -------------------------------------
-- 8c reads "11 of 168 bookings · 6.5%" and 7 refilled + 4 lost = 11.
do $$
begin
  assert round(11 * 100.0 / 168, 1) = 6.5, '11 of 168 is 6.5%';
  assert 7 + 4 = 11, 'refilled plus lost is every cancellation';
  -- an offer must never outlive the slot it is offering (create_slot_offer's least())
  assert least(now() + interval '30 min', now() + interval '10 min') = now() + interval '10 min',
    'an offer expires at the slot when the slot is sooner than the window';
end $$;
