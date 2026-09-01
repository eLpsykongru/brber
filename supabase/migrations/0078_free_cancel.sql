-- 0078_free_cancel: slice 2 step 4 — the deposit resolves on a deadline.
--
-- §6.3's table has four outcomes and the repo only ever implemented two of them:
-- `cancel_booking` (0035) refunds when the BARBER cancels and forfeits every
-- time the customer does, whatever the timing. §6.3 splits that in half:
--
--   customer cancels inside window   held -> customer wallet
--   customer cancels outside window  held -> shop            (forfeit)
--
-- So this is a behaviour change to shipped money code, not a new screen.
--
-- §6.4: "The free-cancellation window is a derived number, not a constant... it
-- must be rendered as a TIME ('free until 13:30 today'), never as a duration
-- ('up to 2 hours before'). People cannot do that arithmetic on a bus."
--
-- DEVIATION, and it needs a decision. §6.4 also says the window must come from
-- the SHOP's policy. There is no designed surface for that: G3 (OSH-11) sets the
-- shop's percentage and says nothing about a window, and §4's seven gaps don't
-- include one. The only place it is ever drawn is ops SET-01, platform-wide, at
-- 2 hours. So it lives on `platform_settings` next to the bounds, and a per-shop
-- override waits for a screen that can set it.
-- ponytail: one number in one place beats a per-shop column nothing can write.

alter table public.platform_settings
  add column if not exists free_cancel_min int not null default 120;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'free_cancel_range') then
    alter table public.platform_settings add constraint free_cancel_range
      check (free_cancel_min between 0 and 1440);
  end if;
end $$;

-- ---- the rule, in one place ------------------------------------------------
-- Both the refund and the hold read this, so they can never disagree about
-- whether a given cancellation was free.
create or replace function public.cancel_is_free(p_starts_at timestamptz)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_starts_at - make_interval(mins =>
           (select free_cancel_min from public.platform_settings)) > now();
$$;
grant execute on function public.cancel_is_free(timestamptz) to authenticated;

-- §6.4's number, as a moment rather than a duration. The screen prints the
-- clock time; it never does the subtraction itself, so there is one arithmetic.
create or replace function public.booking_free_until(p_booking uuid)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select b.starts_at - make_interval(mins =>
           (select free_cancel_min from public.platform_settings))
    from public.bookings b
   where b.id = p_booking
     and (b.customer_id = auth.uid() or b.barber_id = auth.uid() or public.is_admin());
$$;
grant execute on function public.booking_free_until(uuid) to authenticated;

-- ---- the refund ------------------------------------------------------------
-- 0035's function, unchanged except for the branch §6.3 asks for: the deposit
-- comes back when the shop cancels (whatever the timing — "window irrelevant")
-- OR when the customer cancels while it is still free.
create or replace function public.cancel_booking(p_booking uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
  by_barber boolean;
  refund boolean;
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
  -- §6.3: "shop or barber cancels — held -> customer wallet, in full, window
  -- irrelevant". A customer gets it back only while the window is open.
  refund := by_barber or public.cancel_is_free(b.starts_at);

  update public.bookings
    set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = p_reason
    where id = p_booking;

  if refund and coalesce(b.deposit_cents, 0) > 0 then
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
grant execute on function public.cancel_booking(uuid, text) to authenticated;

-- ---- and the hold agrees ---------------------------------------------------
-- 0075 left this branch with a comment saying step 4 would split it. This is
-- that split. Everything else is 0075's function unchanged.
create or replace function public.resolve_deposit_hold()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_state text; v_reason text;
begin
  if new.completed_at is not null and old.completed_at is null then
    v_state := 'to_shop'; v_reason := 'cut done';
  elsif new.status = 'no_show' and old.status <> 'no_show' then
    v_state := 'to_shop'; v_reason := 'no-show';
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    if new.cancelled_by = new.barber_id then
      v_state := 'to_customer'; v_reason := 'shop cancelled';
    elsif public.cancel_is_free(new.starts_at) then
      v_state := 'to_customer'; v_reason := 'cancelled inside the free window';
    else
      v_state := 'to_shop'; v_reason := 'cancelled after the free window';
    end if;
  else
    return new;
  end if;

  update public.deposit_holds
     set state = v_state, reason = v_reason, resolved_at = now()
   where booking_id = new.id and state = 'held';   -- one-way, and idempotent
  return new;
end $$;

do $$
declare v_win int;
begin
  select free_cancel_min into v_win from public.platform_settings;
  -- SET-01 draws the window at 2 hours
  assert v_win = 120, 'the drawn free-cancel window is 2 hours';

  -- the predicate, against a booking two hours and one minute out
  assert public.cancel_is_free(now() + interval '121 minutes'),
    'a cancellation more than the window ahead is free';
  assert not public.cancel_is_free(now() + interval '119 minutes'),
    'one minute inside the window is not';
  assert not public.cancel_is_free(now()),
    'and the slot itself is long past free';

  -- §6.4's rendering: the deadline is a moment, so a 13:00 slot on a 120-minute
  -- window is 11:00 — the screen prints that, it never prints "2 hours before"
  assert (timestamptz '2026-09-03 13:00+01' - make_interval(mins => 120))
       = timestamptz '2026-09-03 11:00+01', 'a 13:00 slot is free until 11:00';
end $$;
