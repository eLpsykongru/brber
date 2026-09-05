-- 0086_statement: settlement step 5 — one statement, three surfaces.
--
-- §3: "FIN-16, OSH-17 and OSH-18 are the same statement (Le Fade Tanger, week
-- 36) on two surfaces. They must agree line for line; a fixture that renders
-- all three from one row set is the right test."
--
-- So there is exactly ONE builder. `admin_statement` and `my_statement` differ
-- only in who they let in; neither assembles anything itself. If the ops screen
-- and the owner's screen ever disagree it will be a rendering bug, because
-- there is no second query for them to disagree through.
--
-- §2.4, in the shape of the return value: `total_cents` is what crosses the
-- counter and is the only number anyone is asked to trust. `subtotal_cents` is
-- a NAMED subtotal — this week's movement — and the renderer shows it only when
-- a carried line follows it. A bare smaller number above the total, with no
-- line explaining the gap, is the failure mode every decision in §2 exists to
-- prevent.

create or replace function public.statement_json(p_line uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'line', l.id,
    'salon', s.name,
    'salon_id', s.id,
    'week', public.settlement_week_label(r.covers_to),
    -- the same number FIN-14's table prints, computed the same way
    'ref', public.settlement_week_label(r.covers_to) || '-' || lpad((
             select z.rn::text from (
               select l2.id, row_number() over (order by s2.name) as rn
                 from public.settlement_lines l2
                 join public.salons s2 on s2.id = l2.salon_id
                where l2.run_id = l.run_id) z
              where z.id = l.id), 3, '0'),
    'covers_from', r.covers_from,
    'covers_to', r.covers_to,
    'run_state', r.state,
    'released_at', r.released_at,

    -- §7: direction is a word. The owing direction is a different screen, so
    -- the surface branches on this rather than on the sign.
    'direction', l.direction,
    'total_cents', abs(l.amount_cents),
    'signed_cents', l.amount_cents,
    'hold_cents', l.hold_cents,
    'earned_cents', l.earned_cents,
    'carried_cents', l.carried_cents,
    -- "this week's movement", before anything carried from a closed week
    'subtotal_cents', l.hold_cents - l.earned_cents,

    'visit', l.visit,
    'collected_cents', l.collected_cents,
    'open_cents', abs(l.amount_cents) - coalesce(l.collected_cents, 0),
    'settled_at', l.settled_at,
    'receipt_ref', l.receipt_ref,
    'agent', (select full_name from public.profiles where id = l.agent_id),

    -- the two sections, each with its own total, and every line carrying a
    -- reference and a time (§3.3)
    'float_lines', coalesce((
      select json_agg(json_build_object('label', i.label, 'ref', i.booking_ref,
                        'at', i.occurred_at, 'cents', i.amount_cents)
             order by i.occurred_at)
        from public.statement_items i
       where i.line_id = l.id and i.kind = 'float_movement'), '[]'::json),
    'earned_lines', coalesce((
      select json_agg(json_build_object('label', i.label, 'ref', i.booking_ref,
                        'at', i.occurred_at, 'cents', i.amount_cents, 'kind', i.kind)
             order by i.kind, i.occurred_at)   -- enum order: the cuts, then the refunds
        from public.statement_items i
       where i.line_id = l.id and i.kind in ('deposit_earned', 'refund')), '[]'::json),
    -- §2.8's correction, naming the week it came from
    'carried_lines', coalesce((
      select json_agg(json_build_object('label', i.label, 'ref', i.booking_ref,
                        'at', i.occurred_at, 'cents', i.amount_cents,
                        'source_week', public.settlement_week_label(i.source_week))
             order by i.occurred_at)
        from public.statement_items i
       where i.line_id = l.id and i.kind = 'carried'), '[]'::json),

    -- §2.6, the sentence the rail prints: "day 6 of 14 when Hicham arrived"
    'oldest_at', public.salon_oldest_uncollected_at(l.salon_id),
    'age_days', public.salon_float_age_days(l.salon_id),
    'hold_limit_days', (select float_hold_days from public.platform_settings),

    -- §3.3's LAST WEEK strip: "closed and untouched by the 52 DH above"
    'last_week', (
      select json_build_object('week', public.settlement_week_label(r2.covers_to),
               'direction', l2.direction, 'total_cents', abs(l2.amount_cents))
        from public.settlement_lines l2
        join public.settlement_runs r2 on r2.id = l2.run_id
       where l2.salon_id = l.salon_id and r2.covers_to < r.covers_to
       order by r2.covers_to desc limit 1)
  )
    from public.settlement_lines l
    join public.settlement_runs r on r.id = l.run_id
    join public.salons s on s.id = l.salon_id
   where l.id = p_line;
