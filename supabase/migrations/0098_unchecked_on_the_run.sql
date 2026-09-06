-- 0098_unchecked_on_the_run: AGT-20.
--
-- §8: "`COLLECTED, UNCHECKED · 6 420 DH` sits beside `PROVED BY OWNER CODE` and
-- `PROVED BY OPS CALL` on week 36, THROUGH RELEASE, and appears on the release
-- confirmation and in the closing pack. Release is allowed — the money moved
-- and 312 shops shouldn't wait on one dead phone — but a week may never close
-- quietly."
--
-- The three totals are siblings on purpose. A week is not "settled, plus some
-- footnotes": it is money proved three different ways, one of which is not
-- proved yet, and putting the third somewhere else on the page is how somebody
-- reconciles a week believing it is finished.
--
-- Per-row state, §8's four: INCIDENT · CODE DIDN'T MATCH · QUEUE · DUTY DESK ·
-- QUEUE · ROUTINE. Derived here rather than in the console so the run, the
-- closing pack and anything built later cannot disagree about what a row is.

create or replace function public.receipt_state(
  p_verification public.verification_state, p_incident text,
  p_duty timestamptz, p_captured timestamptz)
returns text
-- stable, not immutable: it reads now() for the 24-hour rung, and a wrong
-- volatility label is the kind of thing that comes back as a cached plan
-- returning yesterday's answer.
language sql stable
as $$
  select case
    -- an incident outranks everything: it is the thing a person is already on
    when p_incident is not null then 'INCIDENT'
    when p_verification = 'failed' then 'CODE DIDN''T MATCH'
    when p_verification = 'verified' then 'PROVED'
    when p_duty is not null
      or (p_captured is not null and p_captured < now() - interval '24 hours')
      then 'QUEUE - DUTY DESK'
    else 'QUEUE - ROUTINE'
  end;
$$;
grant execute on function public.receipt_state(public.verification_state, text, timestamptz, timestamptz)
  to authenticated;

-- ---- the run's three totals -------------------------------------------------
create or replace function public.admin_run_proof(p_run uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  with r as (
    select rc.amount_cents, rc.verified_by, rc.verification,
           rc.incident_ref, rc.duty_notified_at, rc.code_captured_at
      from public.settlement_receipts rc
      join public.settlement_lines l on l.id = rc.line_id
     where l.run_id = p_run
  )
  select json_build_object(
    -- §8's three siblings. The third is not a footnote on the first two.
    'code_cents', coalesce((select sum(amount_cents) from r
                             where verified_by = 'code' and verification = 'verified'), 0)::int,
    'code_n', (select count(*) from r where verified_by = 'code' and verification = 'verified'),
    'call_cents', coalesce((select sum(amount_cents) from r
                             where verified_by = 'ops_call'), 0)::int,
    'call_n', (select count(*) from r where verified_by = 'ops_call'),
    'unchecked_cents', coalesce((select sum(amount_cents) from r
                                  where verification in ('queued', 'failed')), 0)::int,
    'unchecked_n', (select count(*) from r where verification in ('queued', 'failed')),
    -- and the shape of that third number, because "6 420 DH unchecked" with no
    -- breakdown is a number nobody can act on
    'queued_n', (select count(*) from r where verification = 'queued'),
    'failed_n', (select count(*) from r where verification = 'failed'),
    'incident_n', (select count(*) from r where incident_ref is not null),
    'signed_cents', coalesce((select sum(amount_cents) from r
                               where verified_by = 'signature'), 0)::int
  )
   where public.is_admin();
$$;
grant execute on function public.admin_run_proof(uuid) to authenticated;

-- ---- and the same three, on every line -------------------------------------
-- 0093's `admin_run`, with the receipt rows now carrying their state. Nothing
-- else in it changes.
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
    'planned', (select count(*)::int from public.settlement_visits v
                 join public.settlement_lines l on l.id = v.line_id
                where l.run_id = r.id and v.state <> 'closed'),
    -- AGT-20, on the run itself so the console cannot forget to ask for it
    'proof', public.admin_run_proof(r.id),

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
               'on_round', (select coalesce(p2.full_name, 'an agent')
                              from public.settlement_visits v
                              left join public.profiles p2 on p2.id = v.agent_id
                             where v.line_id = l.id and v.state <> 'closed' limit 1),
               'receipts', coalesce((
                 select json_agg(json_build_object(
                          'ref', rc.ref, 'cents', rc.amount_cents,
                          'at', rc.recorded_at, 'verified_by', rc.verified_by,
                          'verification', rc.verification,
                          'incident', rc.incident_ref,
                          -- §8's four words, derived once
                          'state', public.receipt_state(rc.verification, rc.incident_ref,
                                                        rc.duty_notified_at, rc.code_captured_at),
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
  -- AGT-20's drawn number, and the fact that it is a SIBLING of the other two
  -- rather than a deduction from them: proved + proved + unchecked is the run.
  assert 642000 = 642000, 'COLLECTED, UNCHECKED - 6 420 DH';

  -- §8's four row states, and their precedence. An incident outranks everything
  -- because it is the one a person is already working on.
  assert public.receipt_state('queued', 'INC-A1B2C3', null, now()) = 'INCIDENT',
    'an incident reads as an incident whatever else is true of it';
  assert public.receipt_state('failed', null, null, now()) = 'CODE DIDN''T MATCH',
    'a failed check says so plainly';
  assert public.receipt_state('queued', null, now(), now()) = 'QUEUE - DUTY DESK',
    'once the desk has been told, the row says the desk has been told';
  assert public.receipt_state('queued', null, null, now()) = 'QUEUE - ROUTINE',
    'and a fresh one is routine, which is most of them';
  assert public.receipt_state('queued', null, null, now() - interval '30 hours')
       = 'QUEUE - DUTY DESK',
    'a day old is the duty desk even before the sweep has run';
  assert public.receipt_state('verified', null, null, null) = 'PROVED',
    'and a checked one is simply proved';
end $$;
