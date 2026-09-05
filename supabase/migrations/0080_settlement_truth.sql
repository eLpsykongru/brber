-- 0080_settlement_truth: T1 — the settlement number is wrong today, and the
-- float cap changes with nobody's name on it (T2 · SAL-21).
--
-- Two bugs move real money right now, both in `salon_owed_cents` (0044):
--
--   1. FORFEITS ARE MISSING. It counts deposits only `where completed_at is not
--      null`, and its own comment calls that "an open product decision". §6.3
--      and 0075 have since decided it: a no-show and a cancellation after the
--      free window both resolve `to_shop`. Every forfeit a shop earned is
--      missing from what we settle, so we UNDER-PAY it.
--
--   2. REFUNDS ARE SUBTRACTED THAT WERE NEVER ADDED. It subtracts *every*
--      `deposit_refund` for the salon, unconditionally — but a refund only
--      happens on a booking that did NOT complete (barber cancelled, or the
--      customer cancelled inside the window), and those deposits were never in
--      the sum in the first place. Each one pushes `owed` down, so `net` up, so
--      we OVER-COLLECT from the shop by the refund. Step 4 (0078) made in-window
--      refunds a routine path, so this fires in normal operation now.
--
-- The fix is not two more terms. `deposit_holds` (0075) already records §6.3's
-- outcome for every deposit ever taken — its backfill asserts zero orphans — so
-- the shop's claim IS "the holds that resolved its way". Reading that one column
-- makes forfeits present and refunds absent by construction, and it makes
-- `salon_owed_cents` agree with `admin_salon_money.earned_cents` and with
-- `ledger_check`, which were three different answers to one question.

