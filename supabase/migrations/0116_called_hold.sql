-- 0116_called_hold: QL-13 (called, while the page is still open) and the
-- eight-minute chair hold behind it, plus the second text the README promises —
-- the one that goes when the shop closes the line. Needs 0111, 0113 and 0115.
--
-- Decided with the owner (2026-09-16), who took the recommendation:
--
--   · The hold is real and it ends, because QL-13's own copy says so out loud:
--     "After that Youssef takes Nº 08 and you'd rejoin at the back." Eight
--     minutes from the call (ADDENDUM A3), and five more if he asks for them,
--     once. When it lapses the ticket becomes a no-show — QL-14 — which is the
--     same state the barber's own DROP writes, and QL-14 lets him rejoin with no
--     new code. So an automatic release costs one tap, not the morning.
--   · Enforced server-side, not counted down in the browser: `guest_sweep` runs
--     every minute under pg_cron and at the top of every guest call, so a lapsed
--     hold is gone before any page reads it. The countdown only draws it.
--   · "I'M WALKING IN" tells the barber and does NOT stop the clock — nothing
--     would make that true; only he can hold the chair longer. "GIVE ME 5
--     MINUTES" adds five minutes, once, and he sees that too (0114's guest rows).
--   · The called state is 0018's check-in. CALL NEXT already stamps
--     `checked_in_at`, so nothing on the barber's side had to change to fire
--     QL-13 — the page reads the same timestamp the app writes.
--
-- The closed-line text: closing a shop cancels nothing (0064 — "today's bookings
-- still stand"), so the text says exactly that, no new walk-ins and your ticket
-- stands. English, like QL-07's, and ASCII only so it is one send, the same call
-- the owner made on the code text.

-- ---- the columns -------------------------------------------------------------
alter table public.guest_tickets add column if not exists coming_at timestamptz;    -- "I'M WALKING IN"
alter table public.guest_tickets add column if not exists extended_at timestamptz;  -- "GIVE ME 5 MINUTES", once

-- The one answer to "how long is this chair held", so the page's countdown, the
-- sweep that ends it and the barber's row cannot drift apart.
create or replace function public.guest_called_until(p_called timestamptz, p_extended timestamptz)
returns timestamptz
language sql immutable set search_path = ''
as $$
  select case when p_called is null then null
              else p_called + interval '8 minutes'
                   + case when p_extended is not null then interval '5 minutes'
                          else interval '0 minutes' end
         end;
$$;

-- ---- the sweep now ends two holds, not one -----------------------------------
create or replace function public.guest_sweep()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
  m int;
begin
  -- 0111: a place held while the code is untyped, past its five minutes
  with gone as (
    delete from public.bookings b
     using public.guest_tickets gt
     where gt.booking_id = b.id
       and gt.verified_at is null and gt.hold_until < now()
       and b.started_at is null
    returning b.id
  )
  select count(*)::int into n from gone;

  -- QL-13: called, never sat down, the eight minutes gone. no_show rather than
  -- deleted, because the ticket has to be readable afterwards as QL-14 — and
  -- that is exactly what the barber's own DROP writes (0019's mark_no_show).
  with lapsed as (
    update public.bookings b
       set status = 'no_show'
      from public.guest_tickets gt
     where gt.booking_id = b.id
       and gt.verified_at is not null and gt.left_at is null
       and b.status = 'confirmed' and b.started_at is null and b.completed_at is null
       and b.checked_in_at is not null
       and public.guest_called_until(b.checked_in_at, gt.extended_at) < now()
    returning b.id
  )
  select count(*)::int into m from lapsed;

  return n + m;
end;
$$;

