-- 0016_time_blocks: the schedule editor's backend.
-- 1) barbers.accepting_bookings — master switch; customer requests are rejected
--    while off, the barber's own walk-ins still insert.
-- 2) days_off.label — "Day off" / "Vacation" rows share the table.
-- 3) time_blocks — partial-day unavailability: day = null recurs every day
--    (e.g. lunch), day set = one-off (e.g. dentist). Customers can read them
--    (slot grids need them); the trigger enforces them server-side.

alter table public.barbers add column accepting_bookings boolean not null default true;
grant update (accepting_bookings) on public.barbers to authenticated;

alter table public.days_off add column label text;

create table public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  label text,
  day date, -- null = every day
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 1 and 1440),
  created_at timestamptz not null default now(),
  check (end_min > start_min)
);
create index time_blocks_barber_idx on public.time_blocks (barber_id);

alter table public.time_blocks enable row level security;
create policy "time_blocks_select" on public.time_blocks for select to authenticated using (true);
create policy "time_blocks_write" on public.time_blocks for all to authenticated
  using (barber_id = auth.uid()) with check (barber_id = auth.uid());
grant select, insert, delete on public.time_blocks to authenticated;

-- trigger: add the accepting switch + block overlap, both customer-only
-- (the barber overrides his own breaks and pause when adding walk-ins)
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

  return new;
end;
$$;
