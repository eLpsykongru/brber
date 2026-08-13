-- 0071_admin_range_search_settle: the three section-B gaps that were real.
--
-- Section B was the list of console controls with no backend at all. Working
-- through it, two of the seven dissolved and two more turned out to be product
-- decisions rather than missing code:
--   · "Hide him from search" was never a barber flag — 0066 derives
--     `shop_hidden` from the salon, so it is admin_salon_decide, wired in turn 9.
--   · The float cap already existed as a column; 0069 gave it its setter.
--   · Per-district reliability is NOT here: platform_settings is global and
--     `mark_late_arrival` reads it globally, so a per-district row would be a
--     setting the engine ignores. A dial that lies is worse than a dead one.
--   · The notification bell has no feed behind it and no design saying what
--     belongs in one. Inventing that is a product call, not a migration.
--
-- What is left is these three.

-- ---- 1a · the date range ----------------------------------------------------
-- The "Last 7 days" control has been decoration since 1a because the read had
-- no argument to give it. The window drove three variables and nothing else, so
-- it becomes one parameter.
--
-- The zero-argument version is DROPPED first, deliberately. `create or replace`
-- with a defaulted argument would leave BOTH signatures in place, and a no-arg
-- call then matches both — PostgREST answers that with "Could not choose the
-- best candidate function". That is exactly the break 0057 had to undo.
drop function if exists public.admin_overview();

create or replace function public.admin_overview(p_days int default 7)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_day  timestamptz := date_trunc('day', now());
  v_from timestamptz := v_day - (p_days - 1) * interval '1 day';  -- p_days bars, today included
  v_prev timestamptz := v_from - p_days * interval '1 day';      -- the window before, for the deltas
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'Pick a window between 1 and 90 days';
  end if;

  select json_build_object(
    'now', now(),
    'kpi', (
      select json_build_object(
        'booked_cents',      coalesce(sum(price_cents) filter (where starts_at >= v_from), 0),
        'booked_prev_cents', coalesce(sum(price_cents) filter (where starts_at <  v_from), 0),
        'bookings',          count(*) filter (where starts_at >= v_from),
        'bookings_prev',     count(*) filter (where starts_at <  v_from),
        'kept',              count(*) filter (where starts_at >= v_from and completed_at is not null),
        'no_shows',          count(*) filter (where starts_at >= v_from and status = 'no_show'),
        'no_shows_prev',     count(*) filter (where starts_at <  v_from and status = 'no_show'),
        'avg_basket_cents',  coalesce(avg(price_cents) filter (where starts_at >= v_from), 0)::int,
        'with_deposit',      count(*) filter (where starts_at >= v_from and deposit_cents > 0)
      )
      from public.bookings
      where starts_at >= v_prev and starts_at < v_day + interval '1 day'
        and status <> 'cancelled'
    ),
    'float_cents',  (select coalesce(sum(float_cents), 0)::int from public.salon_float_state),
    'agent_salons', (select count(distinct w.salon_id) from public.wallet_transactions w
                      where w.kind = 'cash_topup'),
    'new_customers', (select count(*) from public.profiles
                       where role = 'customer' and created_at >= v_from),
    'repeat_pct', (
      select case when count(*) = 0 then 0
                  else (100.0 * count(*) filter (where n > 1) / count(*))::int end
      from (select customer_id, count(*) as n from public.bookings
             where starts_at >= v_from and status <> 'cancelled'
             group by customer_id) q
    ),
    -- the 7 bars: appointments vs walk-ins, by booked value
    'days', (
      select coalesce(json_agg(x.d order by x.dt), '[]'::json)
      from (
        select g.d::date as dt,
               json_build_object(
                 'date', g.d::date,
                 'appt_cents',   coalesce(sum(b.price_cents) filter (where b.walk_in_name is null), 0),
                 'walkin_cents', coalesce(sum(b.price_cents) filter (where b.walk_in_name is not null), 0)
               ) as d
        from generate_series(v_from, v_day, interval '1 day') g(d)
        left join public.bookings b
               on b.starts_at >= g.d and b.starts_at < g.d + interval '1 day'
              and b.status <> 'cancelled'
        group by g.d
      ) x
    ),
    'live', json_build_object(
      'shops_open', (select count(*) from public.salons s
                      where s.status = 'live' and s.accepting_bookings),
      'in_queue',   (select count(*) from public.bookings b
                      where b.status = 'confirmed' and b.completed_at is null
                        and b.starts_at >= v_day and b.starts_at < v_day + interval '1 day'),
      -- honest about what it measures: minutes until your slot, not how late the
      -- barber is running. Lateness needs started_at vs starts_at history first.
      'median_wait_min', (
        select coalesce(percentile_cont(0.5) within group (
                 order by extract(epoch from (b.starts_at - now())) / 60), 0)::int
        from public.bookings b
        where b.status = 'confirmed' and b.started_at is null
          and b.starts_at >= now() and b.starts_at < v_day + interval '1 day')
    ),
    -- "Needs a human": counts + the age of the oldest one, so the card can say "2h"
    'needs', json_build_object(
      'flagged',        (select count(*) from public.reviews where state = 'held'),
      'flagged_since',  (select min(coalesce(flagged_at, created_at)) from public.reviews where state = 'held'),
      'cases',          (select count(*) from public.support_cases where status = 'open'),
      'cases_since',    (select min(created_at) from public.support_cases where status = 'open'),
      'pending',        (select count(*) from public.salons where status = 'pending'),
      'pending_since',  (select min(submitted_at) from public.salons where status = 'pending'),
      'pending_where',  (select string_agg(s.address, ' · ') from public.salons s where s.status = 'pending'),
      'mismatch',       (select json_build_object('name', f.name, 'cents', f.gap_cents)
                          from public.salon_float_state f
                         where f.gap_cents <> 0
                         order by f.gap_cents
                         limit 1)
    ),
    'top_salons', (
      select coalesce(json_agg(json_build_object(
               'name', k.name, 'address', k.address, 'bookings', k.bookings,
               'value_cents', k.value_cents, 'no_shows', k.no_shows, 'rating', k.rating
             ) order by k.value_cents desc), '[]'::json)
      from (
        select s.name, s.address, st.bookings, st.value_cents, st.no_shows, rv.rating
        from public.salons s
        cross join lateral (
          select count(b.id)::int as bookings,
                 coalesce(sum(b.price_cents), 0)::int as value_cents,
                 count(*) filter (where b.status = 'no_show')::int as no_shows
          from public.bookings b
          join public.barbers ba on ba.id = b.barber_id
          where ba.salon_id = s.id and b.starts_at >= v_from and b.status <> 'cancelled'
        ) st
        cross join lateral (
          select round(avg(r.rating)::numeric, 1) as rating
          from public.reviews r
          join public.barbers ba on ba.id = r.barber_id
          where ba.salon_id = s.id and r.state <> 'removed'
        ) rv
        where s.status = 'live'
        order by st.value_cents desc
        limit 5
      ) k
    )
  ) into j;
  return j;
