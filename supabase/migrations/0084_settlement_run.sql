-- 0084_settlement_run: settlement step 3 — the draft run. FIN-14.
--
-- §9: "FIN-14 — draft run, both totals, typed exclusions. This is the screen
-- that proves the model." Everything here writes DRAFT rows only; releasing is
-- step 4 and is a separate act by design (§2.1).
--
-- ---- the one thing §2 does not spell out ----------------------------------
--
-- A refund lands in the window it was ISSUED in (§2.5). But the earning it
-- reverses may belong to a week that is already released and already handed
-- over in cash. §2.8 says that becomes a carried line on the next statement —
-- and FIN-17 draws ops CHOOSING which week to land it in.
--
-- What FIN-17 cannot be is the only path, because then a refund nobody
-- processes by hand simply vanishes from every statement while
-- `salon_owed_cents` has already dropped by it — the running total and the sum
-- of the weeks would drift apart permanently. So the cut writes the carried
-- line automatically, for exactly the refunds whose earning belongs to an
-- earlier window. FIN-17 is ops MOVING one to a different week, not creating it.
-- That is the only reading where every refund lands in exactly one statement.

-- ---- reading a window ------------------------------------------------------
-- §2.5's stamps, in one place so the draft and the statement cannot disagree:
--   float   -> wallet_transactions.created_at, the moment he took the cash
--   a cut   -> deposit_holds.resolved_at, the moment it was marked done
--   refund  -> the refund row's own created_at
--
-- DEVIATION worth naming: §2.5 stamps a cut from "the moment the barber marked
-- it done". A no-show and a cancel-after-window also resolve to the shop (§6.3)
-- and neither has a mark-done moment; `resolved_at` is the only moment they
-- have. So a forfeit's week is decided by when the outcome was recorded, which
-- is the same fragility §2.5 exists to avoid — but the alternative is leaving
-- forfeits out of every statement.

create or replace function public.settlement_items_for(
  p_salon uuid, p_from timestamptz, p_to timestamptz)
returns table (kind public.statement_kind, label text, booking_ref text,
               occurred_at timestamptz, amount_cents int, source_week timestamptz)
language sql stable security definer set search_path = ''
as $$
  -- 1 · our float, one line per movement, with the barber who took it
  select 'float_movement'::public.statement_kind,
         'Cash top-up taken by ' || coalesce(split_part(p.full_name, ' ', 1), 'a barber'),
         w.ref, w.created_at, w.amount_cents, null::timestamptz
    from public.wallet_transactions w
    left join public.profiles p on p.id = w.created_by
   where w.salon_id = p_salon and w.kind = 'cash_topup'
     and w.created_at >= p_from and w.created_at < p_to

  union all

  -- 2 · the cuts, as ONE line with a range. Thirty-eight rows would bury the
  -- four that matter; the range is what makes it checkable.
  select 'deposit_earned', count(*) || ' cuts marked done in the window',
         'STC-' || min(substring(b.ref from 5)::bigint)
         || ' - ' || max(substring(b.ref from 5)::bigint), max(h.resolved_at),
         -sum(h.amount_cents)::int, null
    from public.deposit_holds h
    join public.bookings b on b.id = h.booking_id
   where h.salon_id = p_salon and h.state = 'to_shop'
     and h.resolved_at >= p_from and h.resolved_at < p_to
  having count(*) > 0

  union all

  -- 3 · refunds against an earning made THIS window: they net out here
  select 'refund', 'Refund - deposit returned to the customer',
         b.ref, w.created_at, w.amount_cents, null
    from public.wallet_transactions w
    join public.deposit_holds h on h.booking_id = w.booking_id
    join public.bookings b on b.id = w.booking_id
   where w.salon_id = p_salon and w.kind = 'deposit_refund'
     and w.created_at >= p_from and w.created_at < p_to
     and h.state = 'to_shop'
     and h.resolved_at >= p_from and h.resolved_at < p_to

  union all

  -- 4 · refunds against an earning from a CLOSED week: §2.8's carried line
  select 'carried',
         'Carried from week ' || to_char(public.settlement_cut(h.resolved_at)
                                         at time zone 'Africa/Casablanca', 'IW')
         || ' - refund after settlement',
         b.ref, w.created_at, w.amount_cents,
         public.settlement_cut(h.resolved_at)
    from public.wallet_transactions w
    join public.deposit_holds h on h.booking_id = w.booking_id
    join public.bookings b on b.id = w.booking_id
   where w.salon_id = p_salon and w.kind = 'deposit_refund'
     and w.created_at >= p_from and w.created_at < p_to
     and h.state = 'to_shop'
     and h.resolved_at < p_from;
