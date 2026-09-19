-- 0125_barber_account: "what do I owe you, and what do you owe me".
-- `design_handoff_billing_rail/` — ADDENDUM §9 (the ledger), BAC-01 … BAC-08.
-- README §7 step 5: read-only, and cleared vs pending right from the first commit.
--
-- The float screens only ever drew one direction: cash a barber takes for wallet
-- top-ups, which is ours. The other direction was always there and never drawn:
-- a deposit on a finished cut, a no-show deposit kept — his money, held by us.
-- Two balances, one relationship, and they net.
--
-- ---- what the repo actually has, and so what this file reads -----------------
--
-- A CUT PAID FROM THE WALLET IS A 100% DEPOSIT. The booking sheet lets a client
-- take the deposit anywhere from the shop's floor up to "Full" (0076), and a
-- full one leaves nothing to pay in the chair. So BAC-06's "cuts paid from
-- wallet" are the finished cuts whose deposit covered the whole price, and
-- BAC-07's "deposits on finished cuts" are the rest — each still "+ X cash".
-- Same rows, same money, split by what was left for the chair.
--
-- ONE TILL PER SHOP. Top-ups are taken by the owner only (0022/0075), and the
-- weekly settlement is the shop's. So "what you hold for us" is the owner's
-- column; any other barber's is zero — he cannot take a top-up. The cash agent a
-- barber can be appointed as (§9, OBR-07…09) is the next slice, not this one.
--
-- THE ACCOUNT RUNS FROM THE LAST SETTLEMENT. BAC-04: "both columns go to zero
-- and the account starts again". Both columns are read from the same window —
-- after the covers_to of the shop's last settled week — which is exactly the
-- window the next Friday lines will be cut from. So the net here and the next
-- statements agree, and a column never shows money a collection already moved.
--
-- PENDING IS NOT MONEY YET. A deposit on a booking that has not happened is the
-- client's (`deposit_holds.state = 'held'`): `cleared_at` is null in the view,
-- and every sum that feeds a net filters on it here, in SQL, not in a screen.
--
-- CASH TAKEN IN THE CHAIR NEVER APPEARS. It never left his pocket; nothing in
-- the ledger records it, and BAC-07's "+ 70 cash" is shown beside a deposit as
-- what the chair was due — price, less discount, less deposit — never summed.

-- ---- §9's view -------------------------------------------------------------
create or replace view public.barber_ledger as
  -- his, cleared or pending: a deposit on his booking that went (or will go) to the shop
  select b.barber_id, h.salon_id, 'held_for_him'::text as direction,
         case when h.state = 'held' then 'pending'
              -- the whole cut came out of the wallet: nothing was due in the chair
              when h.reason = 'cut done'
               and h.amount_cents >= b.price_cents - coalesce(b.discount_cents, 0) then 'wallet_cut'
              when h.reason = 'cut done' then 'deposit'
              when h.reason = 'no-show' then 'no_show'
              else 'late_cancel' end as kind,
         b.id as booking_id, b.ref, b.customer_id,
         h.amount_cents,
         coalesce(h.resolved_at, h.created_at) as occurred_at,
         case when h.state = 'to_shop' then h.resolved_at end as cleared_at
    from public.deposit_holds h
    join public.bookings b on b.id = h.booking_id
   where h.state in ('held', 'to_shop')
  union all
  -- a deposit handed back after it was his: it comes off his column
  select b.barber_id, w.salon_id, 'held_for_him', 'refund',
         b.id, b.ref, b.customer_id,
         -w.amount_cents, w.created_at, w.created_at
    from public.wallet_transactions w
    join public.deposit_holds h on h.booking_id = w.booking_id and h.state = 'to_shop'
    join public.bookings b on b.id = w.booking_id
   where w.kind = 'deposit_refund'
  union all
  -- ours: cash a client handed him for a wallet top-up
  select w.created_by, w.salon_id, 'held_for_us', 'topup',
         null::uuid, w.ref, w.user_id,
         w.amount_cents, w.created_at, w.created_at
    from public.wallet_transactions w
   where w.kind = 'cash_topup' and w.created_by is not null;
revoke all on public.barber_ledger from anon, authenticated;

-- ---- the window --------------------------------------------------------------
-- The end of the last week the shop actually settled: its line collected, paid,
-- or nil on a released run. Before the weekly run existed a settlement was a
-- single float row, so with no settled line the last of those is the boundary.
create or replace function public.barber_account_since(p_salon uuid)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select max(r.covers_to)
       from public.settlement_lines l
       join public.settlement_runs r on r.id = l.run_id
      where l.salon_id = p_salon and r.state <> 'draft'
        and (l.visit in ('collected', 'paid') or l.direction = 'nil')),
    (select max(f.created_at) from public.float_settlements f where f.salon_id = p_salon));
$$;
revoke all on function public.barber_account_since(uuid) from public, anon, authenticated;

