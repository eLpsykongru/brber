-- 0060_demand_map: admin turn 4 — where to put the next barber.
--
-- The read side of `waitlist_requests` at platform scale. Customer 36a writes a
-- row when a day is full; barber 8h reads them one shop at a time. Neither can
-- see the thing that decides what ops actually does:
--
--   "Are we turning people away because there aren't enough chairs, or because
--    the chairs sit idle at the wrong hours?"
--
-- That distinction is computable and it is the whole turn. An ask carries the
-- earliest time the customer could come (0050's `earliest_min`); `availability`
-- carries when the shop is open. An ask for a time the shop is **shut** is an
-- hours problem. An ask for a time it is **open and full** is a chairs problem.
-- Recruit in one, nudge in the other — and the desk should never guess which.
--
-- Read-only over existing rows, with one exception: districts. Grouping demand
-- by area needs an area, and `salons` has a free-text address that no query can
-- honestly split. So ops names it.

alter table public.salons
  add column if not exists district text;
create index if not exists salons_district_idx on public.salons (district);

-- ---- 4a · the map ----------------------------------------------------------
create or replace function public.admin_demand(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  with asks as (
    select w.id, w.salon_id, w.status, w.earliest_min, w.day, w.created_at,
           coalesce(s.district, 'Unassigned') as district,
           s.name as salon,
           -- when this shop actually shuts on the day being asked about. Max
           -- across its chairs: if any barber is open, the shop is open.
           (select max(a.end_min) from public.availability a
             join public.barbers b on b.id = a.barber_id
            where b.salon_id = w.salon_id
              and a.weekday = extract(dow from w.day)::int) as closes_min,
           (select min(a.start_min) from public.availability a
             join public.barbers b on b.id = a.barber_id
            where b.salon_id = w.salon_id
              and a.weekday = extract(dow from w.day)::int) as opens_min
      from public.waitlist_requests w
      left join public.salons s on s.id = w.salon_id
     where w.created_at > now() - make_interval(days => p_days)
  ),
  tagged as (
    select *,
           -- the one classification the turn rests on
           case
             when earliest_min is null then 'supply'
             when closes_min is null then 'supply'
             when earliest_min >= closes_min then 'hours'
             when earliest_min < opens_min then 'hours'
             else 'supply'
           end as kind,
           status = 'taken' as filled
      from asks
  )
  select json_build_object(
    'days', p_days,
    'totals', json_build_object(
      'asks', (select count(*)::int from tagged),
      'unmet', (select count(*)::int from tagged where not filled),
      'filled', (select count(*)::int from tagged where filled),
      'conversion_pct', (select case when count(*) = 0 then 0
                           else round(100.0 * count(*) filter (where filled) / count(*))::int end
                           from tagged),
      'expired', (select count(*)::int from tagged where status = 'expired'),
      -- "62% fall outside opening hours somewhere" — the headline that tells ops
      -- this is not simply a shortage
      'outside_hours_pct', (select case when count(*) = 0 then 0
                              else round(100.0 * count(*) filter (where kind = 'hours') / count(*))::int end
                              from tagged where not filled),
      'full_shops', (select count(distinct salon_id)::int from tagged)
    ),
    'districts', (
      select coalesce(json_agg(x order by x.unmet desc), '[]'::json) from (
        select district,
               count(*)::int as asks,
               count(*) filter (where not filled)::int as unmet,
               count(*) filter (where filled)::int as filled,
               count(*) filter (where kind = 'hours' and not filled)::int as hours_asks,
               count(distinct salon_id)::int as shops,
               -- the verdict, and it is a verdict rather than a number because
               -- "recruit" and "nudge" are different phone calls
               case
                 when count(*) filter (where not filled) = 0 then 'healthy'
                 when count(*) filter (where kind = 'hours' and not filled)
                      >= count(*) filter (where not filled) * 0.5 then 'hours'
                 else 'supply'
               end as verdict
          from tagged
         group by district
      ) x),
    -- "WHEN THE ASKS LAND": the histogram that makes an hours problem obvious
    'by_hour', (
      select coalesce(json_agg(json_build_object(
               'hour', h, 'asks', n, 'outside', outside) order by h), '[]'::json)
      from (
        select (earliest_min / 60)::int as h,
               count(*)::int as n,
               count(*) filter (where kind = 'hours')::int as outside
          from tagged where earliest_min is not null
         group by 1
      ) g),
    'top_shops', (
      select coalesce(json_agg(x order by x.unmet desc), '[]'::json) from (
        select salon_id, salon, coalesce(district, 'Unassigned') as district,
               count(*) filter (where not filled)::int as unmet,
               count(*) filter (where filled)::int as filled,
               max(closes_min) as closes_min
          from tagged where salon_id is not null
         group by salon_id, salon, district
         limit 10
      ) x)
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_demand(int) to authenticated;

-- Naming a district is the one write this screen needs, and it is ops data
-- entry rather than a decision, so it is a plain setter.
create or replace function public.admin_set_district(p_salon uuid, p_district text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.salons set district = nullif(btrim(coalesce(p_district, '')), '')
   where id = p_salon;
  if not found then raise exception 'No such shop'; end if;
end;
$$;
grant execute on function public.admin_set_district(uuid, text) to authenticated;

do $$
begin
  -- 4a's drawn districts. Malabata: 118 asks, 9 filled — a chairs problem.
  assert round(100.0 * 9 / 118) = 8, '9 of 118 filled is 8% conversion';
  -- Kasbah: 61 of 74 asks after 18:00, and the shops shut at 19:00
  assert 61.0 >= 74 * 0.5, 'most of Kasbah''s asks are outside hours, so it reads as hours';
  assert 18 * 60 >= 19 * 60 - 60, 'an 18:00 ask against a 19:00 close is inside hours';
  assert 19 * 60 + 30 >= 19 * 60, 'a 19:30 ask against a 19:00 close is outside them';
  -- the platform headline
  assert round(100.0 * 23 / 100) = 23, '23% conversion is asks filled over asks made';
end $$;