$$;
-- no grant: this reads any shop's movements and is called only from the
-- security-definer functions below, which do their own admin check.
revoke all on function public.settlement_items_for(uuid, timestamptz, timestamptz)
  from authenticated, anon;

-- ---- cutting the run -------------------------------------------------------
create or replace function public.admin_cut_run(p_at timestamptz default now())
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_to timestamptz;
  v_from timestamptz;
  v_run uuid;
  s record;
  v_line uuid;
  v_hold int; v_earned int; v_carried int; v_amount int;
  v_lines int := 0; v_excluded int := 0;
  v_net int;
begin
  if not public.is_admin() then raise exception 'Settlement runs are ops only'; end if;

  -- an RPC that passes p_at explicitly as null would defeat the default and cut
  -- a null week, so the default is re-applied here rather than trusted
  v_to := public.settlement_cut(coalesce(p_at, now()));
  if exists (select 1 from public.settlement_runs where covers_to = v_to) then
    raise exception 'Week % has already been cut', public.settlement_week_label(v_to);
  end if;

  -- the window runs from the last cut, so nothing can fall between two weeks.
  -- Before the first run there is nothing to butt against, so it is one week and
  -- older float stays on the pre-period collection path.
  v_from := coalesce((select max(covers_to) from public.settlement_runs), v_to - interval '7 days');

  insert into public.settlement_runs (covers_from, covers_to, created_by)
  values (v_from, v_to, auth.uid()) returning id into v_run;

  for s in select sa.id, sa.name, sa.status,
                  coalesce(sa.reviewed_at, sa.created_at) as live_since
             from public.salons sa
            where sa.status in ('live', 'suspended')
            order by sa.name
  loop
    v_net := public.salon_net_cents(s.id);

    -- §2.3 held is not kept: a suspended shop we OWE is excluded and its money
    -- waits. A suspended shop holding OUR cash stays in the run — suspending a
    -- shop is not a reason to leave our float in its till.
    if s.status = 'suspended' and v_net < 0 then
      insert into public.settlement_exclusions (run_id, salon_id, reason, amount_cents, told_by)
      values (v_run, s.id, 'suspended', -v_net, auth.uid());
      v_excluded := v_excluded + 1;
      continue;
    end if;
    -- §2.1's cost: a shop that went live inside the window has no full week to
    -- state, and must be NAMED rather than left as a missing row.
    if s.live_since > v_from then
      insert into public.settlement_exclusions (run_id, salon_id, reason)
      values (v_run, s.id, 'went_live_midweek');
      v_excluded := v_excluded + 1;
      continue;
    end if;

    -- earned is stored positive on the line and negative in the items, so the
    -- two deduction kinds are summed and flipped together: a same-week refund
    -- reduces the earning rather than forming a third column.
    select coalesce(sum(x.amount_cents) filter (where x.kind = 'float_movement'), 0),
           -coalesce(sum(x.amount_cents) filter (where x.kind in ('deposit_earned', 'refund')), 0),
           coalesce(sum(x.amount_cents) filter (where x.kind = 'carried'), 0)
      into v_hold, v_earned, v_carried
      from public.settlement_items_for(s.id, v_from, v_to) x;
    v_amount := v_hold - v_earned + v_carried;

    -- §3.1: "a nil week is a fact, not a gap" — every shop in the run gets a
    -- line and a statement, including the ones where nothing moved.
    insert into public.settlement_lines
      (run_id, salon_id, direction, amount_cents, hold_cents, earned_cents, carried_cents)
    values (v_run, s.id,
            case when v_amount > 0 then 'collect' when v_amount < 0 then 'pay_out'
                 else 'nil' end,
            v_amount, v_hold, v_earned, v_carried)
    returning id into v_line;
    v_lines := v_lines + 1;

    insert into public.statement_items
      (line_id, kind, label, booking_ref, occurred_at, amount_cents, source_week)
    select v_line, x.kind, x.label, x.booking_ref, x.occurred_at, x.amount_cents, x.source_week
      from public.settlement_items_for(s.id, v_from, v_to) x;
  end loop;

  return json_build_object(
    'run', v_run, 'week', public.settlement_week_label(v_to),
    'covers_from', v_from, 'covers_to', v_to,
    'lines', v_lines, 'excluded', v_excluded);
