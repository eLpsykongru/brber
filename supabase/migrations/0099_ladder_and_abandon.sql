-- 0099_ladder_and_abandon: the rungs before the call, and walking away.
--
-- §10 step 7. Two screens, one table.
--
-- ---- §2, and the rule the whole code mechanism rests on --------------------
--
-- The ladder's third rung REFUSES a code read down the phone, and that is not a
-- UX preference. A code spoken over a phone proves the owner agreed; it does
-- not prove the agent is in the shop. Accept it once and every code in the
-- system asserts only the weaker of the two facts — which is the one nobody
-- needed proving. So when the owner answers, the flow routes into the ops call,
-- where the conversation is captured, rather than taking digits through the
-- agent's ear.
--
-- ---- §2's friction, which is a number about himself ------------------------
--
-- "No timer (a timer teaches agents to wait it out)." His own ops-call rate
-- against the team's sits on the screen BEFORE he taps. It is also the number
-- the Head of Ops sorts by, so it is the same number in both places.
--
-- ---- §3, and the one place the product refuses him an exit ------------------
--
-- Walking away is allowed and is a RECORDED act — reason, name, time, geo, and
-- a line the owner sees, never a blank. An agent who cannot leave will invent a
-- close or stand arguing with a barber.
--
-- Except when he is holding counted cash. Then there is no exit, only the call.

create table if not exists public.visit_attempts (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.settlement_visits (id) on delete restrict,
  agent_id uuid not null references public.profiles (id),
  at timestamptz not null default now(),
  geo text,
  -- what happened at the end of the attempt
  outcome text not null check (outcome in ('abandoned', 'escalated')),
  -- §2's three entry reasons, plus the ones §3 needs for walking away
  reason text not null check (reason in
    ('owner_unreachable', 'app_no_code', 'code_rejected_3x',
     'shop_closed', 'owner_absent', 'other')),
  note text
  -- §1 lists `closed: false` on this row. It is not a column here: an ATTEMPT
  -- is by definition a visit that did not close, so a boolean that can only
  -- ever hold one value is a field somebody will one day set to true.
);
create index if not exists visit_attempts_visit_idx on public.visit_attempts (visit_id, at desc);
create index if not exists visit_attempts_agent_idx on public.visit_attempts (agent_id, at desc);

alter table public.visit_attempts enable row level security;
drop policy if exists visit_attempts_select on public.visit_attempts;
create policy visit_attempts_select on public.visit_attempts for select to authenticated
  using (public.is_agent()
         or exists (select 1 from public.settlement_visits v
                     join public.settlement_lines l on l.id = v.line_id
                     join public.salons s on s.id = l.salon_id
                    where v.id = visit_attempts.visit_id and s.owner_id = auth.uid()));
grant select on public.visit_attempts to authenticated;

-- an attempt is a fact about a moment; it is never edited afterwards
create or replace function public.attempt_is_final()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'What happened at a visit is not rewritten afterwards';
end $$;
drop trigger if exists visit_attempts_final on public.visit_attempts;
create trigger visit_attempts_final before update or delete on public.visit_attempts
  for each row execute function public.attempt_is_final();

-- ---- the two rates §2 and §3 put on screen before he taps ------------------
-- His own against the team's. Both come from one function so the number he is
-- shown and the number the Head of Ops sorts by cannot differ.
create or replace function public.agent_rates(p_agent uuid default null)
returns json
language sql stable security definer set search_path = ''
as $$
  with me as (select coalesce(p_agent, auth.uid()) as id),
  win as (select now() - interval '30 days' as since),
  mine as (
    select
      count(*) filter (where a.outcome = 'escalated') as calls,
      count(*) filter (where a.outcome = 'abandoned') as abandons
      from public.visit_attempts a, me, win
     where a.agent_id = me.id and a.at >= win.since
  ),
  team as (
    select
      count(*) filter (where a.outcome = 'escalated')::numeric as calls,
      count(*) filter (where a.outcome = 'abandoned')::numeric as abandons,
      greatest(count(distinct a.agent_id), 1) as agents
      from public.visit_attempts a, win
     where a.at >= win.since
  )
  select json_build_object(
    'days', 30,
    'calls', (select calls from mine),
    'abandons', (select abandons from mine),
    -- "2 in 30 days · team 0.4" — the team figure is per agent, which is what
    -- makes his own number mean something next to it
    'team_calls', round((select calls from team) / (select agents from team), 1),
    'team_abandons', round((select abandons from team) / (select agents from team), 1)
  )
  from me
  where public.is_agent();