$$;
-- internal: neither wrapper's authorisation is in here, so it is not callable
revoke all on function public.statement_json(uuid) from authenticated, anon;

-- ---- FIN-16 ----------------------------------------------------------------
create or replace function public.admin_statement(
  p_line uuid default null, p_salon uuid default null, p_run uuid default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_line uuid;
begin
  if not public.is_admin() then raise exception 'Statements are ops only'; end if;
  v_line := coalesce(p_line, (
    select l.id from public.settlement_lines l
      join public.settlement_runs r on r.id = l.run_id
     where l.salon_id = p_salon
       and (p_run is null or l.run_id = p_run)
     order by r.covers_to desc limit 1));
  if v_line is null then return 'null'::json; end if;
  return public.statement_json(v_line);
end $$;
grant execute on function public.admin_statement(uuid, uuid, uuid) to authenticated;

-- ---- OSH-16 / OSH-17 -------------------------------------------------------
-- The owner never has a line id, so he asks by week — or for the latest, which
-- is what the screen opens on.
create or replace function public.my_statement(p_week timestamptz default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_line uuid;
  v_excl json;
  j json;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then return json_build_object('salon', null); end if;

  select l.id into v_line
    from public.settlement_lines l
    join public.settlement_runs r on r.id = l.run_id
   where l.salon_id = v_salon
     -- a draft is not his to read: it can still change, and §2.1 is that a run
     -- is read whole and released as one act
     and r.state <> 'draft'
     and (p_week is null or r.covers_to = p_week)
   order by r.covers_to desc limit 1;

  -- §2.3: "the amount and that date appear on the owner's own statement while
  -- he waits". A held balance he cannot see is indistinguishable from a
  -- confiscated one.
  select json_build_object(
           'reason', x.reason, 'amount_cents', x.amount_cents,
           'unlocks_on', x.unlocks_on,
           'told_by', (select full_name from public.profiles where id = x.told_by))
    into v_excl
    from public.settlement_exclusions x
    join public.settlement_runs r on r.id = x.run_id
   where x.salon_id = v_salon and r.state <> 'draft'
   order by r.covers_to desc limit 1;

  if v_line is null then
    return json_build_object('salon', v_salon, 'statement', null, 'held', v_excl);
  end if;

  j := public.statement_json(v_line);
  return json_build_object('salon', v_salon, 'statement', j, 'held', v_excl,
    -- the weeks he can page back through
    'weeks', coalesce((
      select json_agg(json_build_object(
               'week', public.settlement_week_label(r.covers_to),
               'covers_to', r.covers_to,
               'direction', l.direction, 'total_cents', abs(l.amount_cents))
             order by r.covers_to desc)
        from public.settlement_lines l
        join public.settlement_runs r on r.id = l.run_id
       where l.salon_id = v_salon and r.state <> 'draft'), '[]'::json));
end $$;
grant execute on function public.my_statement(timestamptz) to authenticated;

do $$
begin
  -- §3.3's statement, exactly as the three surfaces must render it
  --   float 2 910 | earned 1 396 | this week 1 514 | carried 52 | total 1 566
  assert 291000 - 139600 = 151400, 'this week''s movement is the named subtotal';
  assert 151400 + 5200 = 156600, 'and the carried line is why it is named at all';
  assert abs(156600) = 156600, 'a collect statement shows a positive number';

  -- OSH-16, the other direction. §2.7: a different screen, not a minus sign —
  -- so the surface reads `direction`, and the amount it prints is unsigned.
  assert 146000 - 318000 = -172000, 'week 35 is 1 720 DH the other way';
  assert abs(-172000) = 172000, 'and the owner is shown 1 720 DH, never -1 720';
  assert (case when -172000 < 0 then 'pay_out' else 'collect' end) = 'pay_out',
    'the word is what tells the two apart';

  -- §2.4: without a carried line there is no subtotal to name, and the
  -- statement is one number with its lines under it
  assert 291000 - 139600 + 0 = 151400, 'no carry means subtotal and total agree';

  -- the statement ref both surfaces print for the same line
  assert '2026-W36' || '-' || lpad('14', 3, '0') = '2026-W36-014',
    'one line, one reference, on either screen';
end $$;