end;
$$;

grant execute on function public.admin_overview(int) to authenticated;

-- ---- 1a · the search box ----------------------------------------------------
-- 1a's box says "Search salon, booking, phone…" and did nothing. One read over
-- the four things the desk actually gets handed on the phone: a shop name, a
-- person's name or number, or a booking reference read out loud.
--
-- The booking match is on the printed reference, not the uuid: nobody phones up
-- with a uuid, they read the eight characters off their screen.
create or replace function public.admin_search(p_q text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  q text := btrim(coalesce(p_q, ''));
  pat text;
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if length(q) < 2 then
    return json_build_object('salons', '[]'::json, 'people', '[]'::json, 'bookings', '[]'::json);
  end if;
  pat := '%' || lower(q) || '%';

  select json_build_object(
    'salons', (
      select coalesce(json_agg(json_build_object(
               'id', s.id, 'name', s.name, 'address', s.address, 'status', s.status)
             order by s.name), '[]'::json)
      from public.salons s
      where lower(s.name) like pat or lower(coalesce(s.address, '')) like pat
      limit 8),

    'people', (
      select coalesce(json_agg(json_build_object(
               'id', p.id, 'name', coalesce(p.full_name, '—'), 'role', p.role,
               'phone', p.phone)
             order by p.full_name), '[]'::json)
      from public.profiles p
      where lower(coalesce(p.full_name, '')) like pat
         or replace(coalesce(p.phone, ''), ' ', '') like '%' || replace(q, ' ', '') || '%'
      limit 8),

    'bookings', (
      select coalesce(json_agg(json_build_object(
               'id', b.id,
               'ref', '#' || upper(left(replace(b.id::text, '-', ''), 8)),
               'status', b.status, 'starts_at', b.starts_at,
               'customer', coalesce(cp.full_name, 'Customer'),
               'salon', sa.name)
             order by b.starts_at desc), '[]'::json)
      from public.bookings b
      left join public.profiles cp on cp.id = b.customer_id
      left join public.barbers bb on bb.id = b.barber_id
      left join public.salons sa on sa.id = bb.salon_id
      where upper(left(replace(b.id::text, '-', ''), 8)) like upper('%' || replace(q, '#', '') || '%')
      limit 8)
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_search(text) to authenticated;

-- ---- 1d · one collection round ----------------------------------------------
-- "Run settlement" sat above a table whose rows each had their own settle
-- button. This is the round: every shop holding cash, settled in one
-- transaction, so a round that dies halfway does not leave half the city
-- collected and no record of which half.
--
-- It reuses admin_settle_float per shop rather than writing float_settlements
-- directly — that function is where the money rules live, and a second writer
-- with its own copy of them is how the two drift apart.
create or replace function public.admin_settle_all(p_min_cents int default 1, p_note text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_shops int := 0;
  v_total int := 0;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  for r in
    select s.id, public.salon_float_cents(s.id) as held
      from public.salons s
     where public.salon_float_cents(s.id) >= greatest(p_min_cents, 1)
     order by s.name
  loop
    perform public.admin_settle_float(r.id, r.held, coalesce(p_note, 'Collection round'));
    v_shops := v_shops + 1;
    v_total := v_total + r.held;
  end loop;

  return json_build_object('shops', v_shops, 'total_cents', v_total);
end;
$$;
grant execute on function public.admin_settle_all(int, text) to authenticated;
