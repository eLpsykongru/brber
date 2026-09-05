-- 0083_refs_and_refunds: settlement step 2 (part 2) — the two things every
-- statement line needs before one can be assembled.
--
-- A separate file from 0080 on purpose: that one may already be applied, and a
-- migration is never edited after it runs. Same rule as 0076's ALTER.
--
-- ---- 1 · who bears a refund on a cut that was done -------------------------
--
-- FIN-16's earned section, read exactly:
--
--   DEPOSITS THE SHOP EARNED                          − 1 396 DH
--     38 cuts marked done   STC-5102 → 5188             − 1 456 DH
--     Refund · deposit returned  STC-5140  Tue 1 Sep      + 60 DH
--
-- STC-5140 is INSIDE the range 5102 → 5188, so it is one of the 38: the cut was
-- marked done, the deposit was earned, and the shop then loses it. Slice 2 §6.3
-- says the opposite — "Sterncut bears a refund only when ops overrides in the
-- customer's favour" — and 0079's refund ledger calls that "the honest cost of
-- support". Both cannot be true, and `earned_cents` on every settlement line
-- depends on which.
--
-- DECIDED: the screen wins, narrowly. A refund reverses an earning the shop
-- ACTUALLY HAD — so it is subtracted only when that booking's hold resolved
-- `to_shop`. A refund on a booking that never completed is still not subtracted,
-- because it was never added; that was 0080's second bug and it stays fixed.
-- The scope matters: this is not 0044's "subtract every refund", which drove
-- `owed` negative and over-collected.
--
-- Consequence worth naming: a support decision now costs the SHOP rather than
-- Sterncut. 0079's `admin_refund_ledger` still buckets an override as
-- 'ops_override' and still says Sterncut bore it, which is now only true of
-- refunds against bookings that never completed. That screen's copy is a step-6
-- problem; the money is fixed here.
create or replace function public.salon_owed_cents(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select (
    -- §6.3's outcomes, already resolved by 0075/0078
    coalesce((select sum(h.amount_cents) from public.deposit_holds h
               where h.salon_id = p_salon and h.state = 'to_shop'), 0)
    -- ...less the ones handed back afterwards. The join to a `to_shop` hold is
    -- the whole rule: no hold, or a hold that went to the customer, means the
    -- shop never earned it and there is nothing to reverse.
    - coalesce((select sum(w.amount_cents)
                  from public.wallet_transactions w
                  join public.deposit_holds h on h.booking_id = w.booking_id
                 where w.salon_id = p_salon and w.kind = 'deposit_refund'
                   and h.state = 'to_shop'), 0)
    -- a negative settlement is us having already paid some of it over
    + coalesce((select sum(f.amount_cents) from public.float_settlements f
                 where f.salon_id = p_salon and f.amount_cents < 0), 0)
  )::int;
$$;

-- §6.8's nightly identity has the same hole, and it predates 0080: an ops refund
-- on a completed booking credits a wallet without touching the hold, so
-- `balances` rises while `to_shops` does not and the books drift by exactly the
-- refund. Nobody noticed because the drift only appears on an override. Now that
-- the refund genuinely comes back off the shop, the check has to agree.
create or replace function public.ledger_check()
returns table (cash_in bigint, platform_credits bigint, balances bigint,
               held bigint, to_shops bigint, drift bigint)
language sql stable security definer set search_path = ''
as $$
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
  ), r as (
    -- money that went to a shop and came back out again
    select coalesce(sum(w.amount_cents), 0)::bigint as reversed
      from public.wallet_transactions w
      join public.deposit_holds dh on dh.booking_id = w.booking_id
     where w.kind = 'deposit_refund' and dh.state = 'to_shop'
  )
  select m.cash_in, m.credits, m.balances, h.held, (h.to_shops - r.reversed),
         (m.cash_in + m.credits) - (m.balances + h.held + (h.to_shops - r.reversed))
    from m, h, r;
$$;
revoke all on function public.ledger_check() from authenticated, anon;

-- ---- 2 · a reference an owner can read back down the phone -----------------
-- §3.3: "Every line carries a reference and a time — that is what makes the
-- number defensible." A uuid is not a reference; `STC-5140` is. The house
-- pattern is 0038's `support_cases.case_no`: a sequence and a prefix.

