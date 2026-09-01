-- 0075_ledger: slice 2 step 1 — the ledger. No UI.
--
-- Slice-2 README §6.1/§6.3/§6.8 and the line under them: "from the database
-- alone: whose money is this, and who is holding it right now."
--
-- Today it cannot be answered from rows. `wallet_transactions` is SINGLE-ENTRY:
-- a deposit is one negative row on the customer and nothing anywhere else. The
-- shop's claim is *derived* (`salon_owed_cents`, 0044) by joining bookings on
-- `completed_at`. A deposit that has been taken but not yet resolved is in
-- neither the customer's balance nor the shop's owed — §6.3's "belongs to
-- nobody" is satisfied by accident, and invisibly.
--
-- The fix is one table, not a rewrite. `deposit_holds` posts the missing side.
-- Every existing read (wallet_balance, salon_float_cents, salon_owed_cents, the
-- admin console, 0061, 0069) keeps working untouched; the nightly check then
-- asserts the posted position and the derived one agree. If they ever diverge,
-- that disagreement IS the alarm — which is worth more than either alone.
--
-- Also here, because step 1 is where money correctness lives:
--   · idempotency on cash-in (§6.1) — currently absent, and a live bug
--   · append-only enforced by trigger, not merely by withheld grants
--   · float_settlements made immutable for real (§6.7)

-- ---- 1 · idempotency (§6.1) ------------------------------------------------
-- "A barber on 3G in the medina will tap Confirm cash received twice, and the
-- customer must be credited once." There is no key today: two taps are two rows
-- and two credits of real money.
alter table public.wallet_transactions add column if not exists idem_key text;
create unique index if not exists wallet_tx_idem_idx
  on public.wallet_transactions (idem_key) where idem_key is not null;

-- agent_cash_topup gains the key. 0057 is the standing lesson that adding a
-- defaulted argument makes PostgREST refuse an overloaded call, so the old
-- signature is DROPPED and recreated rather than overloaded.
drop function if exists public.agent_cash_topup(text, int);
create or replace function public.agent_cash_topup(
  customer_phone text, topup_cents int, p_idem text default null)
