-- 0134_morning: OVW-02, "the morning screen — nine things and yesterday"
-- (design_handoff_admin_owner_site). One read for the staff Overview:
--
--   · yesterday, in the shop's own day (Africa/Casablanca), against the same
--     weekday a week before — bookings, what was taken, deposits, no-shows, and
--     bookings by hour;
--   · the shops trading, and which are suspended;
--   · when Friday's run is cut;
--   · "what needs a person today": one row per kind of thing that is waiting,
--     with how many, since when and where. The page words them; this counts them.
--
-- Not drawn from the canvas: "8% to us" under TAKEN. There is no commission
-- (0123) — the tile says what deposits were held instead. Read-only, no gate.

create or replace function public.admin_morning()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  tz constant text := 'Africa/Casablanca';
  v_today date := (now() at time zone tz)::date;
  y0 timestamptz := ((v_today - 1)::timestamp at time zone tz);   -- yesterday
  y1 timestamptz := (v_today::timestamp at time zone tz);
  w0 timestamptz := ((v_today - 8)::timestamp at time zone tz);   -- the same weekday, a week before
  w1 timestamptz := ((v_today - 7)::timestamp at time zone tz);
  -- Friday's run covers to Friday 21:00 shop time (0081's weeks)
  v_fri date := v_today + ((5 - extract(dow from v_today)::int + 7) % 7);
  v_cut timestamptz;
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  v_cut := (v_fri::timestamp + interval '21 hours') at time zone tz;
  if v_cut <= now() then v_cut := v_cut + interval '7 days'; end if;

  select json_build_object(
    'date', v_today - 1,
    'yesterday', (
      select json_build_object(
        'bookings',           count(*) filter (where starts_at >= y0 and starts_at < y1),
        'bookings_week_ago',  count(*) filter (where starts_at >= w0 and starts_at < w1),
        'taken_cents',        coalesce(sum(price_cents) filter (where starts_at >= y0 and starts_at < y1 and status <> 'no_show'), 0),
        'deposits_cents',     coalesce(sum(deposit_cents) filter (where starts_at >= y0 and starts_at < y1 and status <> 'no_show'), 0),
        'no_shows',           count(*) filter (where starts_at >= y0 and starts_at < y1 and status = 'no_show'),
        'no_shows_week_ago',  count(*) filter (where starts_at >= w0 and starts_at < w1 and status = 'no_show'))
        from public.bookings
       where starts_at >= w0 and starts_at < y1 and status <> 'cancelled'),
    'by_hour', (
      select coalesce(json_agg(json_build_object('hour', g.h, 'n', coalesce(x.n, 0)) order by g.h), '[]')
        from generate_series(0, 23) g(h)
        left join (select extract(hour from starts_at at time zone tz)::int as h, count(*) as n
                     from public.bookings
                    where starts_at >= y0 and starts_at < y1 and status <> 'cancelled'
                    group by 1) x on x.h = g.h),
    'shops', json_build_object(
      'live', (select count(*) from public.salons where status = 'live'),
      'trading', (select count(*) from public.salons where status in ('live', 'suspended')),
      'suspended', (select coalesce(json_agg(json_build_object('name', name, 'slug', slug) order by name), '[]')
                      from public.salons where status = 'suspended')),
    'next_cut_at', v_cut,
    'needs', (
      select coalesce(json_agg(x order by x.sort), '[]') from (
        select 1 as sort, 'asks' as kind, count(*)::int as n, min(asked_at) as since,
               string_agg(title, ' · ' order by asked_at) as detail, null::int as cents
          from public.staff_asks where state = 'waiting'
        union all
        select 2, 'overdue_tasks', count(*)::int, min(t.due_at), string_agg(distinct s.name, ' · '), null
          from public.shop_tasks t join public.salons s on s.id = t.salon_id
         where t.status in ('open', 'sent') and t.due_at < now()
        union all
        select 3, 'float_gap', count(*)::int, null, string_agg(name, ' · ' order by gap_cents), sum(gap_cents)::int
          from public.salon_float_state where gap_cents <> 0
        union all
        select 4, 'float_over_cap', count(*)::int, null, string_agg(name, ' · ' order by name), sum(net_cents - float_cap_cents)::int
          from public.salon_float_state where float_cap_cents is not null and net_cents > float_cap_cents
        union all
        select 5, 'pending_shops', count(*)::int, min(submitted_at), string_agg(name, ' · ' order by submitted_at), null
          from public.salons where status = 'pending'
        union all
        select 6, 'held_reviews', count(*)::int, min(coalesce(r.flagged_at, r.created_at)), string_agg(distinct s.name, ' · '), null
          from public.reviews r join public.barbers b on b.id = r.barber_id left join public.salons s on s.id = b.salon_id
         where r.state = 'held'
        union all
        select 7, 'open_cases', count(*)::int, min(created_at), null, null
          from public.support_cases where status = 'open'
        union all
        -- "above the usual 2": this week's marks against the four weeks before, per week
        select 8, 'customer_marks', count(distinct customer_id) filter (where created_at > now() - interval '7 days')::int,
               min(created_at) filter (where created_at > now() - interval '7 days'),
               'usual ' || round(count(distinct customer_id) filter (where created_at <= now() - interval '7 days') / 4.0)::int, null
          from public.customer_marks
         where cleared_at is null and created_at > now() - interval '35 days'
      ) x where x.n > 0)
  ) into j;
  return j;
end $$;
grant execute on function public.admin_morning() to authenticated;

do $$
begin
  -- Friday is dow 5: from a Monday (1) it is 4 days on, from a Friday itself 0, from a Saturday 6
  assert (5 - 1 + 7) % 7 = 4, 'monday → friday';
  assert (5 - 5 + 7) % 7 = 0, 'friday → today';
  assert (5 - 6 + 7) % 7 = 6, 'saturday → next friday';
end $$;