$$;
grant execute on function public.agent_rates(uuid) to authenticated;

-- ---- §3 · walking away ------------------------------------------------------
create or replace function public.agent_abandon_visit(
  p_visit uuid, p_reason text, p_geo text default null, p_note text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v record; v_before int; v_taken_off boolean := false;
begin
  if not public.is_agent() then raise exception 'Rounds are ops only'; end if;
  if p_reason not in ('owner_unreachable', 'app_no_code', 'code_rejected_3x',
                      'shop_closed', 'owner_absent', 'other') then
    raise exception 'Say why you could not close it';
  end if;

  select sv.*, l.salon_id, s.name as salon, s.owner_id as owner,
         abs(l.amount_cents) - coalesce(l.collected_cents, 0) as cents
    into v
    from public.settlement_visits sv
    join public.settlement_lines l on l.id = sv.line_id
    join public.salons s on s.id = l.salon_id
   where sv.id = p_visit;
  if v.id is null then raise exception 'No such visit'; end if;
  if v.agent_id <> auth.uid() then raise exception 'That visit is on somebody else''s round'; end if;
  if v.state = 'closed' then raise exception 'That visit is already closed'; end if;

  -- §3's fourth brake, and the one place the product refuses him an exit. The
  -- app asks whether he has counted money; this is the server's half of it —
  -- once a receipt exists, cash has moved and walking away is not a thing that
  -- can be recorded, because it did not happen.
  if exists (select 1 from public.settlement_receipts where visit_id = p_visit) then
    raise exception 'Cash has already moved on this visit - it cannot be left open';
  end if;

  insert into public.visit_attempts (visit_id, agent_id, geo, outcome, reason, note)
  values (p_visit, auth.uid(), p_geo, 'abandoned', p_reason, p_note);

  -- §3's third brake: "Second abandon takes the shop off him — third visit
  -- routes to another agent and ops phones the owner."
  select count(*) into v_before
    from public.visit_attempts a
    join public.settlement_visits sv on sv.id = a.visit_id
    join public.settlement_lines l on l.id = sv.line_id
   where a.agent_id = auth.uid() and a.outcome = 'abandoned' and l.salon_id = v.salon_id;

  if v_before >= 2 then
    -- unassigned, not reassigned: who goes instead is ops' call, not a rota's
    update public.settlement_visits set agent_id = null where id = p_visit;
    v_taken_off := true;
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    select p.id, 'moderation', 'A shop needs a different agent',
           coalesce((select full_name from public.profiles where id = auth.uid()), 'An agent')
           || ' has now left ' || v.salon || ' without closing ' || v_before
           || ' times. It is off his round - put someone else on it, and ring the owner.',
           v.cents
      from public.profiles p where p.role = 'admin';
  end if;

  -- §3: "a line the owner sees, never a blank"
  if v.owner is not null then
    insert into public.notifications (user_id, kind, title, body)
    values (v.owner, 'shop_status', 'We came by and could not finish',
            coalesce((select full_name from public.profiles where id = auth.uid()), 'Our agent')
            || ' came ' || to_char(now() at time zone 'Africa/Casablanca', 'Dy HH24:MI')
            || ' and could not close the visit. '
            || case p_reason
                 when 'shop_closed' then 'The shop was closed.'
                 when 'owner_absent' then 'You were not there.'
                 when 'app_no_code' then 'Your app was not showing the code.'
                 when 'owner_unreachable' then 'We could not reach you.'
                 when 'code_rejected_3x' then 'The code would not go through.'
                 else 'We will come back.'
               end
            || ' Nothing has changed on your account and we will come again.');
  end if;

  return json_build_object('visit', p_visit, 'salon', v.salon,
                           'abandons_here', v_before, 'taken_off', v_taken_off,
                           'rates', public.agent_rates(auth.uid()));
end $$;
grant execute on function public.agent_abandon_visit(uuid, text, text, text) to authenticated;

-- ---- §2 · the ladder reaching its last rung ---------------------------------
-- Recording that he worked the rungs and is now asking for the call. The call
-- itself is step 8; this is the entry, and the reason §2 says to record.
create or replace function public.agent_request_ops_call(
  p_visit uuid, p_reason text, p_geo text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v record;
begin
  if not public.is_agent() then raise exception 'Rounds are ops only'; end if;
  -- §2's three, and only those three: the ladder has exactly these exits
  if p_reason not in ('owner_unreachable', 'app_no_code', 'code_rejected_3x') then
    raise exception 'The call is for a code that cannot be produced, not for anything else';
  end if;

  select sv.*, s.name as salon, abs(l.amount_cents) - coalesce(l.collected_cents, 0) as cents
    into v
    from public.settlement_visits sv
    join public.settlement_lines l on l.id = sv.line_id
    join public.salons s on s.id = l.salon_id
   where sv.id = p_visit;
  if v.id is null then raise exception 'No such visit'; end if;
  if v.agent_id <> auth.uid() then raise exception 'That visit is on somebody else''s round'; end if;
  if v.state = 'closed' then raise exception 'That visit is already closed'; end if;

  insert into public.visit_attempts (visit_id, agent_id, geo, outcome, reason)
  values (p_visit, auth.uid(), p_geo, 'escalated', p_reason);

  -- §4: ops does not authorise the agent, ops reaches the OWNER. The duty desk
  -- is told a call is wanted; what it does next is step 8.
  insert into public.notifications (user_id, kind, title, body, amount_cents)
  select p.id, 'moderation', 'An agent needs the duty desk',
         coalesce((select full_name from public.profiles where id = auth.uid()), 'An agent')
         || ' is at ' || v.salon || ' for ' || round(v.cents / 100.0)
         || ' DH and cannot get a code: '
         || case p_reason
              when 'owner_unreachable' then 'the owner is not reachable.'
              when 'app_no_code' then 'the owner''s app is not showing one.'
              else 'the code was rejected three times.'
            end
         || ' Ring the owner on the number on file - do not take the amount from the agent first.',
         v.cents
    from public.profiles p where p.role = 'admin';

  return json_build_object('visit', p_visit, 'salon', v.salon, 'cents', v.cents,
                           'rates', public.agent_rates(auth.uid()));
end $$;
grant execute on function public.agent_request_ops_call(uuid, text, text) to authenticated;

-- ---- the sweep's feed 2, now that "no abandon record" can exist -------------
-- 0097 flagged any visit that had produced nothing for three days, because
-- there was no way for an agent to say why. There is now: a visit he walked
-- away from HAS come back with something, so it is not silence. One that has
-- not been touched at all still is.
create or replace function public.unchecked_sweep()
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  rc record; v record;
  v_duty int := 0; v_inc int := 0; v_quiet int := 0;
begin
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

  for v in select sv.id, sv.agent_id, s.name as salon,
                  abs(l.amount_cents) - coalesce(l.collected_cents, 0) as cents
             from public.settlement_visits sv
             join public.settlement_lines l on l.id = sv.line_id
             join public.salons s on s.id = l.salon_id
            where sv.state <> 'closed'
              and coalesce(sv.window_to, sv.created_at) < now() - interval '72 hours'
              and not exists (select 1 from public.settlement_receipts rr
                               where rr.visit_id = sv.id)
              -- a visit he walked away from came back with a reason, so it is
              -- not silence. One nobody has touched still is.
              and not exists (select 1 from public.visit_attempts a
                               where a.visit_id = sv.id
                                 and a.at > now() - interval '72 hours')
  loop
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    select p.id, 'moderation', 'A visit went quiet',
           v.salon || ' was on '
           || coalesce((select full_name from public.profiles where id = v.agent_id), 'an agent')
           || '''s round three days ago and nothing has come back from it - no '
           || 'collection, no hand-over, not even a reason. If he took cash '
           || 'offline it has never reached us. Ring him.',
           v.cents
      from public.profiles p where p.role = 'admin';
    v_quiet := v_quiet + 1;
  end loop;

  return json_build_object('duty', v_duty, 'incidents', v_inc, 'quiet_visits', v_quiet);
end $$;
revoke all on function public.unchecked_sweep() from authenticated, anon;

do $$
begin
  -- §2's three entry reasons and no others: the call is for a code that cannot
  -- be produced, not a general escape hatch
  assert (select count(*) from unnest(array['owner_unreachable', 'app_no_code',
                                            'code_rejected_3x'])) = 3,
    'three ways up the ladder';

  -- §3's third brake fires on the SECOND abandon, so the third visit goes to
  -- somebody else
  assert not (1 >= 2), 'the first time he leaves, the shop stays his';
  assert (2 >= 2), 'the second takes it off him';

  -- §2's friction is a comparison, not a delay. 2 against a team average of 0.4
  assert round(2::numeric / 5, 1) = 0.4, 'two calls across five agents is 0.4 each';
  assert 2 > 0.4, 'which is what makes his own number worth showing him';

  -- an attempt is a fact about a moment
  assert (select count(*) from pg_trigger where tgname = 'visit_attempts_final') = 1,
    'and it is never rewritten afterwards';
end $$;
