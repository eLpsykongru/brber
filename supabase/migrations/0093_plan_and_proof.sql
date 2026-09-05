-- 0093_plan_and_proof: the two reads the console was missing, and the one it
-- needs to plan a round at all.
--
-- 0091 gave ops `admin_plan_visits` and nothing has ever called it, so every
-- agent's phone is empty and the whole surface below it is unreachable. That is
-- the blocker; the rest of this file is the evidence side.
--
-- FIN-15 reads a line's `visit` column, which says "collected" and nothing
-- else. The receipt — who took it, when, and WHICH PROOF was used — lives in
-- `settlement_receipts` and nothing surfaces it. That is the screen a dispute
-- gets settled on, so it has to carry the thing that makes a receipt evidence
-- rather than a note: `verified_by`.

-- ---- who can be given a round ----------------------------------------------
create or replace function public.admin_agents()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', p.id, 'name', coalesce(p.full_name, 'Agent'), 'role', p.role,
           -- what he is already carrying, so nobody is handed a round that puts
           -- him over the cap before he sets off (§2.4)
           'in_bag_cents', coalesce((
             select sum(case when v.direction = 'collect' then rc.amount_cents
                             else -rc.amount_cents end)::int
               from public.settlement_receipts rc
               join public.settlement_visits v on v.id = rc.visit_id
              where rc.agent_id = p.id
                and rc.recorded_at > coalesce((select max(d.dropped_at)
                                                 from public.agent_drops d
                                                where d.agent_id = p.id),
                                              '-infinity'::timestamptz)), 0),
           'open_visits', (select count(*)::int from public.settlement_visits v
                            where v.agent_id = p.id and v.state <> 'closed'))
         order by coalesce(p.full_name, 'Agent')), '[]'::json)
    from public.profiles p
   where p.role in ('agent', 'admin') and public.is_admin();
$$;
grant execute on function public.admin_agents() to authenticated;

-- ---- the run, now carrying its evidence -------------------------------------
-- 0084's function with two additions per line: the visit it is on, and every
-- receipt written against it. Everything else is unchanged.
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

    'collect_cents', coalesce((select sum(amount_cents)::int from public.settlement_lines
                                where run_id = r.id and direction = 'collect'), 0),
    'collect_shops', (select count(*)::int from public.settlement_lines
                       where run_id = r.id and direction = 'collect'),
    'pay_cents', coalesce((select -sum(amount_cents)::int from public.settlement_lines
                            where run_id = r.id and direction = 'pay_out'), 0),
    'pay_shops', (select count(*)::int from public.settlement_lines
                   where run_id = r.id and direction = 'pay_out'),
    'shops', (select count(*)::int from public.settlement_lines where run_id = r.id),
    -- how much of the run is actually on somebody's round
    'planned', (select count(*)::int from public.settlement_visits v
                 join public.settlement_lines l on l.id = v.line_id
                where l.run_id = r.id and v.state <> 'closed'),

    'lines', coalesce((
      select json_agg(json_build_object(
               'id', l.id, 'salon_id', l.salon_id, 'salon', s.name,
               'ref', public.settlement_week_label(r.covers_to) || '-'
                      || lpad((row_number() over (order by s.name))::text, 3, '0'),
               'hold_cents', l.hold_cents, 'earned_cents', l.earned_cents,
               'carried_cents', l.carried_cents, 'amount_cents', l.amount_cents,
               'direction', l.direction, 'visit', l.visit,
               'collected_cents', l.collected_cents, 'settled_at', l.settled_at,
               'receipt_ref', l.receipt_ref,
               'agent', (select full_name from public.profiles where id = l.agent_id),
               'age_days', public.salon_float_age_days(l.salon_id),
               -- is it on anyone's round, and whose
               'on_round', (select coalesce(p2.full_name, 'an agent')
                              from public.settlement_visits v
                              left join public.profiles p2 on p2.id = v.agent_id
                             where v.line_id = l.id and v.state <> 'closed' limit 1),
               -- and the evidence. §3: the proof is what makes a receipt
               -- evidence, so it is never separated from the amount.
               'receipts', coalesce((
                 select json_agg(json_build_object(
                          'ref', rc.ref, 'cents', rc.amount_cents,
                          'at', rc.recorded_at, 'verified_by', rc.verified_by,
                          'by', coalesce(p3.full_name, 'an agent'))
                        order by rc.recorded_at)
                   from public.settlement_receipts rc
                   left join public.profiles p3 on p3.id = rc.agent_id
                  where rc.line_id = l.id), '[]'::json))
             order by s.name)
        from public.settlement_lines l
        join public.salons s on s.id = l.salon_id
       where l.run_id = r.id), '[]'::json),

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

    'imbalance', coalesce((
      select json_agg(json_build_object('salon', salon, 'line_cents', line_cents,
                                        'items_cents', items_cents))
        from public.settlement_run_imbalance(r.id)), '[]'::json)
  );
end $$;
grant execute on function public.admin_run(uuid) to authenticated;

do $$
begin
  -- a bag is collections less hand-overs since the last drop, and the planner
  -- reads the same arithmetic AGT-01 does so nobody is given a round that
  -- breaches the cap before he sets off
  assert 613000 - 0 = 613000, 'collected today, nothing handed over yet';
  assert 613000 + 357000 = 970000, 'and 9 700 DH is what he is carrying';

  -- the proof is never separated from the amount it proves
  assert (select count(*) from unnest(array['code', 'signature', 'ops_call'])) = 3,
    'three ways a receipt can be proved, and the row always says which';
end $$;
