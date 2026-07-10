-- 0004_fix_timezone: shop is in Tangier — Africa/Casablanca, not Africa/Algiers.
-- Matters during Ramadan when Morocco shifts to UTC+0 while Algiers stays UTC+1.
-- Full function replaced (same body as 0003 except shop_tz).

create or replace function public.fill_booking()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca'; -- ponytail: single-city; per-barber tz when multi-city
  svc record;
  local_start timestamp;
  slot_start_min int;
begin
  select s.price_cents, s.duration_min, s.barber_id
    into svc
    from public.services s
    where s.id = new.service_id and s.is_active;
  if not found then raise exception 'Service unavailable'; end if;
  if svc.barber_id <> new.barber_id then raise exception 'Service does not belong to this barber'; end if;
  if not exists (select 1 from public.barbers b where b.id = new.barber_id and b.status = 'approved') then
    raise exception 'Barber not available';
  end if;
  if new.starts_at <= now() then raise exception 'Booking must be in the future'; end if;

  -- server-side snapshots: ignore whatever the client sent for these
  new.price_cents := svc.price_cents;
  new.deposit_cents := ceil(svc.price_cents / 10.0); -- flat 10% deposit
  new.ends_at := new.starts_at + make_interval(mins => svc.duration_min);
  new.mode := 'shop';
  new.status := 'pending';

  -- inside working hours, not on a day off (shop-local time)
  local_start := new.starts_at at time zone shop_tz;
  slot_start_min := extract(hour from local_start)::int * 60 + extract(minute from local_start)::int;
  if exists (select 1 from public.days_off d
             where d.barber_id = new.barber_id and d.day = local_start::date) then
    raise exception 'Barber is off that day';
  end if;
  if not exists (select 1 from public.availability a
                 where a.barber_id = new.barber_id
                   and a.weekday = extract(dow from local_start)::int
                   and a.start_min <= slot_start_min
                   and a.end_min >= slot_start_min + svc.duration_min) then
    raise exception 'Outside working hours';
  end if;

  return new;
end;
$$;