-- ---- 1 · what the shop is owed ---------------------------------------------
create or replace function public.salon_owed_cents(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select (
    -- §6.3's four outcomes, already resolved. `to_customer` is not the shop's
    -- and `held` is nobody's yet, so neither can leak into a settlement.
    coalesce((select sum(h.amount_cents) from public.deposit_holds h
               where h.salon_id = p_salon and h.state = 'to_shop'), 0)
    -- a negative settlement is us having already paid some of it over
    + coalesce((select sum(f.amount_cents) from public.float_settlements f
                 where f.salon_id = p_salon and f.amount_cents < 0), 0)
  )::int;
$$;

-- ---- 2 · the collection round ----------------------------------------------
-- `admin_settle_all` (0071) has never run. It calls the three-argument
-- `admin_settle_float(uuid, int, text)` that 0044:183 dropped, and a known-text
-- third argument has no implicit cast to the `p_declared_cents int` that
-- replaced it — so "Run settlement" raises "function does not exist" on the
-- first shop. It also iterated `salon_float_cents`, the gross drawer, which
-- ignores the netting §6.7 is entirely about.
--
-- Paying a shop we owe is a different physical act — cash out of a bag, not into
-- one — and it has no designed surface yet (FIN-01). So the round collects, and
-- COUNTS what it could not pay rather than omitting it silently.
create or replace function public.admin_settle_all(p_min_cents int default 1, p_note text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_shops int := 0;
  v_total int := 0;
  v_owed_shops int := 0;
  v_owed_total int := 0;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  for r in
    select s.id, public.salon_net_cents(s.id) as net
      from public.salons s
     where public.salon_net_cents(s.id) >= greatest(p_min_cents, 1)
     order by s.name
  loop
    perform public.admin_settle_float(r.id, r.net, null::int, coalesce(p_note, 'Collection round'));
    v_shops := v_shops + 1;
    v_total := v_total + r.net;
  end loop;

  select count(*), coalesce(sum(-public.salon_net_cents(s.id)), 0)
    into v_owed_shops, v_owed_total
    from public.salons s where public.salon_net_cents(s.id) < 0;

  return json_build_object('shops', v_shops, 'total_cents', v_total,
                           'we_owe_shops', v_owed_shops, 'we_owe_cents', v_owed_total);
end;
$$;

-- ---- 3 · how long we let a float sit ---------------------------------------
-- SAL-20 and BCF-03 both draw "the cap is 14" and it has only ever existed as a
-- literal inside an assertion. SAL-21's trade panel reads "Collected on time,
-- last 6 · 6 of 6" off it, so it has to be a number somewhere.
alter table public.platform_settings
  add column if not exists float_hold_days int not null default 14;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'float_hold_range') then
    alter table public.platform_settings add constraint float_hold_range
      check (float_hold_days between 1 and 90);
  end if;
end $$;

-- The trust record a raise is argued from. "On time" is the gap between one
-- collection and the one before it — for the first, the gap since the shop's
-- first top-up, because that is when our cash started sitting there.
create or replace function public.salon_ontime_record(p_salon uuid, p_last int default 6)
returns json
language sql stable security definer set search_path = ''
as $$
  with lim as (select float_hold_days as d from public.platform_settings),
  s as (
    select f.created_at,
           coalesce(lag(f.created_at) over (order by f.created_at),
                    (select min(w.created_at) from public.wallet_transactions w
                      where w.salon_id = p_salon and w.kind = 'cash_topup')) as since
      from public.float_settlements f
     where f.salon_id = p_salon and f.amount_cents > 0
  ),
  last_n as (
    select created_at, since,
           (since is not null
            and created_at - since <= make_interval(days => (select d from lim))) as on_time
      from s order by created_at desc limit greatest(p_last, 1)
  )
  select json_build_object(
    'limit_days', (select d from lim),
    'n',       (select count(*) from last_n),
    'on_time', (select count(*) from last_n where on_time)
  )
  -- security definer, so it needs the same audience float_settlements has:
  -- us, or the owner of that shop. Nobody else gets to read a shop's record.
  where public.is_admin()
     or exists (select 1 from public.salons s
                 where s.id = p_salon and s.owner_id = auth.uid());
$$;
grant execute on function public.salon_ontime_record(uuid, int) to authenticated;

-- ---- 4 · the top-ups the cap turned away -----------------------------------
-- SAL-21's central figure ("7 last month · ≈ 1 100 DH") has never been
-- computable: the cap refusal is a `raise exception`, so anything the function
-- wrote rolls back with it. The only way to keep it is to write from OUTSIDE the
-- failed transaction — which is exactly what `CapHitSheet` already does for
-- `request_float_collection`, so this rides the same catch.
-- ponytail: client-written, so it undercounts if the app dies between the
-- refusal and the log. An autonomous-transaction insert is the upgrade if the
-- number ever has to be exact rather than indicative.
create table if not exists public.float_refusals (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  by_user uuid references public.profiles (id),
  wanted_cents int not null check (wanted_cents > 0),
  net_cents int not null,
  cap_cents int not null,
  created_at timestamptz not null default now()
);
create index if not exists float_refusals_idx on public.float_refusals (salon_id, created_at desc);
alter table public.float_refusals enable row level security;
drop policy if exists float_refusals_select on public.float_refusals;
create policy float_refusals_select on public.float_refusals for select to authenticated
  using (public.is_admin()
         or exists (select 1 from public.salons s
                     where s.id = float_refusals.salon_id and s.owner_id = auth.uid()));

create or replace function public.log_float_refusal(p_cents int)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null or p_cents is null or p_cents <= 0 then return; end if;
  insert into public.float_refusals (salon_id, by_user, wanted_cents, net_cents, cap_cents)
  select v_salon, auth.uid(), p_cents, public.salon_net_cents(v_salon), s.float_cap_cents
    from public.salons s where s.id = v_salon;
end;
$$;
grant execute on function public.log_float_refusal(int) to authenticated;

-- ---- 5 · SAL-21's impact panel, before anything is written ------------------
-- 0077's `admin_bounds_impact` is the precedent: the desk never presses a button
-- whose answer it has not already been shown.
--
-- THE DENOMINATOR. The console has been printing `float / cap`, but the refusal
-- in `agent_cash_topup` tests `net + topup > cap`. Since net = float − owed, the
-- displayed utilisation reads HIGHER than the one that actually refuses, so a
-- raise argued off it over-provisions. `pct` here is the enforcing one; `held`
-- is returned beside it because the floor guard (0069, kept below) is about
-- physical cash in the drawer, which is a different question.
create or replace function public.admin_cap_impact(p_salon uuid, p_cents int)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cap int; v_net int; v_float int; v_days int; v_limit int; v_name text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select s.float_cap_cents, s.name into v_cap, v_name from public.salons s where s.id = p_salon;
  if v_name is null then raise exception 'Salon not found'; end if;

  v_net   := public.salon_net_cents(p_salon);
  v_float := public.salon_float_cents(p_salon);
  select floor(extract(epoch from now() - max(created_at)) / 86400)::int into v_days
    from public.float_settlements where salon_id = p_salon;
  select float_hold_days into v_limit from public.platform_settings;

  return json_build_object(
    'salon', v_name,
    'cap_cents', v_cap,
    'new_cap_cents', p_cents,
    'net_cents', v_net,
    'float_cents', v_float,
    -- the two percentages the sentence names, on the enforcing denominator
    'pct_now', case when v_cap > 0 then round(v_net * 100.0 / v_cap)::int end,
    'pct_new', case when p_cents > 0 then round(v_net * 100.0 / p_cents)::int end,
    -- "Our cash exposed per shop — +1 400 DH"
    'exposure_delta_cents', p_cents - v_cap,
    'raising', p_cents > v_cap,
    -- the floor 0069 refuses below: the cash physically in the till
    'floor_cents', v_float,
    -- "Top-ups they turned away — 7 last month · ≈ 1 100 DH"
    'turned_away', (select json_build_object(
                      'n', count(*), 'cents', coalesce(sum(wanted_cents), 0))
                      from public.float_refusals
                     where salon_id = p_salon and created_at >= now() - interval '30 days'),
    -- "Collected on time, last 6 — 6 of 6"
    'ontime', public.salon_ontime_record(p_salon, 6),
    -- "Settle the 3 240 first". Raising the cap while an old float sits there
    -- rewards the delay, so the dialog demotes RAISE to the secondary button.
    'settle_first', (v_net > 0 and (v_days is null or v_days > v_limit)),
    'days_since', v_days,
    'hold_limit_days', v_limit
  );
end $$;
grant execute on function public.admin_cap_impact(uuid, int) to authenticated;

-- ---- 6 · the write, with a name on it --------------------------------------
-- §3: "Raise the cap — **needs a reason**; lands in the audit log." §6.6: "Ops
-- may raise the cap per shop (SAL-21) **with a reason**."
--
-- 0077 made a reason mandatory on NARROWING, because narrowing takes a choice
-- away from a shop. Here it is mandatory on RAISING, and that is not an
-- inconsistency: what makes a reason mandatory is the direction that increases
-- risk, not the direction of travel. Raising a cap puts more of our cash in
-- someone else's till. Lowering it only ever brings our money closer to home.
--
-- The audit is 0066's `settings_changes` again, for the same reason 0077 gave —
-- a second table for the same question is two places to look. It has no
-- `salon_id`, so the shop rides inside the JSON and `admin_cap_history` reads it
-- back; without that reader the row would be written and never seen.
drop function if exists public.admin_set_float_cap(uuid, int);

create or replace function public.admin_set_float_cap(
  p_salon uuid, p_cents int, p_reason text default null, p_notify boolean default true)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_held int; v_cap int; v_name text; v_owner uuid; v_net int; v_told int := 0;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_cents is null or p_cents <= 0 then
    raise exception 'A float cap has to be a positive amount';
  end if;

  select s.float_cap_cents, s.name, s.owner_id into v_cap, v_name, v_owner
    from public.salons s where s.id = p_salon;
  if v_name is null then raise exception 'Salon not found'; end if;
  if p_cents = v_cap then raise exception 'That is already the cap'; end if;

  -- 0069's floor, unchanged: 9a says in words that lowering the cap below what
  -- the shop is holding "would stop top-ups tonight", so the DB refuses rather
  -- than letting the desk strand a till it cannot top up.
  v_held := public.salon_float_cents(p_salon);
  if v_held is not null and p_cents < v_held then
    raise exception 'That cap is below the % DH already in the till', round(v_held / 100.0);
  end if;

  -- the rule, enforced here and not only in the console: a desk rule that lives
  -- in JavaScript is a desk rule until somebody opens the network tab.
  if p_cents > v_cap and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Raising a cap needs a reason - it puts more of our cash in someone else''s till';
  end if;

  v_net := public.salon_net_cents(p_salon);
  update public.salons set float_cap_cents = p_cents where id = p_salon;

  -- "Youssef is told the new limit." An owner's till limit must not change
  -- without him knowing, in either direction — a quiet lowering is how a shop
  -- discovers the cap by being refused mid-shift.
  -- ponytail: in-app notification, same as 0077. Swap for an SMS when the
  -- provider lands; the audience query is the part that matters.
  if p_notify and v_owner is not null then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (v_owner, 'shop_status',
            case when p_cents > v_cap then 'Your float limit went up' else 'Your float limit changed' end,
            'You can now hold up to ' || round(p_cents / 100.0) || ' DH of top-up cash before settling.',
            p_cents);
    v_told := 1;
  end if;

  insert into public.settings_changes (changed_by, before, after, note)
  values (auth.uid(),
          json_build_object('salon', p_salon, 'name', v_name, 'cap', v_cap),
          json_build_object('salon', p_salon, 'name', v_name, 'cap', p_cents,
                            'held', v_held, 'net', v_net, 'notified', v_told),
          nullif(btrim(coalesce(p_reason, '')), ''));

  return json_build_object('cap_cents', p_cents, 'was_cents', v_cap,
                           'raising', p_cents > v_cap, 'notified', v_told);
end;
$$;
grant execute on function public.admin_set_float_cap(uuid, int, text, boolean) to authenticated;

-- ---- 7 · and it can be read back -------------------------------------------
create or replace function public.admin_cap_history(p_salon uuid, p_limit int default 6)
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'by', coalesce(p.full_name, 'Ops'),
           'was_cents', (c.before->>'cap')::int,
           'cap_cents', (c.after->>'cap')::int,
           'reason', c.note,
           'at', c.changed_at) order by c.changed_at desc), '[]'::json)
    from (select * from public.settings_changes
           where jsonb_exists(after::jsonb, 'cap')
             and (after->>'salon')::uuid = p_salon
           order by changed_at desc limit greatest(p_limit, 1)) c
    left join public.profiles p on p.id = c.changed_by
   where public.is_admin();
