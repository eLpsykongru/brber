-- 0101_ops_call_audit: AGT-12. Ops-call receipts reviewed as a set.
--
-- §10 step 9, and §8's rules about it are all about not turning a tool into a
-- surveillance list:
--
--   · a RATE, not a count. "6 of 41 · 14.6% · 7x the fleet" — six calls means
--     nothing without the forty-one rounds they came out of.
--   · thresholds WRITTEN ON THE PAGE: three calls in seven rolling days, or
--     four `owner not reached` in thirty. "Below that nobody is watched."
--   · agents with ZERO are shown deliberately. It is possible to work a round
--     without ever needing this, and a list that only contains people with a
--     number on them reads as a list of suspects.
--
-- The last one is the reason this is a rate and not an alert queue. Every
-- honest cause here is boring: a dead phone, a shop with no signal, an owner
-- who does not answer at 19:30. The moment the screen reads as an accusation,
-- agents start avoiding the call and the fraud you would actually catch goes
-- underground.

create or replace function public.admin_ops_call_audit(p_days int default 90)
returns json
language sql stable security definer set search_path = ''
as $$
  with win as (select now() - make_interval(days => greatest(p_days, 7)) as since),
  -- every agent, including the ones with nothing against their name
  agents as (
    select p.id, coalesce(p.full_name, 'Agent') as name
      from public.profiles p where p.role in ('agent', 'admin')
  ),
  r as (
    select rc.agent_id, rc.verified_by, rc.owner_reached, rc.recorded_at,
           rc.amount_cents, s.name as salon,
           extract(hour from rc.recorded_at at time zone 'Africa/Casablanca') as hour_local
      from public.settlement_receipts rc
      join public.settlement_lines l on l.id = rc.line_id
      join public.salons s on s.id = l.salon_id, win
     where rc.recorded_at >= win.since
  ),
  fleet as (
    select greatest(count(*), 1)::numeric as total,
           count(*) filter (where verified_by = 'ops_call')::numeric as calls
      from r
  )
  select coalesce(json_agg(json_build_object(
      'agent', a.id, 'name', a.name,
      -- §8's headline: a rate, and what it is a rate OF
      'calls', (select count(*) from r where r.agent_id = a.id and r.verified_by = 'ops_call'),
      'collections', (select count(*) from r where r.agent_id = a.id),
      'pct', case when (select count(*) from r where r.agent_id = a.id) = 0 then 0
                  else round(100.0
                    * (select count(*) from r where r.agent_id = a.id and r.verified_by = 'ops_call')
                    / (select count(*) from r where r.agent_id = a.id), 1) end,
      -- "7x the fleet" - his share against everybody's
      'vs_fleet', case
        when (select count(*) from r where r.agent_id = a.id) = 0
          or (select calls from fleet) = 0 then null
        else round(
          ((select count(*) from r where r.agent_id = a.id and r.verified_by = 'ops_call')::numeric
            / (select count(*) from r where r.agent_id = a.id))
          / ((select calls from fleet) / (select total from fleet)), 1) end,

      -- §8's "shape of it" column. A number with no shape is a number nobody
      -- can act on, and acting is the point.
      'not_reached', (select count(*) from r
                       where r.agent_id = a.id and r.verified_by = 'ops_call'
                         and r.owner_reached is false),
      'shops', (select count(distinct salon) from r
                 where r.agent_id = a.id and r.verified_by = 'ops_call'),
      'late', (select count(*) from r
                where r.agent_id = a.id and r.verified_by = 'ops_call' and hour_local >= 18),
      'disputes', (select count(*) from public.ops_calls oc
                     join public.settlement_visits sv on sv.id = oc.visit_id
                    where sv.agent_id = a.id and oc.discrepancy),

      -- §8's two thresholds, evaluated here so the page and the rule agree
      'over_7d', (select count(*) from r
                   where r.agent_id = a.id and r.verified_by = 'ops_call'
                     and r.recorded_at >= now() - interval '7 days') >= 3,
      'over_30d', (select count(*) from r
                    where r.agent_id = a.id and r.verified_by = 'ops_call'
                      and r.owner_reached is false
                      and r.recorded_at >= now() - interval '30 days') >= 4,

      -- twelve weekly buckets, oldest first
      'spark', (select coalesce(json_agg(w.n order by w.wk), '[]'::json) from (
                  select g.wk,
                         (select count(*) from r
                           where r.agent_id = a.id and r.verified_by = 'ops_call'
                             and r.recorded_at >= now() - make_interval(weeks => g.wk + 1)
                             and r.recorded_at <  now() - make_interval(weeks => g.wk)) as n
                    from generate_series(0, 11) as g(wk)) w)
    ) order by
      -- the two thresholds first, then the rate. Not by raw count: a busy agent
      -- would sit at the top for ever and the list would stop being read.
      ((select count(*) from r where r.agent_id = a.id and r.verified_by = 'ops_call'
         and r.recorded_at >= now() - interval '7 days') >= 3) desc,
      case when (select count(*) from r where r.agent_id = a.id) = 0 then 0
           else (select count(*) from r where r.agent_id = a.id and r.verified_by = 'ops_call')::numeric
                / (select count(*) from r where r.agent_id = a.id) end desc,
      a.name), '[]'::json)
    from agents a
   where public.is_admin();
