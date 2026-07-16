-- 0017_buffers: prep/cleanup gap around every booking.
-- Two consecutive bookings must be at least (buffer_before + buffer_after) apart;
-- slot grids hide the gap and the trigger enforces it for customer requests
-- (the barber's own walk-ins can override — his chair, his call).

alter table public.barbers add column buffer_before_min int not null default 0
  check (buffer_before_min between 0 and 60);
alter table public.barbers add column buffer_after_min int not null default 0
  check (buffer_after_min between 0 and 60);
grant update (buffer_before_min, buffer_after_min) on public.barbers to authenticated;

-- the conflict auto-fix ("Extend to N min") updates a block's end time
grant update on public.time_blocks to authenticated;

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
  gap int;
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
  if new.customer_id <> new.barber_id
     and not (select accepting_bookings from public.barbers where id = new.barber_id) then
    raise exception 'Barber is not accepting bookings right now';
  end if;

  -- server-side snapshots: ignore whatever the client sent for these
  new.price_cents := svc.price_cents;
  new.deposit_cents := 0;        -- ponytail: no deposit rail yet; revisit when a Moroccan PSP lands
  -- barber's own walk-in → instant; customer request → barber must accept
  new.status := case when new.customer_id = new.barber_id then 'confirmed' else 'pending' end;
  new.ends_at := new.starts_at + make_interval(mins => svc.duration_min);
  new.mode := 'shop';

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
  if new.customer_id <> new.barber_id
     and exists (select 1 from public.time_blocks tb
                 where tb.barber_id = new.barber_id
                   and (tb.day is null or tb.day = local_start::date)
                   and tb.start_min < slot_start_min + svc.duration_min
                   and tb.end_min > slot_start_min) then
    raise exception 'Barber is unavailable at that time';
  end if;

  -- prep/cleanup buffer: reject customer bookings too close to an existing one
  if new.customer_id <> new.barber_id then
    select buffer_before_min + buffer_after_min into gap
      from public.barbers where id = new.barber_id;
    if gap > 0 and exists (
      select 1 from public.bookings b
      where b.barber_id = new.barber_id
        and b.status in ('pending', 'confirmed')
        and new.starts_at < b.ends_at + make_interval(mins => gap)
        and new.ends_at + make_interval(mins => gap) > b.starts_at
    ) then
      raise exception 'Too close to another booking';
    end if;
  end if;

  return new;
end;
$$;
