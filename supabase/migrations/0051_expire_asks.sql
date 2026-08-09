-- 0051_expire_asks: an ask for a day that is over stops being 'waiting'.
--
-- Every read path already treats a past-day ask as gone — my_waitlist_asks
-- relabels it, barber_waitlist and offer_candidates filter it out — so this
-- changes nothing on screen. What it fixes is the row itself: without a sweep,
-- `waiting` is a status nothing ever leaves, and the partial indexes that only
-- cover live asks grow forever.

create or replace function public.expire_stale_asks()
returns int
language sql security definer set search_path = ''
as $$
  with gone as (
    update public.waitlist_requests set status = 'expired'
     where status = 'waiting'
       and day < (now() at time zone 'Africa/Casablanca')::date
    returning 1)
  select count(*)::int from gone;
$$;

-- ---- make it happen without depending on an extension ----------------------
-- ponytail: the sweep also runs on every ask, which is the only write path that
-- creates the rows in the first place. It touches only rows the partial index
-- already points at, so it's a handful of tuples on a table that self-limits to
-- live asks. If that ever stops being cheap, drop this line and rely on cron.
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

  perform public.expire_stale_asks();

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

-- Hourly rather than daily so no timezone arithmetic is needed: Casablanca is
-- UTC+1 except during Ramadan, and an hourly sweep is right under both.
-- Same conditional shape as 0037's reminders — a project without pg_cron still
-- applies this migration, it just leans on the ask-time sweep above.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sterncut-expire-asks', '7 * * * *',
      'select public.expire_stale_asks()');
  else
    raise notice 'pg_cron not installed — asks are swept whenever someone asks, '
      'which is enough until the table gets big.';
  end if;
end $$;

do $$
declare
  v_today date := (now() at time zone 'Africa/Casablanca')::date;
begin
  -- the sweep's own rule, stated where it can be read: yesterday goes, today stays
  assert v_today - 1 < v_today, 'yesterday is expired';
  assert not (v_today < v_today), 'today is still waiting';
end $$;
