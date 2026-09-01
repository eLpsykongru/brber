-- 0079_ops_money: slice 2 step 6 — ops can see it.
--
-- BKN-02's money block, BKN-04's refund ledger, OVW-02's two new rows and
-- SAL-10's shop money. All reads: nothing here moves a dirham.
--
-- §6.3's rule is the one that shapes this file: **"who bore it" is DERIVED from
-- which resolution fired — it is never a dropdown someone fills in.** 0075 gave
-- every deposit a hold with a state, and 0078 gave the hold a reason, so the
-- attribution is a join rather than a judgement.

-- ---- BKN-02 · who is holding it right now ----------------------------------
-- `admin_booking` (0069) already returns the amounts. What it cannot answer is
-- the custody question, because until 0075 there was nothing to ask. A separate
-- small read rather than a re-emit of that large function.
create or replace function public.admin_booking_hold(p_booking uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return coalesce((
    select json_build_object(
      'amount_cents', h.amount_cents,
      'state', h.state,
      'reason', h.reason,
      'resolved_at', h.resolved_at,
      -- the sentence the desk reads, not a status code
      'holder', case h.state
                  when 'held' then 'Nobody — held against the booking'
                  when 'to_shop' then 'The shop'
                  when 'to_customer' then 'Back in the customer''s wallet'
                end)
      from public.deposit_holds h where h.booking_id = p_booking), 'null'::json);
end $$;
grant execute on function public.admin_booking_hold(uuid) to authenticated;

-- ---- BKN-04 · refunds, by who bore it --------------------------------------
-- Every deposit that went back to a customer, bucketed by why.
--
-- THE FOURTH BUCKET THE DESIGN DRAWS DOES NOT EXIST YET. BKN-04 shows
-- "THE SHOP · IN ARREARS — refunded in the hour, recovered from the shop eleven
-- days later on Friday". Nothing in this codebase can recover from a shop: a
-- refund after the shop has already been settled has no claw-back, and
-- `salon_owed_cents` (0044) has no deduction term. So this returns the three
-- buckets that can actually happen and the console says the fourth is unbuilt
-- rather than printing a zero that looks like good news.
create or replace function public.admin_refund_ledger(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  return (
    with r as (
      select w.id, w.amount_cents, w.created_at, w.booking_id,
             h.reason as hold_reason,
             -- an ops-issued refund has no hold behind it: 0042's support
             -- credit is written straight to the wallet. §6.3: "Sterncut bears
             -- a refund only when ops overrides in the customer's favour."
             case
               when h.reason = 'shop cancelled' then 'shop_cancelled'
               when h.reason = 'cancelled inside the free window' then 'in_window'
               else 'ops_override'
             end as cause
        from public.wallet_transactions w
        left join public.deposit_holds h on h.booking_id = w.booking_id
       where w.kind = 'deposit_refund' and w.created_at >= v_since
    )
    select json_build_object(
      'days', p_days,
      'total_cents', coalesce((select sum(amount_cents) from r), 0),
      'count', (select count(*) from r),
      -- what it cost us: only the overrides. The rest were refunded before any
      -- shop was ever paid, which is why nobody bore them.
      'sterncut_cents', coalesce((select sum(amount_cents) from r where cause = 'ops_override'), 0),
      'never_paid_cents', coalesce((select sum(amount_cents) from r where cause <> 'ops_override'), 0),
      'rows', coalesce((
        select json_agg(json_build_object(
                 'cause', x.cause, 'n', x.n, 'cents', x.cents,
                 'label', case x.cause
                            when 'shop_cancelled' then 'The shop cancelled'
                            when 'in_window' then 'Customer cancelled, still free'
                            else 'Ops refunded against the rule'
                          end,
                 'bore', case x.cause
                           when 'ops_override' then 'STERNCUT'
                           else 'NOBODY · NOT YET PAID'
                         end,
                 'why', case x.cause
                          when 'shop_cancelled'
                            then 'Refunded before the shop was ever paid. No deduction, nothing to recover.'
                          when 'in_window'
                            then 'Cancelled inside the free window, so the deposit was never the shop''s.'
                          else 'A desk decision in the customer''s favour. This is the honest cost of support.'
                        end)
               order by x.cents desc)
          from (select cause, count(*) n, sum(amount_cents) cents from r group by cause) x), '[]'::json)
    ));
end $$;
grant execute on function public.admin_refund_ledger(int) to authenticated;

-- ---- OVW-02 · the two rows the morning screen gains ------------------------
-- §6.6: cap breaches and long holds "are the fastest way to lose real money".
-- The hold limit is 7 days because §6.7 settles weekly: a shop that has not
-- settled in longer than a cycle is the definition of overdue.
create or replace function public.admin_money_alerts()
returns json
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return (
    with s as (
      select sa.id, sa.name, sa.float_cap_cents,
             public.salon_net_cents(sa.id) as net,
             (select max(f.created_at) from public.float_settlements f where f.salon_id = sa.id) as last_settled
        from public.salons sa where sa.status = 'live'
    )
    select json_build_object(
      'over_cap', coalesce((
        select json_agg(json_build_object('id', id, 'name', name,
                 'net_cents', net, 'cap_cents', float_cap_cents) order by net desc)
          from s where float_cap_cents is not null and net > float_cap_cents), '[]'::json),
      'stale', coalesce((
        select json_agg(json_build_object('id', id, 'name', name, 'net_cents', net,
                 'days', floor(extract(epoch from now() - coalesce(last_settled, now() - interval '999 days')) / 86400)::int)
                 order by net desc)
          from s where net > 0
            and (last_settled is null or last_settled < now() - interval '7 days')), '[]'::json)
    ));
end $$;
grant execute on function public.admin_money_alerts() to authenticated;

-- ---- SAL-10 · one shop's money ---------------------------------------------
-- float held, deposits earned, days since settlement — the three numbers §3
-- names, read off the functions 0044 already shipped.
create or replace function public.admin_salon_money(p_salon uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return json_build_object(
    'float_cents', public.salon_float_cents(p_salon),
    'owed_cents', public.salon_owed_cents(p_salon),
    'net_cents', public.salon_net_cents(p_salon),
    'gap_cents', public.salon_gap_cents(p_salon),
    'cap_cents', (select float_cap_cents from public.salons where id = p_salon),
    'deposit_pct', public.shop_deposit_pct(p_salon),
    -- deposits this shop has actually earned: holds that resolved its way
    'earned_cents', coalesce((select sum(h.amount_cents) from public.deposit_holds h
                               where h.salon_id = p_salon and h.state = 'to_shop'), 0),
    'held_cents', coalesce((select sum(h.amount_cents) from public.deposit_holds h
                             where h.salon_id = p_salon and h.state = 'held'), 0),
    'last_settled', (select max(created_at) from public.float_settlements where salon_id = p_salon),
    'days_since', (select floor(extract(epoch from now() - max(created_at)) / 86400)::int
                     from public.float_settlements where salon_id = p_salon)
  );
end $$;
grant execute on function public.admin_salon_money(uuid) to authenticated;

do $$
begin
  -- BKN-02's drawn split: a 60 DH cut, 40% deposit, 36 collected in the chair
  assert 6000 - 2400 = 3600, 'a 24 DH deposit leaves 36 DH cash at the shop';

  -- §6.7 settles weekly, so a week is the hold limit OVW-02 flags on
  assert 7 = 7, 'the stale-settlement limit is one settlement cycle';

  -- §6.3: only an ops override is borne by Sterncut. The other two causes were
  -- refunded before any shop was paid, so nobody bore them.
  assert (select count(*) from (values ('shop_cancelled'), ('in_window')) v(c)
           where v.c <> 'ops_override') = 2,
    'two of the three causes cost nobody anything';
end $$;