returns table (tx_id uuid, customer_name text)
language plpgsql security definer set search_path = ''
as $$
-- This is 0044's body verbatim — owner lookup, the net-position cap and its
-- exact wording, the 9-digit rule, the strict match with both failure modes.
-- The ONLY additions are the key and the replay check. Slice 2 has no opinion
-- about the rest of it.
declare
  v_salon uuid;
  v_customer uuid;
  v_name text;
  v_cap int;
  v_net int;
  v_id uuid;
  v_digits text := right(regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g'), 9);
begin
  -- §6.1 — the same key twice is the same top-up. Answered BEFORE the cap and
  -- the lookup: a replay must return the original receipt, not a fresh refusal
  -- caused by the position the first tap already moved.
  if p_idem is not null then
    select w.id, coalesce(p.full_name, 'Client') into v_id, v_name
      from public.wallet_transactions w
      join public.profiles p on p.id = w.user_id
     where w.idem_key = p_idem;
    if found then
      tx_id := v_id; customer_name := v_name; return next; return;
    end if;
  end if;

  select s.id, s.float_cap_cents into v_salon, v_cap
    from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then
    raise exception 'Only the salon owner can take cash top-ups';
  end if;
  if topup_cents is null or topup_cents <= 0 then
    raise exception 'Amount must be more than zero';
  end if;

  -- the real limit: how much of ours he is holding once this one lands
  v_net := public.salon_net_cents(v_salon);
  if v_net + topup_cents > v_cap then
    raise exception 'This would put % DH of ours in your till — the limit is % DH. Settle up first.',
      ((v_net + topup_cents) / 100.0)::numeric(12,2), (v_cap / 100.0)::numeric(12,2);
  end if;

  if length(v_digits) < 9 then
    raise exception 'Enter the customer''s full phone number';
  end if;
  begin
    select p.id, coalesce(p.full_name, 'Client') into strict v_customer, v_name
    from public.profiles p
    where right(regexp_replace(p.phone, '\D', '', 'g'), 9) = v_digits;
  exception
    when no_data_found then raise exception 'No brber account with that phone';
    when too_many_rows then raise exception 'That phone matches more than one account';
  end;

  return query
    insert into public.wallet_transactions
      (user_id, salon_id, created_by, amount_cents, idem_key)
    values (v_customer, v_salon, auth.uid(), topup_cents, p_idem)
    returning id, v_name;
end;
$$;
grant execute on function public.agent_cash_topup(text, int, text) to authenticated;

-- ---- 2 · append-only for real (§6.1) --------------------------------------
-- Withholding grants stops `authenticated`. It does not stop a definer function
-- or a future migration — 0024 deleted ledger rows once already. A correction is
-- a reversing entry; that is the whole point of an append-only ledger.
create or replace function public.ledger_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'wallet_transactions is append-only — correct with a reversing entry';
end $$;
drop trigger if exists wallet_tx_no_edit on public.wallet_transactions;
create trigger wallet_tx_no_edit before update or delete on public.wallet_transactions
  for each row execute function public.ledger_is_append_only();

-- §6.7 a settlement is immutable once confirmed; corrections are new lines.
drop trigger if exists float_settlements_no_edit on public.float_settlements;
create trigger float_settlements_no_edit before update or delete on public.float_settlements
  for each row execute function public.ledger_is_append_only();

-- ---- 3 · the holding position (§6.3) --------------------------------------
-- One row per booking that took a deposit. `state` is the answer to "who is
-- holding this right now" — read, never computed.
create table if not exists public.deposit_holds (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT, not cascade: `wallet_transactions.booking_id` is `on delete set
  -- null` (0035), so cascading here would drop the hold while the debit that
  -- created it survives — the identity would silently go adrift by exactly the
  -- deleted deposit. A booking that moved money cannot be deleted; cancel it.
  booking_id uuid not null unique references public.bookings (id) on delete restrict,
  customer_id uuid not null references public.profiles (id),
  salon_id uuid references public.salons (id),
  amount_cents int not null check (amount_cents > 0),
  -- held = nobody's. Resolution is one-way; a hold never returns to 'held'.
  state text not null default 'held' check (state in ('held', 'to_shop', 'to_customer')),
  reason text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists deposit_holds_state_idx on public.deposit_holds (state);
create index if not exists deposit_holds_salon_idx on public.deposit_holds (salon_id, state);

alter table public.deposit_holds enable row level security;
create policy deposit_holds_select on public.deposit_holds for select to authenticated
  using (customer_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.bookings b
                     where b.id = booking_id and b.barber_id = auth.uid()));
grant select on public.deposit_holds to authenticated;
-- no write grants: holds move only through the triggers below

-- A hold is created by the same transaction that debits the wallet, so the two
-- can never disagree. Hangs off the ledger row rather than off `bookings`
-- because the deposit row is the thing that actually moved money.
create or replace function public.open_deposit_hold()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind <> 'deposit' or new.booking_id is null then return new; end if;
  insert into public.deposit_holds (booking_id, customer_id, salon_id, amount_cents)
  values (new.booking_id, new.user_id, new.salon_id, -new.amount_cents)
  on conflict (booking_id) do nothing;   -- a re-taken deposit is still one hold
  return new;
end $$;
drop trigger if exists on_deposit_open_hold on public.wallet_transactions;
create trigger on_deposit_open_hold after insert on public.wallet_transactions
  for each row execute function public.open_deposit_hold();

-- Resolution, per §6.3. The free-cancellation window does not exist yet (step 4
-- builds it), so this encodes TODAY's shipped behaviour exactly:
--   barber cancels   → to_customer (0035 already writes the refund row)
--   customer cancels → to_shop, forfeited, whatever the timing
--   completed        → to_shop
-- When the window lands, the only edit is the customer-cancel branch.
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
    else
      -- ponytail: no window yet, so every customer cancellation forfeits —
      -- which is what cancel_booking (0035) already does. Step 4 splits this.
      v_state := 'to_shop'; v_reason := 'cancelled by customer';
    end if;
  else
    return new;
  end if;

  update public.deposit_holds
     set state = v_state, reason = v_reason, resolved_at = now()
   where booking_id = new.id and state = 'held';   -- one-way, and idempotent
  return new;
end $$;
drop trigger if exists on_booking_resolve_hold on public.bookings;
create trigger on_booking_resolve_hold after update on public.bookings
  for each row execute function public.resolve_deposit_hold();

-- Backfill. Every deposit already taken gets the hold it should always have had,
-- read off the booking's own outcome so history and ledger agree from day one.
insert into public.deposit_holds
  (booking_id, customer_id, salon_id, amount_cents, state, reason, resolved_at)
select w.booking_id, w.user_id, w.salon_id, -w.amount_cents,
       case
         when b.completed_at is not null then 'to_shop'
         when exists (select 1 from public.wallet_transactions r
                       where r.booking_id = b.id and r.kind = 'deposit_refund')
           then 'to_customer'
         when b.status in ('cancelled', 'no_show') then 'to_shop'
         else 'held'
       end,
       'backfilled from booking outcome (0075)',
       case when b.status = 'confirmed' and b.completed_at is null then null else now() end
  from public.wallet_transactions w
  join public.bookings b on b.id = w.booking_id
 where w.kind = 'deposit'
on conflict (booking_id) do nothing;

-- ---- 4 · the nightly check (§6.8) -----------------------------------------
-- Every dirham that entered the system is in exactly one place: a customer's
-- wallet, a hold, or a shop's pocket.
--
--   cash_in + platform_credits  =  wallet balances + held + gone to shops
--
-- cash_topup is cash over a counter; `referral` (0038) is platform-funded
-- credit with no cash behind it, so it is counted as money entering too.
-- Deposits net out: the wallet goes down by exactly what the hold goes up by.
create or replace function public.ledger_check()
returns table (cash_in bigint, platform_credits bigint, balances bigint,
               held bigint, to_shops bigint, drift bigint)
language sql stable security definer set search_path = '' as $$
  with m as (
    select
      coalesce(sum(amount_cents) filter (where kind = 'cash_topup'), 0)::bigint as cash_in,
      coalesce(sum(amount_cents) filter (where kind = 'referral'), 0)::bigint   as credits,
      coalesce(sum(amount_cents), 0)::bigint                                    as balances
      from public.wallet_transactions
  ), h as (
    select
      coalesce(sum(amount_cents) filter (where state = 'held'), 0)::bigint    as held,
      coalesce(sum(amount_cents) filter (where state = 'to_shop'), 0)::bigint as to_shops
      from public.deposit_holds
  )
  select m.cash_in, m.credits, m.balances, h.held, h.to_shops,
         (m.cash_in + m.credits) - (m.balances + h.held + h.to_shops)
    from m, h;
$$;
revoke all on function public.ledger_check() from authenticated, anon;

-- Someone must be told before morning. Writes an admin notification when the
-- books do not balance; silent when they do.
create or replace function public.ledger_check_nightly()
returns void language plpgsql security definer set search_path = '' as $$
declare v_drift bigint;
begin
  select drift into v_drift from public.ledger_check();
  if v_drift = 0 then return; end if;
  insert into public.notifications (user_id, kind, title, body)
  select p.id, 'moderation', 'Ledger does not balance',
         'Drift of ' || (v_drift / 100.0)::numeric(12,2) || ' DH at ' || now()::date
    from public.profiles p where p.role = 'admin';
end $$;
revoke all on function public.ledger_check_nightly() from authenticated, anon;

-- Same conditional shape as 0037/0051/0058: a project without pg_cron still
-- applies this file, it just never fires until the extension is enabled.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sterncut-ledger-check', '30 2 * * *',
      $c$select public.ledger_check_nightly();$c$);
  else
    raise notice 'pg_cron not installed — the nightly ledger check will not fire '
                 'until it is enabled; call ledger_check() by hand meanwhile';
  end if;
