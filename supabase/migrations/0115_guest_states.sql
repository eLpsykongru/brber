-- 0115_guest_states: what the server has to keep for the addendum's guest states
-- (ADDENDUM-guest-states, QL-11 … QL-17). Needs 0110, 0111 and 0113.
--
--   · QL-11/12 — a number gets three wrong codes in fifteen minutes, counted per
--     number across every code it was sent (A4 blocker 5). The third lets a held
--     place go and blocks new codes to that number for fifteen minutes. A new code
--     no longer resets the count: in 0111 it did, which turned five tries a text
--     into fifteen a quarter hour.
--   · QL-14 — a guest the barber marks a no-show is "missed": the page says when,
--     and he can rejoin once with no new code, because the number was proven today.
--   · QL-15 — a ticket knows its chair is paused, and since when.
--   · QL-17 — the page knows the shop is shut for the rest of the day, its week of
--     hours, when it next opens, and an open shop nearby. Shut is checked before
--     paused (A2).
-- Not built, waiting on the owner: QL-13's called state and the eight-minute
-- chair hold. Until then nothing anywhere says "eight minutes".

-- ---- the columns -------------------------------------------------------------
create table if not exists public.guest_misses (
  id bigserial primary key,
  phone_key text not null,
  at timestamptz not null default now()
);
create index if not exists guest_misses_phone_idx on public.guest_misses (phone_key, at desc);
alter table public.guest_misses enable row level security;   -- no policies: definers only

alter table public.guest_codes add column if not exists locked_at timestamptz;
alter table public.guest_codes add column if not exists released_no int;      -- QL-12's "We let Nº 07 go"
alter table public.guest_tickets add column if not exists missed_at timestamptz;
alter table public.guest_tickets add column if not exists rejoined_as uuid
  references public.guest_tickets (id) on delete set null;
alter table public.barbers add column if not exists paused_at timestamptz;     -- QL-15's "paused the board at 10:52"

-- A pause is stamped when it starts, whoever flips the switch.
create or replace function public.stamp_barber_pause()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.accepting_bookings is distinct from old.accepting_bookings then
    new.paused_at := case when new.accepting_bookings then null else now() end;
  end if;
  return new;
end;
$$;
drop trigger if exists before_barber_pause_stamp on public.barbers;
create trigger before_barber_pause_stamp
  before update of accepting_bookings on public.barbers
  for each row execute function public.stamp_barber_pause();

create or replace function public.stamp_guest_missed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'no_show' and old.status is distinct from 'no_show' then
    update public.guest_tickets set missed_at = now() where booking_id = new.id and missed_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists after_booking_guest_missed on public.bookings;
create trigger after_booking_guest_missed
  after update of status on public.bookings
  for each row execute function public.stamp_guest_missed();

create or replace function public.guest_misses_now(p_phone_key text)
returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.guest_misses
   where phone_key = p_phone_key and at > now() - interval '15 minutes';
$$;

-- ---- QL-11 / QL-12 -------------------------------------------------------------
-- 0111's limits, with the block in front: fifteen minutes from the third wrong code.
create or replace function public.guest_limit(p_phone_key text, p_ip_hash text)
returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
declare v timestamptz;
begin
  select max(c.locked_at) + interval '15 minutes' into v
    from public.guest_codes c
   where c.phone_key = p_phone_key and c.locked_at > now() - interval '15 minutes';
  if v is not null then return v; end if;

  select min(o.created_at) + interval '15 minutes' into v from (
    select created_at from public.sms_outbox
     where kind = 'code' and phone_key = p_phone_key and created_at > now() - interval '15 minutes'
     order by created_at desc limit 3) o
  having count(*) >= 3;
  if v is not null then return v; end if;

  select min(o.created_at) + interval '1 day' into v from (
    select created_at from public.sms_outbox
     where kind = 'code' and phone_key = p_phone_key and created_at > now() - interval '1 day'
     order by created_at desc limit 8) o
  having count(*) >= 8;
  if v is not null or p_ip_hash is null then return v; end if;

  select min(o.created_at) + interval '1 hour' into v from (
    select created_at from public.sms_outbox
     where kind = 'code' and ip_hash = p_ip_hash and created_at > now() - interval '1 hour'
     order by created_at desc limit 10) o
  having count(*) >= 10;
  if v is not null then return v; end if;

  if (select count(distinct phone_key) from public.sms_outbox
       where kind = 'code' and ip_hash = p_ip_hash and phone_key <> p_phone_key
         and created_at > now() - interval '1 hour') >= 4 then
    return now() + interval '1 hour';
  end if;
  return null;
end;
$$;

