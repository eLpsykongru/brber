-- 0003_booking_flow: availability, days off, server-side booking validation

-- ---------- availability ----------

-- times are minutes-from-midnight, shop-local. ponytail: single-city launch →
-- one hardcoded shop timezone (see shop_tz below); per-barber tz column when multi-city.
create table public.availability (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  weekday int not null check (weekday between 0 and 6), -- 0 = Sunday (matches JS getDay)
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 1 and 1440),
  check (end_min > start_min),
  unique (barber_id, weekday, start_min)
);

create table public.days_off (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  day date not null,
  unique (barber_id, day)
);

alter table public.availability enable row level security;
alter table public.days_off enable row level security;

-- hours are public knowledge (customers need them to compute slots); writes are owner-only
create policy "availability_select" on public.availability for select to authenticated using (true);
create policy "availability_write" on public.availability for all to authenticated
  using (barber_id = auth.uid()) with check (barber_id = auth.uid());
create policy "days_off_select" on public.days_off for select to authenticated using (true);
create policy "days_off_write" on public.days_off for all to authenticated
  using (barber_id = auth.uid()) with check (barber_id = auth.uid());

grant select, insert, update, delete on public.availability to authenticated;
grant select, insert, update, delete on public.days_off to authenticated;

-- ---------- busy ranges, without exposing other people's bookings ----------

create function public.booked_ranges(p_barber uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable
security definer set search_path = ''
as $$
  select b.starts_at, b.ends_at
  from public.bookings b
  where b.barber_id = p_barber
    and b.status in ('pending', 'confirmed')
    and b.starts_at < p_to and b.ends_at > p_from;
$$;
grant execute on function public.booked_ranges to authenticated;

-- ---------- server-side booking validation & snapshots ----------

-- The client only supplies: customer_id, barber_id, service_id, starts_at.
-- Everything money- or time-derived is computed HERE so a tampered client can't
-- set its own price/deposit or book outside working hours.
create function public.fill_booking()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Algiers'; -- ponytail: single-city; per-barber tz when multi-city
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

create trigger before_booking_insert
  before insert on public.bookings
  for each row execute function public.fill_booking();
