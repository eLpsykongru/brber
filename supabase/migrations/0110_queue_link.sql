-- 0110_queue_link: the public queue page, step 1 — a scanned poster shows a real
-- wait before anything can be written.
--
-- Every poster since 0031 prints https://sterncut.ma/q/<salon uuid>, and nothing
-- served it. Three things were missing before anything could:
--
--   · A code a person can type. The app already tells a customer whose camera is
--     blocked to "type the code under the QR" (Failures.tsx, 38b), and no such
--     code existed. `salons.short_code` is six characters; `barbers.short_code`
--     is four, for a barber's own link (`?b=`). The alphabet has no I, O, 0 or 1,
--     so nothing printed under a poster reads as its twin.
--   · A read anon can make that says only what the page draws.
--     `salon_queue_estimate` (0040) is already callable by anon — PUBLIC keeps
--     EXECUTE whatever the grant line says — but it returns full names and none
--     of what QL-03/QL-08/QL-09 need. `public_queue` returns first names, counts,
--     minutes, ticket numbers, the menu and whether the shop is open. Nothing
--     about any customer.
--   · One answer to "when would a walk-in start". `walk_in_start` is it, and the
--     guest join (step 2) will call the same function, so the wait the page
--     quotes and the place the join gives cannot drift apart.

-- ---- the codes ---------------------------------------------------------------
-- random(), not pgcrypto, for the reason 0090 gives: gen_random_bytes lives in
-- the extensions schema and these functions run with an empty search_path. A
-- shop code is printed on a wall — guessing it is not an attack.
create or replace function public.new_link_code(p_len int)
returns text
language plpgsql volatile set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v text := '';
begin
  for i in 1..p_len loop
    v := v || substr(alphabet, 1 + floor(random() * 32)::int, 1);
  end loop;
  return v;
end;
$$;

-- security definer so the uniqueness check sees every row: salons RLS hides
-- pending shops from the owner inserting a new one, and a code he could not see
-- is a code he could collide with.
create or replace function public.new_salon_code()
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare v text;
begin
  loop
    v := public.new_link_code(6);
    exit when not exists (select 1 from public.salons where short_code = v);
  end loop;
  return v;
end;
$$;

create or replace function public.new_barber_code()
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare v text;
begin
  loop
    v := public.new_link_code(4);
    exit when not exists (select 1 from public.barbers where short_code = v);
  end loop;
  return v;
end;
$$;

alter table public.salons add column if not exists short_code text;
alter table public.barbers add column if not exists short_code text;

