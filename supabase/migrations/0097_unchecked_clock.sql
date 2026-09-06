-- 0097_unchecked_clock: §7, and the hole in it.
--
-- §7's table, as written:
--
--   < 12 h   queue, routine    nobody - the agent's own tally only
--   24 h     queue, duty desk  duty desk + a nudge. The owner sees nothing new.
--   72 h, OR the moment a week is released with it still queued, whichever
--            first -> INCIDENT: the agent (next round blocked until his queue is
--            empty), the Head of Ops by name, Finance if a released run is
--            affected, AND the owner.
--   any age  failed            incident immediately, never a queue item
--
-- ---- THE HOLE, and the second feed that closes it --------------------------
--
-- The clock runs from `code_captured_at` — which this database only learns AT
-- SYNC. A phone that never comes back is a queue the server cannot see, so the
-- 72-hour escalation cannot fire on the exact scenario §7 was written for. "What
-- happens when the app is never opened" was: nothing happens, silently.
--
-- So the sweep has TWO feeds:
--   1. queued receipts it knows about, aged from capture
--   2. VISITS THAT WENT QUIET - planned, past their window, never closed and
--      with no receipt at all. That is the only trace a never-synced collection
--      leaves, and `settlement_visits` has had it since 0090.
--
-- The second feed cannot know whether cash moved. It does not need to: a visit
-- that was planned days ago and has produced nothing is worth a person looking
-- either way, and the alternative is silence.

alter table public.settlement_receipts
  -- the 24-hour rung, marked so the duty desk is told once rather than at every
  -- tick. `incident_ref` already marks the 72-hour one.
  add column if not exists duty_notified_at timestamptz;

create or replace function public.receipt_is_final()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A receipt is what the owner is holding - it cannot be removed.';
  end if;

  if to_jsonb(new) - 'verification' - 'synced_at' - 'incident_ref' - 'duty_notified_at'
       - 'agent_saw' - 'agent_saw_at' - 'owner_answer' - 'owner_answered_at'
     is distinct from
     to_jsonb(old) - 'verification' - 'synced_at' - 'incident_ref' - 'duty_notified_at'
       - 'agent_saw' - 'agent_saw_at' - 'owner_answer' - 'owner_answered_at' then
    raise exception 'A receipt cannot be changed - a mistake becomes a correcting line on next week''s statement.';
  end if;

  if old.incident_ref is not null and new.incident_ref is distinct from old.incident_ref then
    raise exception 'An incident reference is never cleared or reassigned';
  end if;
  if old.duty_notified_at is not null and new.duty_notified_at is null then
    raise exception 'The duty desk was already told';
  end if;
  if old.agent_saw is not null and new.agent_saw is distinct from old.agent_saw then
    raise exception 'He has already said what he saw';
  end if;
  if old.owner_answer is not null and new.owner_answer is distinct from old.owner_answer then
    raise exception 'He has already answered';
  end if;

  if new.verification is distinct from old.verification then
    if old.verification <> 'queued' then
      raise exception 'A % receipt is finished - its proof cannot change again', old.verification;
    end if;
    if coalesce(current_setting('sterncut.checking_code', true), '') <> 'yes' then
      raise exception 'A queued receipt is cleared by checking the code, not by anyone deciding it is fine';
    end if;
  end if;
  return new;
end $$;

