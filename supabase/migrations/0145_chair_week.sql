-- 0145_chair_week: BRB-30's week of chairs — for each chair, the hours it was open,
-- sold and empty, how much of the empty is before noon, and what the shop takes.
--
-- Open time is src/lib/slots.ts's, so the page and the booking screen agree: the
-- barber's weekly hours inside the shop's, minus a day off, minus breaks (every-day
-- and that day's); a dated 'open' row (0052) gives its time back and outranks all
-- three. Sold = confirmed or completed bookings. Empty = open minus sold.
-- Multiranges keep it exact — no minute grid, and overlapping breaks count once.
--
-- The shop's take per chair: a commission barber's cut of the week's bookings; a rent
-- barber's rent for a week (a monthly rent as twelve months over 52 weeks); the
-- owner's own chair, everything it booked.

create or replace function public.mr_minutes(p int4multirange)
returns int language sql immutable set search_path = '' as $$
  select coalesce(sum(upper(r) - lower(r)), 0)::int from unnest(p) r;
$$;
revoke all on function public.mr_minutes(int4multirange) from public, anon, authenticated;

create or replace function public.salon_chair_week(p_day date default null)
returns table (chair_id uuid, label text, barber_id uuid, barber_name text,
               pay_model text, is_owner boolean,
               days int, from_min int, to_min int,
               open_min int, sold_min int, empty_min int, empty_am_min int,
               share_cents int, week_start date,
               vacant_since timestamptz, listed_at timestamptz, rent_cents int, rent_period text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_salon uuid; v_open int; v_close int;
  v_tz text := public.morocco_tz();
  v_mon date;
begin
  select s.id, s.open_min, s.close_min into v_salon, v_open, v_close
  from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner sees the chairs'' week'; end if;
  v_mon := date_trunc('week', coalesce(p_day, timezone(v_tz, now())::date))::date;

  return query
  with wk as (
    select (v_mon + g)::date as d from generate_series(0, 6) g
  ),
  seat as (
    select c.id, c.label lbl, c.sort, c.barber_id bid, c.vacant_since vs, c.listed_at la,
           c.rent_cents ask_cents, c.rent_period ask_period,
           b.pay_model pm, b.commission_pct pct, b.rent_cents rc, b.rent_period rp,
           coalesce(b.salon_role = 'owner', false) own, coalesce(p.full_name, 'Barber') nm
    from public.chairs c
    left join public.barbers b on b.id = c.barber_id
    left join public.profiles p on p.id = c.barber_id
    where c.salon_id = v_salon
  ),
  dayk as (
    select st.id, w.d,
      (coalesce((select range_agg(int4range(greatest(a.start_min, v_open), least(a.end_min, v_close)))
                   from public.availability a
                  where a.barber_id = st.bid and a.weekday = extract(dow from w.d)::int
                    and greatest(a.start_min, v_open) < least(a.end_min, v_close)
                    and not exists (select 1 from public.days_off o where o.barber_id = st.bid and o.day = w.d)),
                '{}'::int4multirange)
       - coalesce((select range_agg(int4range(t.start_min, t.end_min)) from public.time_blocks t
                    where t.barber_id = st.bid and t.kind = 'block' and (t.day is null or t.day = w.d)),
                  '{}'::int4multirange))
      + coalesce((select range_agg(int4range(t.start_min, t.end_min)) from public.time_blocks t
                   where t.barber_id = st.bid and t.kind = 'open' and t.day = w.d),
                 '{}'::int4multirange) as open_mr,
      coalesce((select range_agg(int4range(x.sm, least(1440, x.sm + x.dur)))
                  from (select (extract(hour from timezone(v_tz, bo.starts_at)) * 60
                                + extract(minute from timezone(v_tz, bo.starts_at)))::int sm,
                               ceil(extract(epoch from bo.ends_at - bo.starts_at) / 60)::int dur
                          from public.bookings bo
                         where bo.barber_id = st.bid and bo.status in ('confirmed', 'completed')
                           and bo.starts_at >= timezone(v_tz, w.d::timestamp)
                           and bo.starts_at < timezone(v_tz, (w.d + 1)::timestamp)) x
                 where x.dur > 0),
               '{}'::int4multirange) as sold_mr
    from seat st cross join wk w
    where st.bid is not null
  ),
  agg as (
    select k.id,
      (count(*) filter (where not isempty(k.open_mr)))::int n_days,
      min(lower(k.open_mr)) filter (where not isempty(k.open_mr)) first_min,
      max(upper(k.open_mr)) filter (where not isempty(k.open_mr)) last_min,
      sum(public.mr_minutes(k.open_mr))::int o_min,
      sum(public.mr_minutes(k.sold_mr))::int s_min,
      sum(public.mr_minutes(k.open_mr - k.sold_mr))::int e_min,
      sum(public.mr_minutes((k.open_mr - k.sold_mr) * '{[0,720)}'::int4multirange))::int e_am
    from dayk k group by k.id
  ),
  money as (
    select st.id, sum(bo.price_cents) booked
    from seat st join public.bookings bo on bo.barber_id = st.bid
    where bo.status in ('confirmed', 'completed')
      and bo.starts_at >= timezone(v_tz, v_mon::timestamp)
      and bo.starts_at < timezone(v_tz, (v_mon + 7)::timestamp)
    group by st.id
  )
  select st.id, st.lbl, st.bid, case when st.bid is null then null else st.nm end,
         st.pm, st.own,
         coalesce(ag.n_days, 0), ag.first_min, ag.last_min,
         coalesce(ag.o_min, 0), coalesce(ag.s_min, 0), coalesce(ag.e_min, 0), coalesce(ag.e_am, 0),
         case
           when st.bid is null then 0
           when st.own then coalesce(mo.booked, 0)::int
           when st.pm = 'rent' then case when st.rp = 'week' then st.rc else round(st.rc * 12 / 52.0)::int end
           else (coalesce(mo.booked, 0) * (100 - st.pct) / 100)::int
         end,
         v_mon, st.vs, st.la, st.ask_cents, st.ask_period
  from seat st
  left join agg ag on ag.id = st.id
  left join money mo on mo.id = st.id
  order by st.sort, st.lbl;
end;
$$;
revoke all on function public.salon_chair_week(date) from public, anon;
grant execute on function public.salon_chair_week(date) to authenticated;
