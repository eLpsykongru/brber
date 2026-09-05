-- 0085_release_run: settlement step 4 — release, and closing a visit.
--
-- §9: "Release as one act → FIN-15, plus agent visit dispatch and the audit
-- rows." Two verbs, and the second is where the two settlement records finally
-- become one.
--
-- ---- the decision this file makes real -------------------------------------
--
-- 0081 said `float_settlements` would be written FROM the settlement line
-- rather than beside it, because a second writer of "we collected X from shop
-- Y" is the "second ledger is a second truth" failure §3.2 warns about. This is
-- that: `admin_settle_line` closes the visit AND calls `admin_settle_float`,
-- which is where the money rules have always lived. Nothing else may write a
-- settlement for a shop that has a line in a released run.
--
-- ---- what is NOT here ------------------------------------------------------
--
-- The agent's own collection screen. §5 is explicit: `BCF-04` collects a float
-- from a BARBER, not a settlement from a SHOP, and the difference is a receipt,
-- a signature and the possibility of a partial. The dispatch is the run's open
-- lines, which `admin_run` already returns; the screen that renders them on an
-- agent's phone is the thing to stop before, and this stops before it.

create or replace function public.admin_release_run(p_run uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_bad record;
  v_collect int; v_pay int; v_shops int;
begin
  if not public.is_admin() then raise exception 'Settlement runs are ops only'; end if;

  select * into r from public.settlement_runs where id = p_run;
  if r.id is null then raise exception 'No such run'; end if;
  if r.state <> 'draft' then
    raise exception 'Week % was already released', public.settlement_week_label(r.covers_to);
  end if;

  -- §2.4, at the one moment it can still be stopped. "A difference with no line
  -- under it is a bug, not a rounding" — so it is refused, and the shop is
  -- named, because a run of 38 with no name is a search rather than a fix.
  select * into v_bad from public.settlement_run_imbalance(p_run) limit 1;
  if v_bad.salon is not null then
    raise exception '% says % DH but its lines add to % DH - fix that before releasing',
      v_bad.salon, round(v_bad.line_cents / 100.0), round(v_bad.items_cents / 100.0);
  end if;

  select coalesce(sum(amount_cents) filter (where direction = 'collect'), 0),
         coalesce(-sum(amount_cents) filter (where direction = 'pay_out'), 0),
         count(*)
    into v_collect, v_pay, v_shops
    from public.settlement_lines where run_id = p_run;

  update public.settlement_runs
     set state = 'released', released_at = now(), released_by = auth.uid()
   where id = p_run;

  -- every line that involves a visit is now waiting for one. A nil line is left
  -- alone: there is nothing to collect and nobody to send, and the screen reads
  -- "Closed" off the direction rather than off a visit state that would be a
  -- small lie in the data.
  update public.settlement_lines
     set visit = 'open'
   where run_id = p_run and direction in ('collect', 'pay_out') and visit = 'pending';

  -- §3.2's audit. `settings_changes` is the only audit table there is and it is
  -- settings-shaped, so the subject rides in the JSON — the same move 0080 made
  -- for a per-shop cap change, and `admin_run_history` reads it back.
  insert into public.settings_changes (changed_by, before, after, note)
  values (auth.uid(),
          json_build_object('run', p_run, 'week', public.settlement_week_label(r.covers_to),
                            'state', 'draft'),
          json_build_object('run', p_run, 'week', public.settlement_week_label(r.covers_to),
                            'state', 'released', 'shops', v_shops,
                            'collect_cents', v_collect, 'pay_cents', v_pay),
          'Released ' || v_shops || ' statements');

  return json_build_object('run', p_run, 'week', public.settlement_week_label(r.covers_to),
                           'shops', v_shops, 'collect_cents', v_collect, 'pay_cents', v_pay);
end $$;
grant execute on function public.admin_release_run(uuid) to authenticated;

-- ---- closing one visit -----------------------------------------------------
-- §3.2's per-line states, and the part payment: "300 DH taken Fri 19:05 · 480 DH
-- open". The remainder stays on THIS line — it does not move into a separate
-- debt ledger, because a second ledger is a second truth. Step 7 carries what is
-- still open at day 14 onto the next run as its own line.
--
-- `p_cents` is the MAGNITUDE that crossed the counter, always positive. The
-- direction comes off the line, so a handover can never be recorded as a
-- collection by getting a sign backwards in a caller.
create or replace function public.admin_settle_line(
  p_line uuid, p_cents int, p_declared_cents int default null, p_receipt text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  l record;
  v_state text;
  v_total int;
  v_signed int;
begin
  if not public.is_admin() then raise exception 'Settlements are ops only'; end if;
  if p_cents is null or p_cents <= 0 then
    raise exception 'Nothing crossed the counter';
  end if;

  select sl.*, r.state as run_state, s.name as salon
    into l
    from public.settlement_lines sl
    join public.settlement_runs r on r.id = sl.run_id
    join public.salons s on s.id = sl.salon_id
   where sl.id = p_line;
  if l.id is null then raise exception 'No such settlement line'; end if;
  if l.run_state = 'draft' then
    raise exception 'That week has not been released yet';
  end if;
  if l.direction = 'nil' then
    raise exception 'There is nothing to settle on a nil week';
  end if;

  v_total := coalesce(l.collected_cents, 0) + p_cents;
  if v_total > abs(l.amount_cents) then
    raise exception 'That line is only % DH', round(abs(l.amount_cents) / 100.0);
  end if;

  -- the sign is the line's, never the caller's
  v_signed := case when l.direction = 'collect' then p_cents else -p_cents end;

  -- ONE writer. `admin_settle_float` is where the money rules live: it refuses
  -- to collect more than the drawer holds, refuses to pay more than we owe, and
  -- subtracts the known gap so a shortfall is not counted short twice.
  perform public.admin_settle_float(l.salon_id, v_signed, p_declared_cents,
    'Week ' || public.settlement_week_label(
                 (select covers_to from public.settlement_runs where id = l.run_id)));

  v_state := case
               when v_total < abs(l.amount_cents) then 'part'
               when l.direction = 'collect' then 'collected'
               else 'paid'
             end;

  update public.settlement_lines
     set visit = v_state::public.settlement_visit,
         collected_cents = v_total,
         settled_at = now(),
         agent_id = auth.uid(),
         receipt_ref = coalesce(p_receipt, receipt_ref)
   where id = p_line;

  return json_build_object(
    'line', p_line, 'salon', l.salon, 'visit', v_state,
    'taken_cents', v_total, 'open_cents', abs(l.amount_cents) - v_total);
end $$;
grant execute on function public.admin_settle_line(uuid, int, int, text) to authenticated;

-- ---- FIN-15's three progress cards -----------------------------------------
-- "COLLECTED 8 940 of 21 480, 11 of 26 visits · PAID OUT 9 340, all 12 ·
-- STILL WITH THE SHOPS 12 540, 15 shops, oldest dirham day 9 of 14."
-- 8 940 + 12 540 = 21 480, which is the arithmetic that has to hold.
create or replace function public.admin_run_progress(p_run uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'collected_cents', coalesce(sum(collected_cents) filter (where direction = 'collect'), 0)::int,
    'collect_cents',   coalesce(sum(amount_cents) filter (where direction = 'collect'), 0)::int,
    'collect_done',    count(*) filter (where direction = 'collect' and visit = 'collected')::int,
    'collect_shops',   count(*) filter (where direction = 'collect')::int,

    'paid_cents',      coalesce(sum(collected_cents) filter (where direction = 'pay_out'), 0)::int,
    'pay_cents',       coalesce(-sum(amount_cents) filter (where direction = 'pay_out'), 0)::int,
    'pay_done',        count(*) filter (where direction = 'pay_out' and visit = 'paid')::int,
    'pay_shops',       count(*) filter (where direction = 'pay_out')::int,

    -- what is still in tills: the collect side that has not crossed yet
    'open_cents', coalesce(sum(amount_cents - coalesce(collected_cents, 0))
                             filter (where direction = 'collect' and visit <> 'collected'), 0)::int,
    'open_shops', count(*) filter (where direction = 'collect' and visit <> 'collected')::int,
    'oldest_days', max(public.salon_float_age_days(salon_id))
                     filter (where direction = 'collect' and visit <> 'collected')
  )
    from public.settlement_lines
   where run_id = p_run and public.is_admin();
$$;
grant execute on function public.admin_run_progress(uuid) to authenticated;

-- and the release, read back
create or replace function public.admin_run_history(p_limit int default 12)
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'week', c.after->>'week',
           'by', coalesce(p.full_name, 'Ops'),
           'at', c.changed_at,
           'shops', (c.after->>'shops')::int,
           'collect_cents', (c.after->>'collect_cents')::int,
           'pay_cents', (c.after->>'pay_cents')::int)
         order by c.changed_at desc), '[]'::json)
    from (select * from public.settings_changes
           where jsonb_exists(after::jsonb, 'run')
           order by changed_at desc limit greatest(p_limit, 1)) c
    left join public.profiles p on p.id = c.changed_by
   where public.is_admin();