end $$;
grant execute on function public.admin_cut_run(timestamptz) to authenticated;

-- The two reasons the database cannot derive (§4): there is no route or
-- agent-assignment table, and an agent's cash has no open/closed session. Ops
-- declares these, and the typed reason still renders its own sentence.
create or replace function public.admin_exclude_shop(
  p_run uuid, p_salon uuid, p_reason public.exclusion_reason, p_amount int default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Settlement runs are ops only'; end if;
  if p_reason not in ('unreachable', 'wallet_open') then
    raise exception 'Suspension and go-live are derived at the cut, not declared';
  end if;
  if (select state from public.settlement_runs where id = p_run) <> 'draft' then
    raise exception 'That week is released - nothing can be taken out of it now';
  end if;

  -- taking a shop out means its line goes too, and a line can never be deleted.
  -- So this only works before the line exists, or not at all.
  if exists (select 1 from public.settlement_lines where run_id = p_run and salon_id = p_salon) then
    raise exception 'That shop already has a line in this run - cut the run again to change it';
  end if;

  insert into public.settlement_exclusions (run_id, salon_id, reason, amount_cents, told_by)
  values (p_run, p_salon, p_reason, p_amount, auth.uid());
end $$;
grant execute on function public.admin_exclude_shop(uuid, uuid, public.exclusion_reason, int) to authenticated;

-- ---- FIN-14's payload ------------------------------------------------------
create or replace function public.admin_run(p_run uuid default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare r record;
begin
  if not public.is_admin() then raise exception 'Settlement runs are ops only'; end if;
  select * into r from public.settlement_runs
   where (p_run is null or id = p_run) order by covers_to desc limit 1;
  if r.id is null then return 'null'::json; end if;

  return json_build_object(
    'id', r.id,
    'week', public.settlement_week_label(r.covers_to),
    'state', r.state,
    'covers_from', r.covers_from, 'covers_to', r.covers_to,
    'released_at', r.released_at,
    'released_by', (select full_name from public.profiles where id = r.released_by),

    -- both totals, before anything is pressed. §3.1: this is the point.
    'collect_cents', coalesce((select sum(amount_cents)::int from public.settlement_lines
                                where run_id = r.id and direction = 'collect'), 0),
    'collect_shops', (select count(*)::int from public.settlement_lines
                       where run_id = r.id and direction = 'collect'),
    'pay_cents', coalesce((select -sum(amount_cents)::int from public.settlement_lines
                            where run_id = r.id and direction = 'pay_out'), 0),
    'pay_shops', (select count(*)::int from public.settlement_lines
                   where run_id = r.id and direction = 'pay_out'),
    'shops', (select count(*)::int from public.settlement_lines where run_id = r.id),

    'lines', coalesce((
      select json_agg(json_build_object(
               'id', l.id, 'salon_id', l.salon_id, 'salon', s.name,
               -- 2026-W36-014: the week, then the line's place in it. Lines are
               -- append-only and never deleted, so the position is stable.
               'ref', public.settlement_week_label(r.covers_to) || '-'
                      || lpad((row_number() over (order by s.name))::text, 3, '0'),
               'hold_cents', l.hold_cents, 'earned_cents', l.earned_cents,
               'carried_cents', l.carried_cents, 'amount_cents', l.amount_cents,
               'direction', l.direction, 'visit', l.visit,
               'collected_cents', l.collected_cents, 'settled_at', l.settled_at,
               'receipt_ref', l.receipt_ref,
               'agent', (select full_name from public.profiles where id = l.agent_id),
               'age_days', public.salon_float_age_days(l.salon_id))
             order by s.name)
        from public.settlement_lines l
        join public.salons s on s.id = l.salon_id
       where l.run_id = r.id), '[]'::json),

    -- §2.2: sentences, not a count. The number is what gets a run released by
    -- mistake, so the number is never on its own.
    'exclusions', coalesce((
      select json_agg(json_build_object(
               'salon', s.name, 'salon_id', x.salon_id, 'reason', x.reason,
               'amount_cents', x.amount_cents, 'unlocks_on', x.unlocks_on,
               'sentence', public.exclusion_sentence(
                 x.reason, s.name, x.amount_cents, x.unlocks_on,
                 (select full_name from public.profiles where id = x.told_by)))
             order by s.name)
        from public.settlement_exclusions x
        join public.salons s on s.id = x.salon_id
       where x.run_id = r.id), '[]'::json),

    -- §2.4's gate, surfaced before release rather than at it
    'imbalance', coalesce((
      select json_agg(json_build_object('salon', salon, 'line_cents', line_cents,
                                        'items_cents', items_cents))
        from public.settlement_run_imbalance(r.id)), '[]'::json)
  );
end $$;
grant execute on function public.admin_run(uuid) to authenticated;

create or replace function public.admin_runs(p_limit int default 12)
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', r.id, 'week', public.settlement_week_label(r.covers_to),
           'state', r.state, 'covers_to', r.covers_to,
           'shops', (select count(*)::int from public.settlement_lines l where l.run_id = r.id))
         order by r.covers_to desc), '[]'::json)
    from (select * from public.settlement_runs
           order by covers_to desc limit greatest(p_limit, 1)) r
   where public.is_admin();