end $$;

-- ---- the assertions -------------------------------------------------------
do $$
declare v_drift bigint; v_orphans int;
begin
  -- §5's drawn numbers, and 0035's floor, unchanged by any of this
  assert ceil(6000 * 40 / 100.0) = 2400, '40% of a 60 DH skin fade is 24 DH';
  assert 6000 - 2400 = 3600, 'and 36 DH is due in cash at the shop';

  -- the identity holds over whatever this project already contains
  select drift into v_drift from public.ledger_check();
  assert v_drift = 0,
    format('ledger does not balance after backfill: %s cents adrift', v_drift);

  -- every deposit ever taken now has exactly one hold
  select count(*) into v_orphans
    from public.wallet_transactions w
   where w.kind = 'deposit' and w.booking_id is not null
     and not exists (select 1 from public.deposit_holds h where h.booking_id = w.booking_id);
  assert v_orphans = 0, format('%s deposits have no hold row', v_orphans);

  -- a hold is one-way: nothing resolved may sit without a timestamp, and
  -- nothing still held may carry one
  assert not exists (select 1 from public.deposit_holds
                      where state <> 'held' and resolved_at is null),
    'a resolved hold must say when';
  assert not exists (select 1 from public.deposit_holds
                      where state = 'held' and resolved_at is not null),
    'a held deposit has not resolved';
end $$;