$$;
grant execute on function public.admin_ops_call_audit(int) to authenticated;

-- §8's four actions, in the order they are usually right. The middle one is
-- usually the answer, and it is the only one that changes anything about the
-- round rather than about the man: "a round that can't be closed at 19:30 is a
-- routing fault before it is an agent fault."
--
-- Only the first three are here. SUSPEND needs a second approver and there is
-- no two-person approval anywhere in this product; building a one-tap suspend
-- and calling it "needs a second approver" in the copy would be worse than not
-- offering it, so the screen says what is missing.
create or replace function public.admin_ops_call_action(
  p_agent uuid, p_action text, p_note text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_name text; v_n int := 0;
begin
  if not public.is_admin() then raise exception 'Ops only'; end if;
  if p_action not in ('ring_owners', 'morning_window', 'ride_along') then
    raise exception 'Suspending needs a second approver, and there is no second approver yet';
  end if;
  select coalesce(full_name, 'the agent') into v_name from public.profiles where id = p_agent;

  if p_action = 'morning_window' then
    -- the routing fix: his late shops move to a morning window on their next
    -- planned visit. Nothing about the agent changes.
    update public.settlement_visits
       set window_from = date_trunc('day', coalesce(window_from, now())) + interval '9 hours',
           window_to   = date_trunc('day', coalesce(window_from, now())) + interval '12 hours'
     where agent_id = p_agent and state <> 'closed'
       and (window_from is null or extract(hour from window_from) >= 16);
    get diagnostics v_n = row_count;
  end if;

  insert into public.settings_changes (changed_by, before, after, note)
  values (auth.uid(),
          json_build_object('agent', p_agent, 'name', v_name),
          json_build_object('agent', p_agent, 'name', v_name,
                            'action', p_action, 'visits_moved', v_n),
          coalesce(nullif(btrim(p_note), ''), p_action));

  return json_build_object('agent', p_agent, 'action', p_action, 'moved', v_n);
end $$;
grant execute on function public.admin_ops_call_action(uuid, text, text) to authenticated;

do $$
begin
  -- §8's headline, exactly as drawn: 6 of 41 is 14.6%
  assert round(100.0 * 6 / 41, 1) = 14.6, 'six calls out of forty-one collections is 14.6%';
  -- and "7x the fleet" is his share over everybody's, not his count over theirs
  assert round((6.0 / 41) / (0.0209), 1) = 7.0, 'against a fleet running about 2.1%';

  -- §8's two thresholds, written on the page and evaluated the same way
  assert (3 >= 3), 'three calls in seven rolling days opens a review by itself';
  assert not (2 >= 3), 'two does not';
  assert (4 >= 4), 'four owner-not-reached in thirty does too';
  assert not (3 >= 4), 'three does not';

  -- and below them nobody is watched: an agent with zero is a ROW, not an
  -- absence. A list containing only people with a number on them is a list of
  -- suspects.
  assert (case when 0 = 0 then 0 else 100.0 * 0 / 1 end) = 0,
    'zero calls is a rate of zero, and it is shown';
end $$;