-- ---- BAC-01 … BAC-04 -------------------------------------------------------
create or replace function public.my_account()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  me record;
  v_since timestamptz;
  v_till boolean;
  v_ours int; v_ours_n int;
  v_mine int; v_dep int; v_dep_n int; v_ns int; v_ns_n int; v_ref int; v_ref_n int;
  v_wc int; v_wc_n int;
  v_pend int; v_pend_n int;
  v_coll int; v_coll_n int;
  v_bill int := 0;
  v_last record;
begin
  select b.id, b.salon_id, coalesce(p.full_name, 'Barber') as name,
         s.name as salon, s.owner_id, s.float_cap_cents, s.cash_agent_id
    into me
    from public.barbers b
    join public.salons s on s.id = b.salon_id
    left join public.profiles p on p.id = b.id
   where b.id = auth.uid() and b.salon_status = 'approved';
  if me.id is null then return json_build_object('salon', null); end if;

  v_since := public.barber_account_since(me.salon_id);
  -- the one who takes top-ups today is the owner (0075)
  v_till := me.owner_id = me.id;

  select coalesce(sum(amount_cents), 0), count(*) into v_ours, v_ours_n
    from public.barber_ledger
   where direction = 'held_for_us' and salon_id = me.salon_id and barber_id = me.id
     and (v_since is null or occurred_at > v_since);

  -- cleared only: a pending deposit can never reach a net
  select coalesce(sum(amount_cents) filter (where kind = 'wallet_cut'), 0),
         count(*) filter (where kind = 'wallet_cut'),
         coalesce(sum(amount_cents) filter (where kind = 'deposit'), 0),
         count(*) filter (where kind = 'deposit'),
         coalesce(sum(amount_cents) filter (where kind in ('no_show', 'late_cancel')), 0),
         count(*) filter (where kind in ('no_show', 'late_cancel')),
         coalesce(sum(amount_cents) filter (where kind = 'refund'), 0),
         count(*) filter (where kind = 'refund')
    into v_wc, v_wc_n, v_dep, v_dep_n, v_ns, v_ns_n, v_ref, v_ref_n
    from public.barber_ledger
   where direction = 'held_for_him' and barber_id = me.id and salon_id = me.salon_id
     and cleared_at is not null and (v_since is null or cleared_at > v_since);
  v_mine := v_wc + v_dep + v_ns + v_ref;

  select coalesce(sum(amount_cents), 0), count(*) into v_pend, v_pend_n
    from public.barber_ledger
   where direction = 'held_for_him' and barber_id = me.id and salon_id = me.salon_id
     and cleared_at is null;

  -- the till's other hat: what the shop's other chairs earned in the same window.
  -- It comes out of the same drawer, so it is on the same page — as its own line.
  if v_till then
    select coalesce(sum(amount_cents), 0), count(distinct barber_id) into v_coll, v_coll_n
      from public.barber_ledger
     where direction = 'held_for_him' and salon_id = me.salon_id and barber_id <> me.id
       and cleared_at is not null and (v_since is null or cleared_at > v_since);
    -- the shop's bill comes off the same Friday (0123), so the till's number
    -- carries it or it would not match the statement. The till is the owner
    -- today; a barber never sees this line (§7).
    select least(coalesce(sum(st.balance_cents - st.pending_cents), 0), greatest(v_mine + v_coll, 0))
      into v_bill
      from public.subscription_invoice_state st
     where st.salon_id = me.salon_id and st.status = 'open';
  else
    v_coll := 0; v_coll_n := 0;
  end if;

  -- "Since Nadia's last visit · 4 Sept"
  select coalesce(p.full_name, 'the agent') as agent, rc.recorded_at as at into v_last
    from public.settlement_receipts rc
    join public.settlement_lines l on l.id = rc.line_id
    left join public.profiles p on p.id = rc.agent_id
   where l.salon_id = me.salon_id
   order by rc.recorded_at desc limit 1;

  return json_build_object(
    'me', me.name, 'salon', me.salon, 'salon_id', me.salon_id,
    'till', v_till,
    'since', v_since,
    'last_visit', case when v_last.at is null then null
                       else json_build_object('agent', v_last.agent, 'at', v_last.at) end,
    'ours', json_build_object('cents', case when v_till then v_ours else 0 end,
                              'count', case when v_till then v_ours_n else 0 end),
    'mine', json_build_object('cents', v_mine,
              'wallet_cuts', json_build_object('cents', v_wc, 'count', v_wc_n),
              'deposits', json_build_object('cents', v_dep, 'count', v_dep_n),
              'no_shows', json_build_object('cents', v_ns, 'count', v_ns_n),
              'refunds', json_build_object('cents', v_ref, 'count', v_ref_n)),
    'pending', json_build_object('cents', v_pend, 'count', v_pend_n),
    'colleagues', json_build_object('cents', v_coll, 'barbers', v_coll_n),
    'bill_cents', v_bill,
    -- the one number, with its direction: + he hands over, − we (the shop) pay him
    'net_cents', (case when v_till then v_ours else 0 end) - v_mine - v_coll + v_bill,
    'cap', case when v_till then json_build_object(
             'cap_cents', me.float_cap_cents,
             'net_cents', public.salon_net_cents(me.salon_id),
             'room_cents', greatest(me.float_cap_cents - public.salon_net_cents(me.salon_id), 0)) end,
    -- who pays a barber in the shop: the shop's cash agent (§9, "decided 2026-09-18")
    'agent', (select json_build_object('name', coalesce(p.full_name, 'the owner'),
                                       'is_me', ab.id = me.id)
                from public.barbers ab left join public.profiles p on p.id = ab.id
               where ab.id = coalesce(me.cash_agent_id, me.owner_id))
  );