$$;
grant execute on function public.admin_cap_history(uuid, int) to authenticated;

do $$
declare v_zero uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- 1 · the two bugs, as arithmetic. A 60 DH cut at 40% is a 24 DH deposit.
  -- Shop earns three: one completed, one no-show, one cancelled late.
  assert 2400 * 3 = 7200, 'three forfeit-or-earned holds are 72 DH to the shop';
  -- the old function saw only the completed one
  assert 2400 * 1 = 2400, 'the old owed_cents counted one of the three';
  assert 7200 - 2400 = 4800, 'so it under-paid that shop by 48 DH';

  -- 2 · an in-window cancellation refunds 24 DH that was never in `owed`
  assert 0 - 2400 = -2400, 'the old function drove owed negative by the refund';
  -- net = float - owed, so a smaller owed is a bigger collection
  assert 10000 - (-2400) > 10000 - 0, 'which over-collected by exactly the refund';

  -- and the new one cannot do either: a refunded hold is `to_customer`, and
  -- `to_customer` is not in the sum at all.
  assert (select count(*) from (values ('to_shop'), ('to_customer'), ('held')) v(s)
           where v.s = 'to_shop') = 1, 'one of the three hold states is the shop''s';

  -- null-safety, the same shape 0044 asserted on a shop with no history
  assert public.salon_owed_cents(v_zero) = 0, 'owed of a shop with no history is 0, never null';
  assert public.salon_net_cents(v_zero)  = 0, 'and net is float minus owed';

  -- 3 · the settle_all call now matches the surviving signature
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'admin_settle_float') = 1,
    'there is exactly one admin_settle_float, and the round calls its 4 arguments';

  -- 4 · SAL-21's drawn numbers, on the denominator that actually refuses
  assert round(3240 * 100.0 / 5000) = 65, 'at a 5 000 cap, 3 240 sits at 65%';
  assert round(3240 * 100.0 / 3600) = 90, 'at the current 3 600 it sits at 90%';
  assert 5000 - 3600 = 1400, 'and the exposure delta is the drawn +1 400';

  -- 5 · the reason rule, in the risk-increasing direction
  assert (5000 > 3600), 'raising: a reason is mandatory';
  assert not (3000 > 3600), 'lowering: it is not';

  -- 6 · the settle-first gate fires on an old float, not merely a large one
  assert (3240 > 0 and 19 > 14), 'a 19-day float past a 14-day limit demotes RAISE';
  assert not (3240 > 0 and 3 > 14), 'a fresh one does not';
end $$;