-- one row at a time: the generator checks the very column it is filling. The
-- only update trigger on either table (0025's membership guard) acts on a
-- changed salon_id, which this never touches.
do $$
declare r record;
begin
  for r in select id from public.salons where short_code is null loop
    update public.salons set short_code = public.new_salon_code() where id = r.id;
  end loop;
  for r in select id from public.barbers where short_code is null loop
    update public.barbers set short_code = public.new_barber_code() where id = r.id;
  end loop;
end $$;

alter table public.salons alter column short_code set default public.new_salon_code();
alter table public.salons alter column short_code set not null;
alter table public.barbers alter column short_code set default public.new_barber_code();
alter table public.barbers alter column short_code set not null;

create unique index if not exists salons_short_code_key on public.salons (short_code);
create unique index if not exists barbers_short_code_key on public.barbers (short_code);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'salons_short_code_shape') then
    alter table public.salons add constraint salons_short_code_shape
      check (short_code ~ '^[A-HJ-NP-Z2-9]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'barbers_short_code_shape') then
    alter table public.barbers add constraint barbers_short_code_shape
      check (short_code ~ '^[A-HJ-NP-Z2-9]{4}$');
  end if;
end $$;

-- ---- when would a walk-in start ---------------------------------------------
-- The moment a walk-in having a `p_minutes` service would start with this
-- barber if he joined the back of today's line now. Null when the chair cannot
-- take him today. The rules are fill_booking's (0055) for a real customer, read
-- in the order that trigger reads them:
--   · time he opened by hand (0052's 'open' block) takes the sitting whatever
--     else the day says;
--   · otherwise a day off refuses, and the whole sitting must sit inside one
--     window of his weekly hours;
--   · a break in the way is stepped over, and his cleaning time follows the
--     last booking.
-- The back of the line is 0040's rule, kept: the end of the last live booking
-- today, so a walk-in joins behind everyone already in the day — including an
-- appointment later on. Whether the barber or the shop is taking anyone at all
-- is the caller's question; this only answers "when".
create or replace function public.walk_in_start(p_barber uuid, p_minutes int)
returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';   -- ponytail: single-city, like fill_booking
  v_today date := (now() at time zone shop_tz)::date;
  v_dow int := extract(dow from (now() at time zone shop_tz))::int;
  v_off boolean;
  v_gap int;
  v_tail timestamptz;
  v_start timestamptz;
  v_min int;
  v_jump int;
begin
  if p_minutes is null or p_minutes <= 0 then return null; end if;

  select b.buffer_before_min + b.buffer_after_min into v_gap
    from public.barbers b where b.id = p_barber;
  if not found then return null; end if;

  v_off := exists (select 1 from public.days_off d
                    where d.barber_id = p_barber and d.day = v_today);

  -- pending requests count: they hold their slot under no_double_booking (0015)
  select max(bk.ends_at) into v_tail
    from public.bookings bk
   where bk.barber_id = p_barber
     and bk.status in ('pending', 'confirmed')
     and (bk.starts_at at time zone shop_tz)::date = v_today;

  v_start := greatest(now() + interval '1 minute',
                      coalesce(v_tail + make_interval(mins => v_gap), now()));
  -- whole minutes, because fill_booking measures a start as hour*60 + minute
  v_start := date_trunc('minute', v_start + interval '59 seconds');

  for i in 1..24 loop
    if (v_start at time zone shop_tz)::date <> v_today then return null; end if;
    v_min := extract(hour from (v_start at time zone shop_tz))::int * 60
           + extract(minute from (v_start at time zone shop_tz))::int;
    if v_min + p_minutes > 1440 then return null; end if;

    if exists (select 1 from public.time_blocks tb
                where tb.barber_id = p_barber and tb.kind = 'open' and tb.day = v_today
                  and tb.start_min <= v_min and tb.end_min >= v_min + p_minutes) then
      return v_start;
    end if;

    select max(tb.end_min) into v_jump
      from public.time_blocks tb
     where tb.barber_id = p_barber and tb.kind = 'block'
       and (tb.day is null or tb.day = v_today)
       and tb.start_min < v_min + p_minutes and tb.end_min > v_min;

    if v_jump is null then
      if not v_off and exists (select 1 from public.availability a
                                where a.barber_id = p_barber and a.weekday = v_dow
                                  and a.start_min <= v_min
                                  and a.end_min >= v_min + p_minutes) then
        return v_start;
      end if;
      -- outside his hours, or the sitting runs past their end: the next time the
      -- chair opens today, if it does
      select min(x.m) into v_jump from (
        select a.start_min as m from public.availability a
         where not v_off and a.barber_id = p_barber and a.weekday = v_dow
           and a.start_min > v_min
        union all
        select tb.start_min from public.time_blocks tb
         where tb.barber_id = p_barber and tb.kind = 'open' and tb.day = v_today
           and tb.start_min > v_min
      ) x;
      if v_jump is null then return null; end if;
    end if;

    v_start := (v_today + make_interval(mins => v_jump)) at time zone shop_tz;
  end loop;
  return null;
end;
$$;
revoke execute on function public.walk_in_start(uuid, int) from public, anon, authenticated;

-- ---- the page's one read -----------------------------------------------------
-- QL-08 (the poster: pick a chair), QL-03 (a chair's own link) and QL-09 (the
-- line is closed) draw from this and nothing else. Anon calls it, so every
-- field is one of the designs': first name and an initial, counts, minutes,
-- ticket numbers, the menu with prices, rating and cuts, opening hours.
create or replace function public.public_queue(p_shop text, p_barber text default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_today date := (now() at time zone shop_tz)::date;
  v_dow int := extract(dow from (now() at time zone shop_tz))::int;
  v_shop text := btrim(coalesce(p_shop, ''));
  v_pick text := btrim(coalesce(p_barber, ''));
  s record;
  v_open boolean;
  v_chosen text;
  v_chairs json;
begin
  -- A shop hidden from search still takes walk-ins — 0058 hides it "bookings
  -- untouched", and barber 10e tells its owner "walk-ins and the QR still work" —
  -- so 'suspended' answers. A shop nobody approved does not. Why a shop is
  -- hidden is never said here, or anywhere a customer reads.
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
  -- the ticket number is the position in the day, the same count barber_day_queue
  -- (0029) numbers by: every confirmed booking today, done ones included
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

  return json_build_object(
    'found', true,
    'code', s.short_code,
    'name', s.name,
    'address', s.address,
    'close_min', case when s.close_min < 1440 then s.close_min end,
    'open', v_open,
    'closed_at', case when not v_open then s.closed_at end,
    'chosen', v_chosen,
    'now', now(),
    'chairs', v_chairs);
end;
$$;
grant execute on function public.public_queue(text, text) to anon, authenticated;

-- The app's scanner (27a) works in uuids from the sheet onwards; this turns the
-- six characters a person typed into them. It answers for exactly the shops the
-- page answers for.
create or replace function public.resolve_shop_code(p_shop text, p_barber text default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_shop text := btrim(coalesce(p_shop, ''));
  v_pick text := btrim(coalesce(p_barber, ''));
  v_salon uuid;
  v_barber uuid;
begin
  if v_shop ~* uuid_re then
    select sa.id into v_salon from public.salons sa
     where sa.id = lower(v_shop)::uuid and sa.status in ('live', 'suspended');
  else
    select sa.id into v_salon from public.salons sa
     where sa.short_code = upper(v_shop) and sa.status in ('live', 'suspended');
  end if;
  if v_salon is null then
    return json_build_object('salon', null, 'barber', null);
  end if;

  if v_pick ~* uuid_re then
    select b.id into v_barber from public.barbers b
     where b.id = lower(v_pick)::uuid and b.salon_id = v_salon;
  elsif v_pick <> '' then
    select b.id into v_barber from public.barbers b
     where b.short_code = upper(v_pick) and b.salon_id = v_salon;
  end if;
  return json_build_object('salon', v_salon, 'barber', v_barber);
end;
$$;
grant execute on function public.resolve_shop_code(text, text) to authenticated;

-- ---- checked at apply time ---------------------------------------------------
do $$
declare v text;
begin
  for i in 1..50 loop
    v := public.new_link_code(6);
    assert v ~ '^[A-HJ-NP-Z2-9]{6}$', 'a shop code is six characters with no I, O, 0 or 1';
    v := public.new_link_code(4);
    assert v ~ '^[A-HJ-NP-Z2-9]{4}$', 'a barber code is four of the same';
  end loop;
  assert not exists (select 1 from public.salons where short_code is null), 'every shop has a code';
  assert not exists (select 1 from public.barbers where short_code is null), 'every barber has a code';
  assert (public.public_queue('not a code') ->> 'found')::boolean is false, 'junk finds no shop';
  assert (public.resolve_shop_code('not a code') ->> 'salon') is null, 'junk resolves to nothing';
  assert public.walk_in_start('00000000-0000-0000-0000-000000000000', 30) is null, 'no barber, no start';
  assert public.walk_in_start('00000000-0000-0000-0000-000000000000', 0) is null, 'no sitting, no start';
end $$;
