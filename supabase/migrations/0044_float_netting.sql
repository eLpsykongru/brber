-- 0044_float_netting: the three things 0042's settlement left open.
--
--   · Netting against payouts — a settlement recorded cash we collected and
--     nothing else. It never met what we OWE the shop, so the agent's true
--     position was never a single number.
--   · A real outstanding-float cap — 0022 capped each top-up at 5 000 DH and
--     said in a comment that "the real cap is on outstanding float, which only
--     exists once settlement lands". It lands here, so the flat cap goes.
--   · The declared drawer — "unreconciled" could only ever spot over-collection.
--     A shop that logs 3 200 DH and has 2 880 DH in the till was invisible,
--     because nothing ever asked the agent what he counted.
--
-- Money model, all in cents, all derived — there is no balance column anywhere:
--   float = cash top-ups taken at that till − cash we have collected from it
--   owed  = deposits customers paid us for services the shop already delivered
--           − refunds − payouts we have already made
--   net   = float − owed        (positive: the agent owes us; negative: we owe him)
--   gap   = Σ(declared − expected) over settlements, i.e. cash the books say was
--           in the drawer and wasn't. Never self-heals; only a correcting count does.

-- ---- the settlement row learns to point both ways ---------------------------
-- A negative amount is a payout to the shop, exactly the way 0035 taught the
-- wallet ledger to go down. One table, both directions, sum is the truth.
alter table public.float_settlements
  add column expected_cents int,   -- what should have been in the drawer, at the time
  add column declared_cents int;   -- what the agent counted. null = nobody counted

-- A row is either money moving or a count. "Counted nothing, took nothing" is a
-- real settlement event — it is how an empty drawer gets on the record.
alter table public.float_settlements drop constraint float_settlements_amount_cents_check;
alter table public.float_settlements add constraint float_settlements_amount_cents_check
  check (amount_cents <> 0 or declared_cents is not null);

-- every settlement taken before this migration was a straight collection
update public.float_settlements
   set expected_cents = amount_cents, declared_cents = amount_cents
 where expected_cents is null;

-- ---- the cap, per shop ------------------------------------------------------
-- 5 000 DH is 0022's number, moved from "one top-up" to "outstanding at any
-- moment", which is the exposure that actually matters. Per salon so a shop that
-- earns its trust can be raised without touching the others.
alter table public.salons
  add column float_cap_cents int not null default 500000 check (float_cap_cents > 0);