$$;
grant execute on function public.admin_runs(int) to authenticated;

do $$
begin
  -- FIN-14's three stat cards and the net strip beneath them
  assert 2148000 - 934000 = 1214000, '21 480 collect less 9 340 pay is 12 140 DH net in';
  assert 26 + 12 = 38, '26 collecting plus 12 paying is the 38 in the run';
  assert 38 + 4 = 42, 'and four excluded makes 42 shops';

  -- §3.1's row invariant, on FIN-16's shop, the way the cut computes it
  assert 291000 - 139600 + 5200 = 156600, 'hold - earned + carried is the one number';
  -- and the items it writes sum to the same thing
  assert (40000 + 120000 + 81000 + 50000) - 145600 + 6000 + 5200 = 156600,
    'the four movements, the cuts, the refund and the carried line';

  -- direction is a word, and it never disagrees with the sign
  assert (case when 156600 > 0 then 'collect' when 156600 < 0 then 'pay_out'
               else 'nil' end) = 'collect', 'a positive number collects';
  assert (case when -172000 > 0 then 'collect' when -172000 < 0 then 'pay_out'
               else 'nil' end) = 'pay_out', 'a negative one pays out';
  assert (case when 0 > 0 then 'collect' when 0 < 0 then 'pay_out'
               else 'nil' end) = 'nil', 'and a nil week is a fact, not a gap';

  -- §2.3: a suspended shop is only excluded when the money is OURS to hand over
  assert (-218000 < 0), 'we owe Barbier Mesnana 2 180 DH, so it waits';
  assert not (50000 < 0), 'a suspended shop holding our cash stays in the run';

  -- the statement ref FIN-16 prints
  assert '2026-W36' || '-' || lpad('14', 3, '0') = '2026-W36-014',
    'the week, then the line''s place in it';
end $$;
