-- 0030_client_reliability: the barber's half of the review ("Barber App.dc.html" turn 3).
-- Customer→barber reviews (0008) are public and about the haircut. This is the mirror:
-- barber→client, about *reliability* — showed up, on time, paid. It is private to the
-- shop forever: the customer can never select it, and it surfaces only as the
-- "2 past no-shows" line on a booking request.
--
-- NOT in here: money. 3d/3e draw "paid up front", which needs wallet *spending*
-- (0022 is credit-only, `kind = 'cash_topup'`). That rail is a separate decision —
-- see BACKLOG "Phase 2". require_full_payment is stored and shown; nothing debits.

create table public.client_ratings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  barber_id uuid not null references public.barbers (id),
  customer_id uuid not null references public.profiles (id),
  rating int not null check (rating between 1 and 5),
  tags text[] not null default '{}',
  note text,                                    -- the private note in 3a
  created_at timestamptz not null default now()
);
create index client_ratings_pair_idx on public.client_ratings (barber_id, customer_id, created_at desc);

-- one row per (barber, client): the standing flag 3b writes and 3d reads
create table public.client_flags (
  barber_id uuid not null references public.barbers (id),
  customer_id uuid not null references public.profiles (id),
  reason text,
  require_full_payment boolean not null default false,
  blocked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (barber_id, customer_id)
);

-- derive barber/customer from the booking; only its barber may rate, only once done
create function public.fill_client_rating()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
begin
  select customer_id, barber_id, completed_at, status into b
    from public.bookings where id = new.booking_id;
  if not found or b.barber_id <> auth.uid() then raise exception 'Not your booking'; end if;
  if b.completed_at is null then raise exception 'Rate the client once the cut is done'; end if;
  if b.customer_id = b.barber_id then raise exception 'Walk-ins have no account to rate'; end if;
  new.barber_id := b.barber_id;
  new.customer_id := b.customer_id;
  return new;
end;
$$;

create trigger before_client_rating_insert
  before insert on public.client_ratings
  for each row execute function public.fill_client_rating();

-- flags are written by the barber for himself, never for someone else's chair
create function public.fill_client_flag()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.barber_id <> auth.uid() then raise exception 'Not your chair'; end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger before_client_flag_write
  before insert or update on public.client_flags
  for each row execute function public.fill_client_flag();

alter table public.client_ratings enable row level security;
alter table public.client_flags enable row level security;

-- the rated customer is deliberately NOT in these policies: 3b promises "Anas never
-- sees this", and a select policy is the only thing making that true.
create policy client_ratings_rw on public.client_ratings for select to authenticated
  using (barber_id = auth.uid());
create policy client_ratings_insert on public.client_ratings for insert to authenticated
  with check (barber_id = auth.uid());   -- trigger already pinned this to the booking
create policy client_flags_select on public.client_flags for select to authenticated
  using (barber_id = auth.uid());
create policy client_flags_write on public.client_flags for insert to authenticated
  with check (barber_id = auth.uid());
create policy client_flags_update on public.client_flags for update to authenticated
  using (barber_id = auth.uid()) with check (barber_id = auth.uid());

grant select, insert on public.client_ratings to authenticated;
grant select, insert, update on public.client_flags to authenticated;

-- BLOCK FROM BOOKING ME (3b) has to bite server-side, or the button is a lie.
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
  if new.customer_id <> new.barber_id and exists (
    select 1 from public.client_flags f
    where f.barber_id = new.barber_id and f.customer_id = new.customer_id and f.blocked
  ) then
    raise exception 'This barber is not taking bookings from you';
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

-- What the barber sees on a request (3d) and in the queue's "2 past no-shows" (1l).
create or replace function public.client_reliability(p_customer uuid)
returns table (
  visits int,
  no_shows int,
  avg_rating numeric,
  flagged boolean,
  reason text,
  require_full_payment boolean,
  blocked boolean,
  last_no_show_days int
)
language sql security definer set search_path = ''
as $$
  select
    (select count(*)::int from public.bookings b
      where b.barber_id = auth.uid() and b.customer_id = p_customer and b.completed_at is not null),
    (select count(*)::int from public.bookings b
      where b.barber_id = auth.uid() and b.customer_id = p_customer and b.status = 'no_show'),
    (select round(avg(r.rating), 1) from public.client_ratings r
      where r.barber_id = auth.uid() and r.customer_id = p_customer),
    (select f.reason is not null or f.require_full_payment or f.blocked
      from public.client_flags f
      where f.barber_id = auth.uid() and f.customer_id = p_customer),
    (select f.reason from public.client_flags f
      where f.barber_id = auth.uid() and f.customer_id = p_customer),
    coalesce((select f.require_full_payment from public.client_flags f
      where f.barber_id = auth.uid() and f.customer_id = p_customer), false),
    coalesce((select f.blocked from public.client_flags f
      where f.barber_id = auth.uid() and f.customer_id = p_customer), false),
    (select (now()::date - max(b.starts_at at time zone 'Africa/Casablanca')::date)::int
      from public.bookings b
      where b.barber_id = auth.uid() and b.customer_id = p_customer and b.status = 'no_show');
$$;

grant execute on function public.client_reliability(uuid) to authenticated;

-- The customer's side of the same flag (3e). Deliberately narrow: a boolean and
-- nothing else — no note, no rating, no reason text leaves the shop.
create or replace function public.barber_terms_for_me(p_barber uuid)
returns table (require_full_payment boolean, blocked boolean)
language sql security definer set search_path = ''
as $$
  select
    coalesce((select f.require_full_payment from public.client_flags f
      where f.barber_id = p_barber and f.customer_id = auth.uid()), false),
    coalesce((select f.blocked from public.client_flags f
      where f.barber_id = p_barber and f.customer_id = auth.uid()), false);
$$;

grant execute on function public.barber_terms_for_me(uuid) to authenticated;