-- 0111's, except a new code leaves the count of wrong ones alone
create or replace function public.guest_send(p_session uuid, p_ip_hash text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_digits text := public.guest_digits();
  v_phone text;
  v_key text;
begin
  update public.guest_codes
     set code_hash = public.guest_hash(v_digits || ':' || id::text), sent_at = now()
   where id = p_session
   returning phone, phone_key into v_phone, v_key;
  insert into public.sms_outbox (kind, to_phone, phone_key, ip_hash, body)
  values ('code', v_phone, v_key, p_ip_hash,
          'Sterncut : votre code est ' || v_digits || '. Valable 5 min. Si vous n''avez rien demandé, ignorez ce message.');
end;
$$;

create or replace function public.guest_code_view(p_token text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  c public.guest_codes;
  v_hold jsonb;
  v_misses int;
begin
  select * into c from public.guest_codes where token = btrim(coalesce(p_token, ''));
  if not found then return json_build_object('found', false); end if;
  v_misses := public.guest_misses_now(c.phone_key);
  if c.purpose = 'join' and c.ticket_id is not null then
    v_hold := public.queue_ticket_json((select booking_id from public.guest_tickets where id = c.ticket_id))::jsonb - 'token';
  end if;
  return json_build_object(
    'found', true,
    'purpose', c.purpose,
    'phone', c.phone,
    'resend_at', c.sent_at + interval '30 seconds',
    'expires_at', c.expires_at,
    'expired', c.expires_at < now() or (c.purpose = 'join' and c.ticket_id is null),
    'used', c.used_at is not null,
    'locked', c.locked_at is not null or v_misses >= 3,
    'attempts_left', greatest(0, 3 - v_misses),
    'hold', v_hold,
    'want', c.want,
    'now', now());
end;
$$;

create or replace function public.guest_verify(p_token text, p_code text, p_ip text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  c public.guest_codes;
  v_ticket_token text;
  v_booking uuid;
  v_started timestamptz;
  v_misses int;
  v_no int;
begin
  perform public.guest_sweep();
  select * into c from public.guest_codes where token = btrim(coalesce(p_token, '')) for update;
  if not found then return json_build_object('state', 'gone'); end if;

  if c.used_at is not null then
    if c.purpose = 'join' and c.ticket_id is not null then
      select token into v_ticket_token from public.guest_tickets where id = c.ticket_id;
      return json_build_object('state', 'joined', 'ticket', v_ticket_token, 'shop', c.want ->> 'shop');
    end if;
    return json_build_object('state', 'expired', 'want', c.want);
  end if;
  if c.locked_at is not null then
    return json_build_object('state', 'locked', 'released_no', c.released_no,
                             'retry_at', c.locked_at + interval '15 minutes', 'want', c.want);
  end if;
  if c.expires_at < now() or (c.purpose = 'join' and c.ticket_id is null) then
    return json_build_object('state', 'expired', 'want', c.want);
  end if;
  v_misses := public.guest_misses_now(c.phone_key);
  if v_misses >= 3 then
    return json_build_object('state', 'locked', 'released_no', null, 'want', c.want,
      'retry_at', (select max(locked_at) + interval '15 minutes' from public.guest_codes where phone_key = c.phone_key));
  end if;

  if public.guest_hash(regexp_replace(coalesce(p_code, ''), '\D', '', 'g') || ':' || c.id::text) <> c.code_hash then
    insert into public.guest_misses (phone_key) values (c.phone_key);
    v_misses := v_misses + 1;
    if v_misses < 3 then
      return json_build_object('state', 'wrong', 'attempts_left', 3 - v_misses, 'want', c.want);
    end if;
    -- the third: the held place goes to whoever is behind it, and the number waits
    if c.purpose = 'join' and c.ticket_id is not null then
      select (public.queue_ticket_json(gt.booking_id) ->> 'no')::int into v_no
        from public.guest_tickets gt where gt.id = c.ticket_id and gt.verified_at is null;
      delete from public.bookings b
       using public.guest_tickets gt
       where gt.id = c.ticket_id and gt.booking_id = b.id
         and gt.verified_at is null and b.started_at is null;
    end if;
    update public.guest_codes set locked_at = now(), released_no = v_no where id = c.id;
    return json_build_object('state', 'locked', 'released_no', v_no,
                             'retry_at', now() + interval '15 minutes', 'want', c.want);
  end if;
  update public.guest_codes set used_at = now() where id = c.id;

  if c.purpose = 'join' then
    update public.guest_tickets set verified_at = now(), hold_until = null
     where id = c.ticket_id
     returning token, booking_id into v_ticket_token, v_booking;
    if not exists (select 1 from public.bookings where id = v_booking and status = 'confirmed') then
      return json_build_object('state', 'expired', 'want', c.want);
    end if;
    return json_build_object('state', 'joined', 'ticket', v_ticket_token, 'shop', c.want ->> 'shop');
  end if;

  if c.purpose = 'leave' then
    select gt.booking_id, b.started_at into v_booking, v_started
      from public.guest_tickets gt join public.bookings b on b.id = gt.booking_id
     where gt.id = c.ticket_id;
    if v_started is not null then return json_build_object('state', 'started', 'want', c.want); end if;
    update public.bookings
       set status = 'cancelled', cancel_reason = 'Left the queue'
     where id = v_booking and status = 'confirmed';
    update public.guest_tickets set left_at = now() where id = c.ticket_id;
    return json_build_object('state', 'left', 'want', c.want);
  end if;

  v_booking := coalesce((select booking_id from public.guest_tickets where id = c.ticket_id), c.booking_id);
  return json_build_object(
    'state', 'already',
    'ticket', public.queue_ticket_json(v_booking),
    'guest', c.ticket_id is not null,
    'want', c.want);
end;
$$;

-- ---- the ticket: QL-14's missed, QL-15's paused ----------------------------------
create or replace function public.queue_ticket_json(p_booking uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  with t as (
    select b.id, b.barber_id, b.starts_at, b.started_at, b.completed_at, b.status, b.price_cents,
           b.service_id, b.created_at as booked_at, b.checked_in_at,
           gt.token, gt.first_name, gt.phone, gt.created_at as joined_at, gt.hold_until,
           gt.verified_at, gt.left_at, gt.missed_at, gt.rejoined_as,
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
               else 'waiting'
             end)
  from t;
$$;

-- QL-06 sweeps first now, so a hold that ran out is gone before the page reads it
create or replace function public.guest_ticket(p_token text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_booking uuid;
begin
  perform public.guest_sweep();
  select booking_id into v_booking from public.guest_tickets
   where token = btrim(coalesce(p_token, '')) and verified_at is not null;
  if v_booking is null then return json_build_object('found', false); end if;
  return (public.queue_ticket_json(v_booking)::jsonb || jsonb_build_object('found', true))::json;
end;
$$;

-- QL-14's REJOIN: once, today, for a missed ticket. No code — the number was proven
-- this morning — and still one line at a time.
create or replace function public.guest_rejoin(p_ticket text, p_ip text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_today date := (now() at time zone shop_tz)::date;
  v_ip text := case when nullif(btrim(coalesce(p_ip, '')), '') is null then null
                    else public.guest_hash(btrim(p_ip)) end;
  t record;
  v_holding text;
  v_new uuid;
begin
  perform public.guest_sweep();
  select gt.id, gt.salon_id, gt.phone, gt.phone_key, gt.first_name, gt.source, gt.rejoined_as,
         b.barber_id, b.service_id, b.status, b.starts_at,
         sa.short_code as shop, bb.short_code as barber
    into t
    from public.guest_tickets gt
    join public.bookings b on b.id = gt.booking_id
    join public.salons sa on sa.id = gt.salon_id
    join public.barbers bb on bb.id = b.barber_id
   where gt.token = btrim(coalesce(p_ticket, '')) and gt.verified_at is not null
   for update of gt;
  if not found then return json_build_object('state', 'gone'); end if;
  if t.rejoined_as is not null then
    return json_build_object('state', 'joined', 'shop', t.shop,
      'ticket', (select token from public.guest_tickets where id = t.rejoined_as));
  end if;
  if t.status <> 'no_show' or (t.starts_at at time zone shop_tz)::date <> v_today then
    return json_build_object('state', 'gone', 'want', jsonb_build_object('shop', t.shop, 'barber', t.barber));
  end if;

  select gt.token into v_holding
    from public.guest_tickets gt join public.bookings b on b.id = gt.booking_id
   where gt.phone_key = t.phone_key and gt.verified_at is not null and gt.left_at is null
     and b.status = 'confirmed' and b.completed_at is null
     and (b.starts_at at time zone shop_tz)::date = v_today
   limit 1;
  if v_holding is not null then
    return json_build_object('state', 'joined', 'ticket', v_holding, 'shop', t.shop);
  end if;

  v_new := public.guest_hold(t.salon_id, t.barber_id, t.service_id, t.first_name, t.phone, t.source, v_ip, true);
  if v_new is null then
    return json_build_object('state', 'gone', 'want', jsonb_build_object('shop', t.shop, 'barber', t.barber));
  end if;
  update public.guest_tickets set rejoined_as = v_new where id = t.id;
  return json_build_object('state', 'joined', 'shop', t.shop,
    'ticket', (select token from public.guest_tickets where id = v_new));
end;
$$;

-- ---- QL-17 · the page's read, knowing when the shop is shut ------------------------
-- 0110's public_queue, plus three things: `shut` (every window of every chair is
-- over for today and nothing is opened by hand later), `week` (each weekday's
-- first and last hour across the team — the hours are the barbers', the shop
-- keeps one open–close pair for every day), and `opens` (the next morning a chair
-- works, and whose).
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
  booked as (
    select bk.barber_id,
           (count(*) filter (where bk.completed_at is null))::int as waiting,
           count(*)::int as tickets
      from public.bookings bk
      join team t on t.id = bk.barber_id
     where bk.status = 'confirmed'
       and (bk.starts_at at time zone shop_tz)::date = v_today
     group by bk.barber_id
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
              from menu m where m.barber_id = t.id) as services
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
           'services', c.services)
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

  select json_build_object('days', x.days, 'start_min', x.start_min, 'barber', x.first)
    into v_opens
    from (
      select d.days, a.start_min,
             split_part(coalesce(nullif(btrim(p.full_name), ''), 'Barber'), ' ', 1) as first
        from generate_series(1, 7) d(days)
        join public.availability a on a.weekday = extract(dow from (v_today + d.days))::int
        join public.barbers b on b.id = a.barber_id
        join public.profiles p on p.id = b.id
       where b.salon_id = s.id and b.status = 'approved' and b.salon_status = 'approved'
         and not exists (select 1 from public.days_off o
                          where o.barber_id = b.id and o.day = v_today + d.days)
       order by d.days, a.start_min
       limit 1
    ) x;

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

-- QL-17's "open till 23:00 · 900 m · 2 in line": the nearest live shop within
-- 5 km, of the five closest, that is open and has a chair taking walk-ins. A
-- hidden shop is never suggested. Null when there is none.
create or replace function public.nearby_open_shop(p_shop text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  me record;
  cand record;
  q json;
  best json;
begin
  select sa.id, sa.lat, sa.lng into me from public.salons sa
   where sa.short_code = upper(btrim(coalesce(p_shop, ''))) and sa.status in ('live', 'suspended');
  if not found or me.lat is null or me.lng is null then return null; end if;

  for cand in
    select x.short_code, x.name, x.meters from (
      select sa.short_code, sa.name,
             (6371000 * 2 * asin(sqrt(
                power(sin(radians((sa.lat - me.lat)::float8) / 2), 2)
                + cos(radians(me.lat::float8)) * cos(radians(sa.lat::float8))
                  * power(sin(radians((sa.lng - me.lng)::float8) / 2), 2))))::int as meters
        from public.salons sa
       where sa.status = 'live' and sa.id <> me.id and sa.lat is not null and sa.lng is not null
    ) x
    where x.meters <= 5000
    order by x.meters
    limit 5
  loop
    q := public.public_queue(cand.short_code);
    continue when not coalesce((q ->> 'open')::boolean, false) or coalesce((q ->> 'shut')::boolean, true);
    select json_build_object(
             'code', cand.short_code, 'name', cand.name, 'meters', cand.meters,
             'waiting', (ch.value ->> 'waiting')::int, 'wait_min', ch.wait,
             'until_min', coalesce((q ->> 'close_min')::int,
                                   (select (w.value ->> 'close_min')::int
                                      from json_array_elements(q -> 'week') w
                                     where (w.value ->> 'dow')::int = extract(dow from (now() at time zone shop_tz))::int)))
      into best
      from (select c.value,
                   (select min((sv.value ->> 'wait_min')::int)
                      from json_array_elements(c.value -> 'services') sv
                     where sv.value ->> 'wait_min' is not null) as wait
              from json_array_elements(q -> 'chairs') c
             where c.value ->> 'state' = 'taking') ch
     where ch.wait is not null
     order by ch.wait
     limit 1;
    if best is not null then return best; end if;
  end loop;
  return null;
end;
$$;

-- ---- who may call what -------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'guest_misses_now(text)', 'guest_rejoin(text, text)', 'stamp_guest_missed()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke execute on function public.stamp_barber_pause() from public, anon, authenticated;
grant execute on function public.nearby_open_shop(text) to anon, authenticated;

-- ---- checked at apply time ---------------------------------------------------
do $$
begin
  assert (public.public_queue('not a code') ->> 'found')::boolean is false, 'junk still finds no shop';
  assert public.nearby_open_shop('ZZZZZZ') is null, 'no shop, nothing nearby';
  assert public.guest_misses_now('000000000') = 0, 'nobody has missed on a number nobody used';
  assert public.guest_limit('000000000', null) is null, 'an unused number is not blocked';
  assert (public.guest_rejoin('nope', null) ->> 'state') = 'gone', 'junk rejoins nothing';
  assert (public.guest_ticket('nope') ->> 'found')::boolean is false, 'junk still opens no ticket';
end $$;