end $$;
revoke execute on function public.my_account() from public, anon;
grant execute on function public.my_account() to authenticated;

-- ---- BAC-03, BAC-06, BAC-07, BAC-08 and the pending block: the rows under the totals --
-- p_kind: 'wallet_cuts' | 'deposits' | 'no_shows' | 'refunds' | 'pending' | 'topups'
create or replace function public.my_account_lines(p_kind text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare me record; v_since timestamptz;
begin
  select b.id, b.salon_id, s.owner_id into me
    from public.barbers b join public.salons s on s.id = b.salon_id
   where b.id = auth.uid() and b.salon_status = 'approved';
  if me.id is null then return '[]'::json; end if;
  v_since := public.barber_account_since(me.salon_id);

  if p_kind = 'topups' then
    if me.owner_id <> me.id then return '[]'::json; end if;
    return coalesce((
      select json_agg(json_build_object(
               'ref', x.ref, 'cents', x.amount_cents, 'at', x.occurred_at,
               'name', coalesce(p.full_name, 'Client')) order by x.occurred_at desc)
        from public.barber_ledger x
        left join public.profiles p on p.id = x.customer_id
       where x.direction = 'held_for_us' and x.salon_id = me.salon_id and x.barber_id = me.id
         and (v_since is null or x.occurred_at > v_since)), '[]'::json);
  end if;

  return coalesce((
    select json_agg(json_build_object(
             'booking', x.booking_id, 'ref', x.ref, 'kind', x.kind,
             'cents', x.amount_cents, 'at', x.occurred_at, 'cleared_at', x.cleared_at,
             'starts_at', b.starts_at, 'status', b.status,
             'name', coalesce(b.walk_in_name, p.full_name, 'Client'),
             'service', sv.name,
             -- BAC-07: what the chair was due beside the deposit. Shown, never summed.
             'in_chair_cents', greatest(b.price_cents - coalesce(b.discount_cents, 0) - b.deposit_cents, 0),
             -- BAC-05: the client's own word on it, if he filed one
             'client_says', (select sc.detail from public.support_cases sc
                              where sc.booking_id = b.id and sc.user_id = b.customer_id
                              order by sc.created_at desc limit 1),
             'disputed', exists (select 1 from public.support_cases sc
                                  where sc.booking_id = b.id and sc.user_id = me.id
                                    and sc.status = 'open'))
           order by x.occurred_at desc)
      from public.barber_ledger x
      join public.bookings b on b.id = x.booking_id
      left join public.profiles p on p.id = x.customer_id
      left join public.services sv on sv.id = b.service_id
     where x.direction = 'held_for_him' and x.barber_id = me.id and x.salon_id = me.salon_id
       and case p_kind
             when 'wallet_cuts' then x.kind = 'wallet_cut'
             when 'deposits' then x.kind = 'deposit'
             when 'no_shows' then x.kind in ('no_show', 'late_cancel')
             when 'refunds' then x.kind = 'refund'
             when 'pending' then x.cleared_at is null
             else false end
       and (p_kind = 'pending' or v_since is null or x.cleared_at > v_since)), '[]'::json);
end $$;
revoke execute on function public.my_account_lines(text) from public, anon;
grant execute on function public.my_account_lines(text) to authenticated;

-- ---- checked at apply time ---------------------------------------------------
-- 0117's lesson: a grant to `authenticated` never kept anon out on its own. None
-- of this slice's functions is callable without signing in — a null ACL counts
-- as open, because it means PUBLIC still has EXECUTE.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    assert not exists (
      select 1 from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public'
         and p.proname in (
           'on_shop_page', 'seat_census', 'subscription_credit_cents', 'casa_day', 'casa_start',
           'whole_months', 'salon_booked_between', 'salon_sms_sent', 'close_invoice', 'issue_invoice',
           'term_paid_seats', 'bill_salon', 'run_subscription_billing', 'admin_run_billing',
           'admin_start_billing', 'subscription_netting', 'my_subscription', 'my_invoice',
           'switch_subscription_cycle', 'invoice_short_fridays', 'invoice_rung', 'salon_billing_state',
           'in_search', 'my_unpaid', 'request_subscription_collection', 'admin_log_billing_call',
           'admin_record_subscription_cash', 'admin_write_off_invoice', 'admin_subscription_ledger',
           'barber_account_since', 'my_account', 'my_account_lines')
         and (p.proacl is null or exists (
               select 1 from aclexplode(p.proacl) a
                where a.privilege_type = 'EXECUTE'
                  and (a.grantee = 0 or a.grantee = 'anon'::regrole)))),
      'every billing-rail function needs a signed-in caller';
  end if;
end $$;
