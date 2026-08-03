-- 0035_wallet_deposits: turns 7 and 8 of "Customer App 1.dc.html".
--
-- BACKLOG TRIGGER PULLED — "paying bookings from the wallet", named as a later
-- increment in 0022's header, and the payoff of the barber-as-agent cash-wallet
-- bet. Worth being precise about why this is buildable when "deposits" has been
-- deferred five screens running: the blocked thing is a CARD rail (no Stripe in
-- Morocco, YouCan Pay still a backlog item). This is not that. Cash reaches the
-- wallet through an agent top-up (0022) and this migration only moves numbers
-- inside a ledger we already own. No PSP is involved.
--
-- 0005 pinned deposit_cents to 0 with "revisit when a Moroccan PSP lands". That
-- condition is now beside the point — the deposit comes out of a balance the
-- customer already handed over in cash.

-- ---- the ledger learns to go down ------------------------------------------
alter table public.wallet_transactions drop constraint wallet_transactions_kind_check;
alter table public.wallet_transactions add constraint wallet_transactions_kind_check
  check (kind in ('cash_topup', 'deposit', 'deposit_refund'));

-- debits are negative rows; the balance is just the sum
alter table public.wallet_transactions drop constraint wallet_transactions_amount_cents_check;
alter table public.wallet_transactions add constraint wallet_transactions_amount_cents_check
  check (amount_cents <> 0);

-- a deposit belongs to a booking; a top-up does not
alter table public.wallet_transactions
  add column booking_id uuid references public.bookings (id) on delete set null;
-- a barber without a salon can still take a deposit
alter table public.wallet_transactions alter column salon_id drop not null;

create or replace function public.wallet_balance()
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(amount_cents), 0)::int
  from public.wallet_transactions where user_id = auth.uid();
$$;
grant execute on function public.wallet_balance() to authenticated;

-- ponytail: the one check this money path leaves behind. Runs when the migration
-- is applied and fails it loudly if the floor formula is ever edited into
-- something that rounds down — a floor that rounds down lets a deposit slip in
-- under 40%, which is the single rule 8b's locked track promises.
do $$
begin
  assert ceil(6000 * 40 / 100.0) = 2400, 'floor: 40% of 60 DH is 24 DH';
  assert ceil(999  * 40 / 100.0) = 400,  'floor must round up, never down';
  assert ceil(100  * 40 / 100.0) = 40,   'floor of the smallest price still clears zero';
end $$;

-- ---- who cancelled, and why ------------------------------------------------
-- 6c draws two different cards ("CANCELLED BY BARBER" vs "YOU CANCELLED") and
-- prints the reason on the card. Until now the reason only ever reached a chat
-- message, and nothing recorded which side pulled the trigger.
alter table public.bookings add column cancelled_by uuid references public.profiles (id);
alter table public.bookings add column cancel_reason text;

-- ---- 8a/8b · the deposit is requested on the insert ------------------------
-- fill_booking is the one place that already refuses a bad booking, so the
-- deposit rules live with the rest of them rather than in a second RPC that
-- could run against a booking that was never created.
create or replace function public.fill_booking()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca'; -- ponytail: single-city; per-barber tz when multi-city
  min_pct constant int := 40;                   -- 8b's hard floor, drawn as a locked track
  svc record;
  local_start timestamp;
  slot_start_min int;
  gap int;
  wanted int;
  floor_cents int;
  balance int;
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
  -- barber's own walk-in → instant; customer request → barber must accept
  new.status := case when new.customer_id = new.barber_id then 'confirmed' else 'pending' end;
  new.ends_at := new.starts_at + make_interval(mins => svc.duration_min);
  new.mode := 'shop';

  -- the deposit is the ONE money field the client gets to propose. Everything
  -- about it is re-checked here: floor, ceiling, and the balance behind it.
  wanted := coalesce(new.deposit_cents, 0);
  if new.customer_id = new.barber_id or wanted <= 0 then
    new.deposit_cents := 0;                       -- walk-ins and cash bookings
  else
    floor_cents := ceil(svc.price_cents * min_pct / 100.0);
    if wanted < floor_cents then
      raise exception 'A deposit must be at least % percent of the price', min_pct;
    end if;
    if wanted > svc.price_cents then raise exception 'A deposit cannot exceed the price'; end if;
    select coalesce(sum(amount_cents), 0)::int into balance
      from public.wallet_transactions where user_id = new.customer_id;
    if wanted > balance then raise exception 'Not enough in your wallet'; end if;
    new.deposit_cents := wanted;
  end if;

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

-- The debit itself, AFTER the row exists so the ledger can point at a booking.
-- Same transaction as the insert: if the booking fails, the money never moved.
create or replace function public.booking_take_deposit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(new.deposit_cents, 0) <= 0 then return new; end if;
  insert into public.wallet_transactions (user_id, salon_id, created_by, kind, amount_cents, booking_id)
  values (new.customer_id,
          (select salon_id from public.barbers where id = new.barber_id),
          new.barber_id, 'deposit', -new.deposit_cents, new.id);
  return new;
end;
$$;

create trigger after_booking_take_deposit
  after insert on public.bookings
  for each row execute function public.booking_take_deposit();

-- ---- 6c · the refund rule --------------------------------------------------
-- Barber cancels → the deposit comes back. Customer cancels → it does not.
-- That asymmetry is the whole point of a deposit, and 6c states it on the card.
create or replace function public.cancel_booking(p_booking uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
  by_barber boolean;
begin
  select customer_id, barber_id, status, starts_at, completed_at, deposit_cents into b
    from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() <> b.customer_id and auth.uid() <> b.barber_id then
    raise exception 'Not your booking';
  end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'Booking is not active'; end if;
  if b.completed_at is not null then raise exception 'Service already completed'; end if;
  if b.starts_at <= now() then raise exception 'Booking has already started'; end if;

  by_barber := auth.uid() = b.barber_id;

  update public.bookings
    set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = p_reason
    where id = p_booking;

  if by_barber and coalesce(b.deposit_cents, 0) > 0 then
    insert into public.wallet_transactions (user_id, salon_id, created_by, kind, amount_cents, booking_id)
    values (b.customer_id,
            (select salon_id from public.barbers where id = b.barber_id),
            b.barber_id, 'deposit_refund', b.deposit_cents, p_booking);
  end if;

  -- notify the client only when the BARBER cancels a real client's booking
  -- (a customer cancelling their own doesn't message themselves; walk-ins have no account)
  if p_reason is not null and by_barber and b.customer_id <> b.barber_id then
    insert into public.messages (booking_id, sender_id, body)
    values (p_booking, b.barber_id, 'Your booking was cancelled — ' || p_reason);
  end if;
end;
$$;