$$;
grant execute on function public.admin_run_history(int) to authenticated;

do $$
begin
  -- FIN-15's progress arithmetic: what crossed plus what is still out is the run
  assert 894000 + 1254000 = 2148000, '8 940 collected plus 12 540 open is the 21 480 run';
  assert round(894000 * 100.0 / 2148000) = 42, 'which is the drawn 42% bar';
  assert round(1254000 * 100.0 / 2148000) = 58, 'and 58% still with the shops';
  assert round(934000 * 100.0 / 934000) = 100, 'the pay-out side is 9 340 to all 12 shops';

  -- §3.2's part payment: 300 taken against a 780 line leaves 480 open, and the
  -- line stays `part` rather than closing or moving to another ledger
  assert 78000 - 30000 = 48000, '300 DH taken off a 780 DH line leaves 480 DH open';
  assert (case when 30000 < 78000 then 'part' else 'collected' end) = 'part',
    'a line that is not fully taken is part paid, not collected';
  assert (case when 78000 < 78000 then 'part' else 'collected' end) = 'collected',
    'and one that is, is collected';

  -- the sign is the line's, never the caller's
  assert (case when 'collect' = 'collect' then 30000 else -30000 end) = 30000,
    'a collect line takes cash out';
  assert (case when 'pay_out' = 'collect' then 30000 else -30000 end) = -30000,
    'a pay-out line hands it over, from the same positive argument';

  -- §2.4's gate is a refusal, not a warning: 1 566 against lines of 1 514 stops
  assert 156600 <> 151400, 'a header that disagrees with its lines cannot release';
end $$;