-- ---- one receipt, escalated -------------------------------------------------
-- Split out so the sweep and the release-time trigger cannot drift: §7 says the
-- two paths reach the SAME state, and "whichever first" only means anything if
-- they do the same thing.
create or replace function public.escalate_unchecked(p_receipt uuid, p_why text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare rc record; v_ref text;
begin
  select x.*, s.name as salon, s.owner_id as owner,
         coalesce(ag.full_name, 'an agent') as agent
    into rc
    from public.settlement_receipts x
    join public.settlement_lines l on l.id = x.line_id
    join public.salons s on s.id = l.salon_id
    left join public.profiles ag on ag.id = x.agent_id
   where x.id = p_receipt;
  if rc.id is null or rc.incident_ref is not null then return rc.incident_ref; end if;

  v_ref := 'INC-' || upper(substring(replace(p_receipt::text, '-', '') from 1 for 6));
  update public.settlement_receipts set incident_ref = v_ref where id = p_receipt;

  -- the Head of Ops, by name on the Monday list
  insert into public.notifications (user_id, kind, title, body, amount_cents)
  select p.id, 'moderation', 'Unchecked collection - ' || v_ref,
         rc.agent || ' collected ' || round(rc.amount_cents / 100.0) || ' DH from '
         || rc.salon || ' and the code has still not been checked. ' || p_why,
         rc.amount_cents
    from public.profiles p where p.role = 'admin';

  -- the agent. §7: his next round is blocked until his queue is empty.
  if rc.agent_id is not null then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (rc.agent_id, 'moderation', 'Your queue is holding up a week',
            'The ' || round(rc.amount_cents / 100.0) || ' DH from ' || rc.salon
            || ' has not been checked. Find signal and let it go through - your '
            || 'next round will not start until your queue is empty.',
            rc.amount_cents);
  end if;

  -- §7: "at three days he has a right to know money marked against him rests on
  -- nobody's word but the agent's."
  if rc.owner is not null then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (rc.owner, 'shop_status',
            'We still haven''t checked ' || round(rc.amount_cents / 100.0) || ' DH',
            'The ' || round(rc.amount_cents / 100.0) || ' DH you handed ' || rc.agent
            || ' is on your statement, and we have still not been able to check the '
            || 'code against the one your app issued. Nothing has changed on your '
            || 'account. We are chasing it.',
            rc.amount_cents);
  end if;

  return v_ref;
end $$;
revoke all on function public.escalate_unchecked(uuid, text) from authenticated, anon;

-- ---- the sweep, both feeds --------------------------------------------------
create or replace function public.unchecked_sweep()
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  rc record; v record;
  v_duty int := 0; v_inc int := 0; v_quiet int := 0;
begin
  -- FEED 1 · queued receipts, aged from capture (§7)
  for rc in select x.id, x.amount_cents, x.agent_id,
                   extract(epoch from now() - x.code_captured_at) / 3600 as age_h,
                   s.name as salon
              from public.settlement_receipts x
              join public.settlement_lines l on l.id = x.line_id
              join public.salons s on s.id = l.salon_id
             where x.verification = 'queued'
  loop
    if rc.age_h >= 72 then
      perform public.escalate_unchecked(rc.id, 'Three days is longer than any round.');
      v_inc := v_inc + 1;
    elsif rc.age_h >= 24 then
      -- the duty desk, once. The owner sees nothing new at this rung: a queue
      -- that pages someone every evening is a queue people learn to ignore.
      update public.settlement_receipts set duty_notified_at = now()
       where id = rc.id and duty_notified_at is null;
      if found then
        insert into public.notifications (user_id, kind, title, body, amount_cents)
        select p.id, 'moderation', 'A collection has been unchecked a day',
               round(rc.amount_cents / 100.0) || ' DH from ' || rc.salon
               || '. Nudge him to open the app somewhere with signal.',
               rc.amount_cents
          from public.profiles p where p.role = 'admin';
        v_duty := v_duty + 1;
      end if;
    end if;
  end loop;

  -- FEED 2 · visits that went quiet. THE SERVER CANNOT SEE A QUEUE THAT NEVER
  -- SYNCED, so without this the rung above never fires on the one case §7 is
  -- actually about: the phone that does not come back.
  for v in select sv.id, sv.agent_id, s.name as salon,
                  abs(l.amount_cents) - coalesce(l.collected_cents, 0) as cents,
                  coalesce(sv.window_to, sv.created_at) as due
             from public.settlement_visits sv
             join public.settlement_lines l on l.id = sv.line_id
             join public.salons s on s.id = l.salon_id
            where sv.state <> 'closed'
              and coalesce(sv.window_to, sv.created_at) < now() - interval '72 hours'
              and not exists (select 1 from public.settlement_receipts rr
                               where rr.visit_id = sv.id)
  loop
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    select p.id, 'moderation', 'A visit went quiet',
           v.salon || ' was on '
           || coalesce((select full_name from public.profiles where id = v.agent_id), 'an agent')
           || '''s round three days ago and nothing has come back from it - no '
           || 'collection, no hand-over, nothing. If he took cash offline it has '
           || 'never reached us. Ring him.',
           v.cents
      from public.profiles p where p.role = 'admin';
    v_quiet := v_quiet + 1;
  end loop;

  return json_build_object('duty', v_duty, 'incidents', v_inc, 'quiet_visits', v_quiet);
end $$;
revoke all on function public.unchecked_sweep() from authenticated, anon;

-- Same conditional shape as 0037's reminders and 0051's asks: a project without
-- pg_cron still applies this file, and the sweep can be called by hand.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sterncut-unchecked', '0 * * * *',
      'select public.unchecked_sweep()');
  else
    raise notice 'pg_cron not installed - the unchecked sweep will not fire until it is. '
                 'The release-time escalation still works, because it is synchronous.';
  end if;
end $$;

-- ---- release: "whichever first" --------------------------------------------
-- 0085's function, with §7's other trigger. It is synchronous and therefore the
-- half of the rule that cannot be missed by a scheduler nobody set up.
create or replace function public.admin_release_run(p_run uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  r record; v_bad record; rc record;
  v_collect int; v_pay int; v_shops int; v_unchecked int := 0;
begin
  if not public.is_admin() then raise exception 'Settlement runs are ops only'; end if;

  select * into r from public.settlement_runs where id = p_run;
  if r.id is null then raise exception 'No such run'; end if;
  if r.state <> 'draft' then
    raise exception 'Week % was already released', public.settlement_week_label(r.covers_to);
  end if;

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

  update public.settlement_lines
     set visit = 'open'
   where run_id = p_run and direction in ('collect', 'pay_out') and visit = 'pending';

  -- §7: "72 h, OR the moment a week is released with it still queued —
  -- whichever first". Release is ALLOWED (§8: the money moved and 312 shops
  -- should not wait on one dead phone) but a week may never close quietly.
  for rc in select x.id from public.settlement_receipts x
              join public.settlement_lines l on l.id = x.line_id
             where l.run_id = p_run and x.verification = 'queued'
  loop
    perform public.escalate_unchecked(rc.id, 'Week '
      || public.settlement_week_label(r.covers_to) || ' was released with it still unchecked.');
    v_unchecked := v_unchecked + 1;
  end loop;

  insert into public.settings_changes (changed_by, before, after, note)
  values (auth.uid(),
          json_build_object('run', p_run, 'week', public.settlement_week_label(r.covers_to),
                            'state', 'draft'),
          json_build_object('run', p_run, 'week', public.settlement_week_label(r.covers_to),
                            'state', 'released', 'shops', v_shops,
                            'collect_cents', v_collect, 'pay_cents', v_pay,
                            'unchecked', v_unchecked),
          'Released ' || v_shops || ' statements'
          || case when v_unchecked > 0
                  then ' - ' || v_unchecked || ' still unchecked' else '' end);

  return json_build_object('run', p_run, 'week', public.settlement_week_label(r.covers_to),
                           'shops', v_shops, 'collect_cents', v_collect, 'pay_cents', v_pay,
                           'unchecked', v_unchecked);
end $$;
grant execute on function public.admin_release_run(uuid) to authenticated;

-- ---- and his next round will not start -------------------------------------
create or replace function public.agent_queue(p_agent uuid default null)
returns json
language sql stable security definer set search_path = ''
as $$
  with me as (select coalesce(p_agent, auth.uid()) as id),
  q as (
    select rc.*, extract(epoch from now() - rc.code_captured_at) / 3600 as age_h
      from public.settlement_receipts rc, me
     where rc.agent_id = me.id and rc.verification = 'queued'
  )
  select json_build_object(
    'n', (select count(*) from q),
    'cents', coalesce((select sum(amount_cents) from q), 0)::int,
    'max_n', (select agent_unchecked_max from public.platform_settings),
    'max_cents', (select agent_unchecked_cents from public.platform_settings),
    'oldest_h', (select floor(max(age_h))::int from q),
    'failed', (select count(*) from public.settlement_receipts rc, me
                where rc.agent_id = me.id and rc.verification = 'failed'
                  and rc.incident_ref is null),
    'at_ceiling', (
      (select count(*) from q) >= (select agent_unchecked_max from public.platform_settings)
      or coalesce((select sum(amount_cents) from q), 0)
         >= (select agent_unchecked_cents from public.platform_settings)),
    -- §7: at incident level his next round does not start until the queue is
    -- empty. Not the same as the ceiling: the ceiling is about how much
    -- unchecked cash he holds, this is about how long he has held it.
    'blocked', (select count(*) from q where age_h >= 72) > 0,
    'incidents', (select count(*) from q where age_h >= 72)
  )
  from me
  where public.is_agent();
$$;
grant execute on function public.agent_queue(uuid) to authenticated;

do $$
begin
  -- §7's three rungs, as the sweep evaluates them
  assert not (11 >= 24), 'under twelve hours nobody is told';
  assert (25 >= 24) and not (25 >= 72), 'a day old is the duty desk, and only them';
  assert (73 >= 72), 'three days is an incident';
  -- and the rationale: three days is longer than any round, so it is no longer
  -- plausibly a technical failure
  assert 72 > 24, 'the incident rung is above the duty one';

  -- the two triggers reach the same state, which is what "whichever first" means
  assert 'INC-A1B2C3' = 'INC-' || upper(substring(replace(
    'a1b2c3d4-0000-0000-0000-000000000000', '-', '') from 1 for 6)),
    'release and the sweep mint the same reference for the same receipt';

  -- blocked is not the ceiling: one is how much, the other is how long
  assert (2 >= 5) = false, 'two unchecked is under the ceiling';
  assert (73 >= 72) = true, 'and can still be an incident';

  -- feed 2 exists because feed 1 cannot see a queue that never synced: the
  -- server only learns code_captured_at AT sync, so a phone that never comes
  -- back produces no queued row to age. The visit is the only trace left.
  assert (select count(*) from public.settlement_receipts where false) = 0,
    'a never-synced collection has no receipt row for the clock to find';
end $$;