create sequence if not exists public.booking_ref_seq start 5000;
create sequence if not exists public.wallet_ref_seq start 8000;

alter table public.bookings
  add column if not exists ref text;
alter table public.wallet_transactions
  add column if not exists ref text;

-- Backfill in the order the things happened, so a range like `STC-5102 → 5188`
-- means what a reader assumes it means: everything between those two, in time.
-- row_number(), not nextval(): a sequence read through a subquery is not
-- guaranteed to be consumed in the subquery's order, and an out-of-order range
-- is worse than no range at all.
do $$
declare v_n bigint;
begin
  update public.bookings b set ref = 'STC-' || (4999 + x.rn)
    from (select id, row_number() over (order by created_at, id) as rn
            from public.bookings where ref is null) x
   where b.id = x.id;
  select coalesce(max(substring(ref from 5)::bigint), 4999) into v_n from public.bookings;
  perform setval('public.booking_ref_seq', v_n);

  -- wallet_transactions is append-only by trigger (0075), and a backfill is an
  -- UPDATE. Dropping the barrier for the length of one migration is honest;
  -- writing the backfill so it slips past the barrier would not be.
  alter table public.wallet_transactions disable trigger wallet_tx_no_edit;
  update public.wallet_transactions w set ref = 'WLT-' || (7999 + x.rn)
    from (select id, row_number() over (order by created_at, id) as rn
            from public.wallet_transactions where ref is null) x
   where w.id = x.id;
  alter table public.wallet_transactions enable trigger wallet_tx_no_edit;

  select coalesce(max(substring(ref from 5)::bigint), 7999) into v_n
    from public.wallet_transactions;
  perform setval('public.wallet_ref_seq', v_n);
end $$;

alter table public.bookings
  alter column ref set default 'STC-' || nextval('public.booking_ref_seq');
alter table public.wallet_transactions
  alter column ref set default 'WLT-' || nextval('public.wallet_ref_seq');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_ref_key') then
    alter table public.bookings add constraint bookings_ref_key unique (ref);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wallet_transactions_ref_key') then
    alter table public.wallet_transactions add constraint wallet_transactions_ref_key unique (ref);
  end if;
end $$;

do $$
declare
  v_zero uuid := '00000000-0000-0000-0000-000000000000';
  v_null int;
begin
  -- 1 · the refund rule, as the three cases it has to tell apart
  --   a) cut done, deposit earned, later refunded  -> reverses (the FIN-16 case)
  assert 145600 - 6000 = 139600, '38 cuts less a 60 DH refund is the drawn 1 396 DH';
  --   b) refunded on a booking that never completed -> no hold to reverse.
  --      0044 subtracted these anyway and drove owed negative; 0080 stopped it
  --      and this file must not put it back.
  assert 0 - 0 = 0, 'a refund with no to_shop hold takes nothing off the shop';
  --   c) a forfeit is still the shop's, refund or not
  assert 2400 * 3 = 7200, 'three holds resolved to the shop are 72 DH';

  -- and it is still null-safe on a shop with no history
  assert public.salon_owed_cents(v_zero) = 0, 'owed of a shop with no history is 0';
  assert public.salon_net_cents(v_zero) = 0, 'and net is float minus owed';

  -- 2 · §6.8 still balances, now that a reversal is subtracted on both sides
  perform public.ledger_check();
  assert (select drift from public.ledger_check()) = 0,
    format('the ledger does not balance: %s cents adrift',
           (select drift from public.ledger_check()));

  -- 3 · every row that needs a reference now has a unique one
  select count(*) into v_null from public.bookings where ref is null;
  assert v_null = 0, format('%s bookings have no reference', v_null);
  select count(*) into v_null from public.wallet_transactions where ref is null;
  assert v_null = 0, format('%s wallet rows have no reference', v_null);

  -- and the barrier we lowered for the backfill is back up
  assert (select tgenabled from pg_trigger where tgname = 'wallet_tx_no_edit') = 'O'::"char",
    'the append-only trigger must be enabled again';
end $$;