-- ---- the ticket: QL-13's stage, its countdown and the two taps ---------------
create or replace function public.queue_ticket_json(p_booking uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  with t as (
    select b.id, b.barber_id, b.starts_at, b.started_at, b.completed_at, b.status, b.price_cents,
           b.service_id, b.created_at as booked_at, b.checked_in_at,
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
    select d.id, d.starts_at, d.started_at, d.completed_at, d.created_at,
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
    'ahead', (select count(*) from day where day.completed_at is null and day.starts_at < t.starts_at)::int,
    -- QL-13's "After that Youssef takes Nº 08": only said when somebody is there to take it
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
    -- the chair hold, and the two things the guest can say about it
    'called_until', case when t.token is not null
                         then public.guest_called_until(t.checked_in_at, t.extended_at) end,
    'coming', t.coming_at is not null,
    'extended', t.extended_at is not null,
    -- QL-13's "We also texted …": true only if 0113 really queued one
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
               -- a guest whose chair is being held right now; an app booking's
               -- check-in is not this state, it has the app for that
               when t.token is not null and t.checked_in_at is not null
                    and public.guest_called_until(t.checked_in_at, t.extended_at) > now() then 'called'
               else 'waiting'
             end)
  from t;
$$;

-- QL-13's "I'M WALKING IN": the barber is told, the clock keeps running. Saying
-- it twice changes nothing.
create or replace function public.guest_coming(p_ticket text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
begin
  perform public.guest_sweep();
  select gt.id, gt.booking_id, gt.coming_at, b.checked_in_at, b.started_at, b.status
    into t
    from public.guest_tickets gt
    join public.bookings b on b.id = gt.booking_id
   where gt.token = btrim(coalesce(p_ticket, '')) and gt.verified_at is not null and gt.left_at is null
   for update of gt;
  if not found or t.status <> 'confirmed' or t.checked_in_at is null or t.started_at is not null then
    return json_build_object('state', 'gone');
  end if;
  update public.guest_tickets set coming_at = coalesce(coming_at, now()) where id = t.id;
  return json_build_object('state', 'coming');
end;
$$;

-- QL-13's "GIVE ME 5 MINUTES": five more minutes on the chair hold, once.
create or replace function public.guest_wait(p_ticket text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
begin
  perform public.guest_sweep();
  select gt.id, gt.extended_at, b.checked_in_at, b.started_at, b.status
    into t
    from public.guest_tickets gt
    join public.bookings b on b.id = gt.booking_id
   where gt.token = btrim(coalesce(p_ticket, '')) and gt.verified_at is not null and gt.left_at is null
   for update of gt;
  if not found or t.status <> 'confirmed' or t.checked_in_at is null or t.started_at is not null then
    return json_build_object('state', 'gone');
  end if;
  if t.extended_at is not null then
    return json_build_object('state', 'used',
      'until', public.guest_called_until(t.checked_in_at, t.extended_at));
  end if;
  update public.guest_tickets set extended_at = now() where id = t.id;
  return json_build_object('state', 'added',
    'until', public.guest_called_until(t.checked_in_at, now()));
end;
$$;

-- ---- the barber's side: what a called guest has said -------------------------
-- 0114's read, plus the call, the hold and the two taps. He is the one who can
-- hold the chair longer, so he has to be able to see what was asked.
--
-- Dropped and recreated, not replaced: four more OUT columns is a new return
-- type, and `create or replace` refuses that. The grant goes with the old
-- function, so it is made again below.
drop function if exists public.barber_guests_today();
create function public.barber_guests_today()
returns table (booking_id uuid, first_name text, phone text, source text,
               joined_at timestamptz, confirmed boolean,
               called_at timestamptz, called_until timestamptz,
               coming_at timestamptz, extended_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select gt.booking_id, gt.first_name, gt.phone, gt.source,
         coalesce(gt.verified_at, gt.created_at), gt.verified_at is not null,
         b.checked_in_at, public.guest_called_until(b.checked_in_at, gt.extended_at),
         gt.coming_at, gt.extended_at
    from public.guest_tickets gt
    join public.bookings b on b.id = gt.booking_id
   where b.barber_id = auth.uid()
     and gt.left_at is null
     and (b.starts_at at time zone 'Africa/Casablanca')::date
         = (now() at time zone 'Africa/Casablanca')::date;
$$;
revoke execute on function public.barber_guests_today() from public, anon;
grant execute on function public.barber_guests_today() to authenticated;

-- ---- the second text: the shop closed the line -------------------------------
-- QL-04 promises "one text when you're next, one if the shop closes the line".
-- This is the second one. No design writes its words: closing cancels nothing,
-- so it says what is still true — no new walk-ins, your ticket stands.
create unique index if not exists sms_outbox_closed_once on public.sms_outbox (booking_id) where kind = 'closed';

create or replace function public.guest_closed_check(p_salon uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_today date := (now() at time zone shop_tz)::date;
  n int;
begin
  if p_salon is null or public.salon_open(p_salon) then return 0; end if;

  with told as (
    insert into public.sms_outbox (kind, to_phone, phone_key, body, booking_id)
    select 'closed', gt.phone, gt.phone_key,
           sa.name || ' has stopped taking new walk-ins. Ticket '
             || lpad((public.queue_ticket_json(b.id) ->> 'no'), 2, '0')
             || ' still stands - come to the chair when your turn comes.',
           b.id
      from public.guest_tickets gt
      join public.bookings b on b.id = gt.booking_id
      join public.barbers bb on bb.id = b.barber_id
      join public.salons sa on sa.id = bb.salon_id
     where bb.salon_id = p_salon
       and gt.verified_at is not null and gt.left_at is null
       and b.status = 'confirmed' and b.started_at is null and b.completed_at is null
       and (b.starts_at at time zone shop_tz)::date = v_today
    on conflict (booking_id) where kind = 'closed' do nothing
    returning id
  )
  select count(*)::int into n from told;
  return n;
end;
$$;

create or replace function public.guest_closed_on_salon()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_was_open boolean;
begin
  -- openness is derived, not stored (0064), so "was open" is read off the old row
  v_was_open := old.accepting_bookings
    or (old.closed_until is not null and old.closed_until < (now() at time zone shop_tz)::date);
  if v_was_open and not public.salon_open(new.id) then
    perform public.guest_closed_check(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists after_salon_closed_tell_guests on public.salons;
create trigger after_salon_closed_tell_guests
  after update of accepting_bookings, closed_until on public.salons
  for each row execute function public.guest_closed_on_salon();

-- ---- who may call what -------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'guest_called_until(timestamptz, timestamptz)', 'guest_coming(text)', 'guest_wait(text)',
    'guest_closed_check(uuid)', 'guest_closed_on_salon()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---- checked at apply time ---------------------------------------------------
do $$
declare
  v_called constant timestamptz := '2026-01-01 10:00:00+00';
  v_body text;
begin
  assert public.guest_called_until(null, null) is null, 'nobody called, nothing held';
  assert public.guest_called_until(v_called, null) = v_called + interval '8 minutes',
    'a called chair is held eight minutes';
  assert public.guest_called_until(v_called, now()) = v_called + interval '13 minutes',
    'five more when he asks for them';
  assert (public.guest_coming('nope') ->> 'state') = 'gone', 'junk walks in nowhere';
  assert (public.guest_wait('nope') ->> 'state') = 'gone', 'junk asks for nothing';
  assert public.guest_closed_check(null) = 0, 'no shop, nobody told';
  assert public.guest_sweep() >= 0, 'the sweep still runs';

  -- the text is one send: 160 GSM-7 characters, and every character ASCII
  v_body := 'Le Fade Tanger has stopped taking new walk-ins. Ticket 07 still stands - '
         || 'come to the chair when your turn comes.';
  assert length(v_body) <= 160, 'the closed-line text is one send: ' || length(v_body);
  assert v_body ~ '^[ -~]+$', 'and nothing in it is outside the GSM alphabet';
end $$;