-- ---- the four derived numbers ----------------------------------------------
-- Cash in the drawer. Only collections (positive rows) reduce it — a payout is
-- money going the other way and must not read as cash we picked up.
create or replace function public.salon_float_cents(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select (
    coalesce((select sum(w.amount_cents) from public.wallet_transactions w
               where w.salon_id = p_salon and w.kind = 'cash_topup'), 0)
    - coalesce((select sum(f.amount_cents) from public.float_settlements f
                 where f.salon_id = p_salon and f.amount_cents > 0), 0)
  )::int;
$$;

-- What we hold that belongs to the shop.
-- Forfeited deposits (no-show, customer cancellation) are deliberately NOT here:
-- who keeps those is an open product decision, and guessing it in a settlement
-- function would quietly make the decision. See BACKLOG "Payments".
create or replace function public.salon_owed_cents(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select (
    coalesce((select -sum(w.amount_cents)
                from public.wallet_transactions w
                join public.bookings b on b.id = w.booking_id
               where w.salon_id = p_salon and w.kind = 'deposit'
                 and b.completed_at is not null), 0)
    - coalesce((select sum(w.amount_cents) from public.wallet_transactions w
                 where w.salon_id = p_salon and w.kind = 'deposit_refund'), 0)
    + coalesce((select sum(f.amount_cents) from public.float_settlements f
                 where f.salon_id = p_salon and f.amount_cents < 0), 0)
  )::int;
$$;

-- The one number a settlement run is about.
create or replace function public.salon_net_cents(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select public.salon_float_cents(p_salon) - public.salon_owed_cents(p_salon);
$$;

-- Cash the books placed in the drawer that the count did not find.
create or replace function public.salon_gap_cents(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce((select sum(coalesce(f.declared_cents, f.expected_cents) - f.expected_cents)
                     from public.float_settlements f
                    where f.salon_id = p_salon and f.amount_cents >= 0), 0)::int;
$$;

grant execute on function public.salon_owed_cents(uuid) to authenticated;
grant execute on function public.salon_net_cents(uuid) to authenticated;
grant execute on function public.salon_gap_cents(uuid) to authenticated;

-- One place both admin screens read a shop's money from. NOT granted to
-- authenticated and not security_invoker: it is only ever selected from inside
-- the security-definer functions below, which are the ones that check is_admin().
create or replace view public.salon_float_state as
  select s.id, s.name, s.address, s.float_cap_cents,
         public.salon_float_cents(s.id) as float_cents,
         public.salon_owed_cents(s.id)  as owed_cents,
         public.salon_net_cents(s.id)   as net_cents,
         public.salon_gap_cents(s.id)   as gap_cents,
         (select count(*) from public.wallet_transactions w
           where w.salon_id = s.id and w.kind = 'cash_topup') as topups,
         (select max(w.created_at) from public.wallet_transactions w
           where w.salon_id = s.id and w.kind = 'cash_topup') as last_topup
  from public.salons s;
revoke all on public.salon_float_state from authenticated, anon;

-- ponytail: the one check this money path leaves behind. The three formulas are
-- signed sums over the same two tables and a sign slip in any of them is silent
-- money — a payout that reads as a pickup, a refund that raises what we owe.
do $$
declare
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  assert public.salon_float_cents(z) = 0, 'float of a shop with no history must be 0, never null';
  assert public.salon_owed_cents(z)  = 0, 'owed of a shop with no history must be 0, never null';
  assert public.salon_net_cents(z)   = 0, 'net must be float minus owed, and 0 - 0 is 0';
  assert public.salon_gap_cents(z)   = 0, 'a shop never settled has nothing unaccounted';
end $$;

-- ---- the cap moves from the top-up to the position -------------------------
-- Same function as 0022 in every other respect: owner-only, phone matched on the
-- trailing 9 digits. The only change is which limit it enforces.
create or replace function public.agent_cash_topup(customer_phone text, topup_cents int)
returns table (tx_id uuid, customer_name text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_customer uuid;
  v_name text;
  v_cap int;
  v_net int;
  v_digits text := right(regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g'), 9);
begin
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
    insert into public.wallet_transactions (user_id, salon_id, created_by, amount_cents)
    values (v_customer, v_salon, auth.uid(), topup_cents)
    returning id, v_name;
end;
$$;

-- ---- settling, with a count and both directions ----------------------------
drop function if exists public.admin_settle_float(uuid, int, text);

create or replace function public.admin_settle_float(
  p_salon uuid, p_amount_cents int, p_declared_cents int default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_owed int;
  v_expected int;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if not exists (select 1 from public.salons where id = p_salon) then
    raise exception 'Salon not found';
  end if;

  v_owed := public.salon_owed_cents(p_salon);
  -- What should be in the drawer: the ledger, less what earlier counts already
  -- found missing. Without subtracting the known gap, the same missing 320 DH is
  -- counted short again at every settlement and the shortfall compounds forever.
  v_expected := public.salon_float_cents(p_salon) + public.salon_gap_cents(p_salon);

  if p_amount_cents > 0 then                      -- we collected cash off the agent
    if p_amount_cents > v_expected then
      raise exception 'That drawer only holds % DH', (v_expected / 100.0)::numeric(12,2);
    end if;
    if p_declared_cents is not null and p_amount_cents > p_declared_cents then
      raise exception 'You cannot collect more than the % DH counted',
        (p_declared_cents / 100.0)::numeric(12,2);
    end if;
  elsif p_amount_cents < 0 then                   -- we paid the shop what we hold for it
    if -p_amount_cents > v_owed then
      raise exception 'We only owe that shop % DH', (v_owed / 100.0)::numeric(12,2);
    end if;
  elsif p_declared_cents is null then
    raise exception 'Nothing to settle';
  end if;

  insert into public.float_settlements
    (salon_id, amount_cents, expected_cents, declared_cents, settled_by, note)
  values (p_salon, coalesce(p_amount_cents, 0),
          case when coalesce(p_amount_cents, 0) >= 0 then v_expected else 0 end,
          case when coalesce(p_amount_cents, 0) >= 0 then p_declared_cents end,
          auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.admin_settle_float(uuid, int, int, text) to authenticated;

-- ---- the two screens that read money ---------------------------------------
create or replace function public.admin_wallets()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    -- what we owe customers: only positive balances are a liability
    'wallets', (
      select json_build_object(
        'liability_cents', coalesce(sum(greatest(bal, 0)), 0)::int,
        'count', count(*) filter (where bal <> 0)
      )
      from (select user_id, sum(amount_cents) as bal
              from public.wallet_transactions group by user_id) w
    ),
    'agent_cash_cents', (select coalesce(sum(float_cents), 0)::int from public.salon_float_state),
    'owed_cents',       (select coalesce(sum(owed_cents), 0)::int from public.salon_float_state),
    'net_cents',        (select coalesce(sum(net_cents), 0)::int from public.salon_float_state),
    'unreconciled_cents', (select coalesce(sum(gap_cents), 0)::int from public.salon_float_state),
    'shops_owing',      (select count(*) from public.salon_float_state where net_cents > 0),
    'last_settlement',  (select max(created_at) from public.float_settlements),
    'shops', (
      select coalesce(json_agg(json_build_object(
               'id', k.id, 'name', k.name, 'topups', k.topups,
               'float_cents', k.float_cents, 'owed_cents', k.owed_cents,
               'net_cents', k.net_cents, 'gap_cents', k.gap_cents,
               'cap_cents', k.float_cap_cents,
               'state', case when k.gap_cents <> 0 then 'mismatch'
                             when k.net_cents < 0 then 'we_owe'
                             when k.float_cents > 0 then 'awaiting'
                             else 'balanced' end,
               'last_topup', k.last_topup
             ) order by k.net_cents desc), '[]'::json)
      from public.salon_float_state k
      where k.topups > 0 or k.float_cents <> 0 or k.owed_cents <> 0
    ),
    'ledger', (
      select coalesce(json_agg(json_build_object(
               'kind', l.kind, 'amount_cents', l.amount_cents, 'at', l.created_at,
               'who', l.who, 'where', l.where_, 'ref', l.ref
             ) order by l.created_at desc), '[]'::json)
      from (
        select w.kind, w.amount_cents, w.created_at,
               coalesce(p.full_name, 'Customer') as who,
               coalesce(s.name, '—') as where_,
               case when w.booking_id is null then null
                    else '#' || upper(left(replace(w.booking_id::text, '-', ''), 8)) end as ref
        from public.wallet_transactions w
        left join public.profiles p on p.id = w.user_id
        left join public.salons  s on s.id = w.salon_id
        union all
        -- both directions leave the pool this feed tracks, so both read negative;
        -- the label says which way the cash actually walked
        select case when f.amount_cents > 0 then 'settlement' else 'payout' end,
               -abs(f.amount_cents), f.created_at,
               coalesce(p.full_name, 'Sterncut'), s.name, null
        from public.float_settlements f
        join public.salons s on s.id = f.salon_id
        left join public.profiles p on p.id = f.settled_by
        order by 3 desc
        limit 40
      ) l
    )
  ) into j;
  return j;
end;
$$;

-- 1a's "Needs a human" card: a mismatch is now a counted gap, not the impossible
-- case of a negative float.
create or replace function public.admin_overview()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_day  timestamptz := date_trunc('day', now());
  v_from timestamptz := v_day - interval '6 days';   -- the 7 bars, today included
  v_prev timestamptz := v_from - interval '7 days';  -- the week before, for the deltas
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    'now', now(),
    'kpi', (
      select json_build_object(
        'booked_cents',      coalesce(sum(price_cents) filter (where starts_at >= v_from), 0),
        'booked_prev_cents', coalesce(sum(price_cents) filter (where starts_at <  v_from), 0),
        'bookings',          count(*) filter (where starts_at >= v_from),
        'bookings_prev',     count(*) filter (where starts_at <  v_from),
        'kept',              count(*) filter (where starts_at >= v_from and completed_at is not null),
        'no_shows',          count(*) filter (where starts_at >= v_from and status = 'no_show'),
        'no_shows_prev',     count(*) filter (where starts_at <  v_from and status = 'no_show'),
        'avg_basket_cents',  coalesce(avg(price_cents) filter (where starts_at >= v_from), 0)::int,
        'with_deposit',      count(*) filter (where starts_at >= v_from and deposit_cents > 0)
      )
      from public.bookings
      where starts_at >= v_prev and starts_at < v_day + interval '1 day'
        and status <> 'cancelled'
    ),
    'float_cents',  (select coalesce(sum(float_cents), 0)::int from public.salon_float_state),
    'agent_salons', (select count(distinct w.salon_id) from public.wallet_transactions w
                      where w.kind = 'cash_topup'),
    'new_customers', (select count(*) from public.profiles
                       where role = 'customer' and created_at >= v_from),
    'repeat_pct', (
      select case when count(*) = 0 then 0
                  else (100.0 * count(*) filter (where n > 1) / count(*))::int end
      from (select customer_id, count(*) as n from public.bookings
             where starts_at >= v_from and status <> 'cancelled'
             group by customer_id) q
    ),
    -- the 7 bars: appointments vs walk-ins, by booked value
    'days', (
      select coalesce(json_agg(x.d order by x.dt), '[]'::json)
      from (
        select g.d::date as dt,
               json_build_object(
                 'date', g.d::date,
                 'appt_cents',   coalesce(sum(b.price_cents) filter (where b.walk_in_name is null), 0),
                 'walkin_cents', coalesce(sum(b.price_cents) filter (where b.walk_in_name is not null), 0)
               ) as d
        from generate_series(v_from, v_day, interval '1 day') g(d)
        left join public.bookings b
               on b.starts_at >= g.d and b.starts_at < g.d + interval '1 day'
              and b.status <> 'cancelled'
        group by g.d
      ) x
    ),
    'live', json_build_object(
      'shops_open', (select count(*) from public.salons s
                      where s.status = 'live' and s.accepting_bookings),
      'in_queue',   (select count(*) from public.bookings b
                      where b.status = 'confirmed' and b.completed_at is null
                        and b.starts_at >= v_day and b.starts_at < v_day + interval '1 day'),
      -- honest about what it measures: minutes until your slot, not how late the
      -- barber is running. Lateness needs started_at vs starts_at history first.
      'median_wait_min', (
        select coalesce(percentile_cont(0.5) within group (
                 order by extract(epoch from (b.starts_at - now())) / 60), 0)::int
        from public.bookings b
        where b.status = 'confirmed' and b.started_at is null
          and b.starts_at >= now() and b.starts_at < v_day + interval '1 day')
    ),
    -- "Needs a human": counts + the age of the oldest one, so the card can say "2h"
    'needs', json_build_object(
      'flagged',        (select count(*) from public.reviews where state = 'held'),
      'flagged_since',  (select min(coalesce(flagged_at, created_at)) from public.reviews where state = 'held'),
      'cases',          (select count(*) from public.support_cases where status = 'open'),
      'cases_since',    (select min(created_at) from public.support_cases where status = 'open'),
      'pending',        (select count(*) from public.salons where status = 'pending'),
      'pending_since',  (select min(submitted_at) from public.salons where status = 'pending'),
      'pending_where',  (select string_agg(s.address, ' · ') from public.salons s where s.status = 'pending'),
      'mismatch',       (select json_build_object('name', f.name, 'cents', f.gap_cents)
                          from public.salon_float_state f
                         where f.gap_cents <> 0
                         order by f.gap_cents
                         limit 1)
    ),
    'top_salons', (
      select coalesce(json_agg(json_build_object(
               'name', k.name, 'address', k.address, 'bookings', k.bookings,
               'value_cents', k.value_cents, 'no_shows', k.no_shows, 'rating', k.rating
             ) order by k.value_cents desc), '[]'::json)
      from (
        select s.name, s.address, st.bookings, st.value_cents, st.no_shows, rv.rating
        from public.salons s
        cross join lateral (
          select count(b.id)::int as bookings,
                 coalesce(sum(b.price_cents), 0)::int as value_cents,
                 count(*) filter (where b.status = 'no_show')::int as no_shows
          from public.bookings b
          join public.barbers ba on ba.id = b.barber_id
          where ba.salon_id = s.id and b.starts_at >= v_from and b.status <> 'cancelled'
        ) st
        cross join lateral (
          select round(avg(r.rating)::numeric, 1) as rating
          from public.reviews r
          join public.barbers ba on ba.id = r.barber_id
          where ba.salon_id = s.id and r.state <> 'removed'
        ) rv
        where s.status = 'live'
        order by st.value_cents desc
        limit 5
      ) k
    )
  ) into j;
  return j;
end;
$$;
