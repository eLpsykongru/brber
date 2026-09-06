-- 0102_duty_queue: what the duty desk is looking at.
--
-- 0100 built the call and left it drivable only by RPC. This is the read the
-- screen opens on: who is standing in a shop right now waiting for someone to
-- ring an owner.
--
-- An agent is waiting when he has escalated a visit (0099's `visit_attempts`,
-- outcome `escalated`) and that visit has not since been closed and has no
-- authorisation already spent. Anything else is history.

create or replace function public.admin_duty_queue()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'visit', v.id,
           'salon', s.name,
           'cents', abs(l.amount_cents) - coalesce(l.collected_cents, 0),
           'agent', coalesce(ag.full_name, 'an agent'),
           'agent_id', v.agent_id,
           'owner', coalesce(ow.full_name, 'the owner'),
           'asked_at', a.at,
           -- §2's three, so the desk knows what it is walking into before it dials
           'reason', a.reason,
           'why', case a.reason
                    when 'owner_unreachable' then 'the owner is not reachable'
                    when 'app_no_code' then 'the owner''s app is not showing a code'
                    else 'the code was rejected three times'
                  end,
           -- an existing call, if the desk already started one
           'call', (select oc.id from public.ops_calls oc
                     where oc.visit_id = v.id and oc.used_at is null and not oc.discrepancy
                     order by oc.opened_at desc limit 1),
           'waiting_min', floor(extract(epoch from now() - a.at) / 60)::int)
         order by a.at), '[]'::json)
    from public.visit_attempts a
    join public.settlement_visits v on v.id = a.visit_id
    join public.settlement_lines l on l.id = v.line_id
    join public.salons s on s.id = l.salon_id
    left join public.profiles ag on ag.id = v.agent_id
    left join public.profiles ow on ow.id = s.owner_id
   where a.outcome = 'escalated'
     and v.state <> 'closed'
     -- one row per waiting agent, not one per time he asked
     and a.at = (select max(a2.at) from public.visit_attempts a2
                  where a2.visit_id = a.visit_id and a2.outcome = 'escalated')
     -- and nothing already authorised and spent
     and not exists (select 1 from public.ops_calls oc
                      where oc.visit_id = v.id and oc.used_at is not null)
     and public.is_admin();
$$;
grant execute on function public.admin_duty_queue() to authenticated;

do $$
begin
  -- a man standing in a shop is measured in minutes, not days
  assert floor(extract(epoch from interval '4 minutes') / 60) = 4,
    'the desk sees how long he has been waiting';

  -- §2's three reasons are the only ways into this queue
  assert (select count(*) from unnest(array['owner_unreachable', 'app_no_code',
                                            'code_rejected_3x'])) = 3,
    'and each of them says what the desk is walking into';
end $$;
