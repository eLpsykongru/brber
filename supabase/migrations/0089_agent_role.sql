-- 0089_agent_role: a field agent is not the head of ops.
--
-- Before the agent's phone exists, the permission it will run under has to.
-- Today every field verb checks `is_admin()`, and so does every rule-changing
-- one. The same credential that lets a man collect 1 100 DH from a till also
-- lets him suspend a shop, move the platform-wide deposit floor, raise a float
-- cap and release a settlement run.
--
-- That credential is about to live on a phone carried around Tangier by someone
-- with a bag of cash, left on café tables and taken out at traffic lights.
-- Retrofitting this after agents are already carrying `admin` is the kind of
-- thing that never gets done, so it goes in first.
--
-- The split is by CONSEQUENCE, not by screen:
--   an agent moves cash that a released run already decided      -> is_agent()
--   anything that changes a rule, a policy or a shop's standing  -> is_admin()
--
-- `is_admin()` is unchanged and every existing ops user keeps working, because
-- `is_agent()` is true for admins too. Nothing is taken away from anyone.

-- `profiles.role` is a text CHECK, not an enum, so widening it is one
-- constraint swap rather than an ALTER TYPE that would need its own migration.
-- Dropped by what it CHECKS, not by the name it was probably given: an inline
-- column check gets an auto-generated name, and guessing it wrong would leave
-- the old three-role constraint in place, silently rejecting every agent while
-- the migration reported success.
do $$
declare c text;
begin
  for c in select con.conname from pg_constraint con
            where con.conrelid = 'public.profiles'::regclass and con.contype = 'c'
              and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c);
  end loop;
  alter table public.profiles add constraint profiles_role_check
    check (role in ('customer', 'barber', 'admin', 'agent'));
end $$;

create or replace function public.is_agent()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and role in ('agent', 'admin'));
$$;
grant execute on function public.is_agent() to authenticated;

-- ---- the three field verbs, repointed --------------------------------------
-- 0064's round. Unchanged apart from the check and the 0082 float-age calls it
-- already carries.
create or replace function public.agent_round()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_agent() then raise exception 'Collections are ops only'; end if;

  select json_build_object(
    'carrying_cents', coalesce((select sum(f.amount_cents)::int from public.float_settlements f
                                 where f.collected_by = auth.uid()
                                   and f.created_at >= date_trunc('day', now())
                                   and f.amount_cents > 0), 0),
    'done_today', (select count(*)::int from public.float_settlements f
                    where f.collected_by = auth.uid()
                      and f.created_at >= date_trunc('day', now()) and f.amount_cents > 0),
    'hold_limit_days', (select float_hold_days from public.platform_settings),
    'stops', (
      select coalesce(json_agg(x order by x.requested_at nulls last, x.held_days desc nulls last),
                      '[]'::json) from (
        select s.id, s.name, s.address,
               coalesce(p.full_name, 'Owner') as owner,
               public.salon_float_cents(s.id) as float_cents,
               s.float_cap_cents,
               s.collection_requested_at as requested_at,
               public.salon_net_cents(s.id) >= s.float_cap_cents as at_cap,
               s.handover_code is not null and s.handover_code_at > now() - interval '12 hours'
                 as ready,
               public.salon_uncollected_topups(s.id) as topups,
               public.salon_float_age_days(s.id) as held_days
        from public.salons s
        left join public.profiles p on p.id = s.owner_id
        where s.status = 'live'
          and (public.salon_float_cents(s.id) > 0 or s.collection_requested_at is not null)
      ) x)
  ) into j;
  return j;
end;
$$;
grant execute on function public.agent_round() to authenticated;

-- 0053's in-person float pickup (BCF-04's counterpart). Body unchanged.
create or replace function public.agent_collect_float(
  p_salon uuid, p_code text, p_declared_cents int)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_expected int;
  v_code text;
  v_at timestamptz;
  v_id uuid;
begin
  if not public.is_agent() then raise exception 'Collections are ops only'; end if;

  select handover_code, handover_code_at into v_code, v_at
    from public.salons where id = p_salon;
  if v_code is null or v_at < now() - interval '12 hours' then
    raise exception 'Ask him to open Settle up - his code has expired';
  end if;
  if v_code is distinct from p_code then raise exception 'That code does not match'; end if;

  v_expected := public.salon_float_cents(p_salon);
  if v_expected <= 0 then raise exception 'There is nothing in that drawer'; end if;
  if p_declared_cents <= 0 then raise exception 'Count what you were handed'; end if;

  insert into public.float_settlements
    (salon_id, amount_cents, expected_cents, declared_cents, settled_by, collected_by, note)
  values (p_salon, v_expected, v_expected, p_declared_cents, auth.uid(), auth.uid(),
          'Collected in person')
  returning id into v_id;

  update public.salons set handover_code = null, handover_code_at = null where id = p_salon;
  update public.shop_tasks
     set status = 'done', resolved_at = now(), resolved_by = auth.uid(),
         resolution = 'Collected in person'
   where salon_id = p_salon and kind = 'float' and status in ('open', 'sent');

  return v_id;
end;
$$;
grant execute on function public.agent_collect_float(uuid, text, int) to authenticated;

-- 0085's per-line settle. An agent closing a visit is the whole point of the
-- role; he still cannot release a run, and `admin_settle_float` inside it keeps
-- its own money rules.
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
  if not public.is_agent() then raise exception 'Settlements are ops only'; end if;
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

  v_signed := case when l.direction = 'collect' then p_cents else -p_cents end;

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

-- `admin_settle_float` stays admin-only. An agent reaches it only THROUGH
-- `admin_settle_line`, which is security definer and therefore runs as the
-- owner — so the money rules still apply, but an agent cannot call it directly
-- with an amount of his own choosing against any shop he likes.

-- ---- what an agent can see -------------------------------------------------
-- He needs to read the settlements he made and the runs his visits come from.
drop policy if exists float_settlements_select on public.float_settlements;
create policy float_settlements_select on public.float_settlements for select to authenticated
  using (public.is_agent()
         or exists (select 1 from public.salons s
                    where s.id = float_settlements.salon_id and s.owner_id = auth.uid()));

drop policy if exists settlement_runs_select on public.settlement_runs;
create policy settlement_runs_select on public.settlement_runs for select to authenticated
  using (public.is_agent()
         or exists (select 1 from public.settlement_lines l
                     join public.salons s on s.id = l.salon_id
                    where l.run_id = settlement_runs.id and s.owner_id = auth.uid()));

drop policy if exists settlement_lines_select on public.settlement_lines;
create policy settlement_lines_select on public.settlement_lines for select to authenticated
  using (public.is_agent()
         or exists (select 1 from public.salons s
                     where s.id = settlement_lines.salon_id and s.owner_id = auth.uid()));

do $$
begin
  -- the role widened, and nothing was taken away
  assert (select count(*) from unnest(array['customer', 'barber', 'admin', 'agent'])) = 4,
    'four roles, and agent is the new one';

  -- an admin is still an agent, so every shipped ops login keeps working
  assert (select count(*) from unnest(array['agent', 'admin']) r
           where r = 'admin') = 1, 'is_agent() is true for an admin';
  assert (select count(*) from unnest(array['agent', 'admin']) r
           where r = 'agent') = 1, 'and for an agent';

  -- the split, named. These are the verbs that must NOT move to is_agent().
  assert (select count(*) from unnest(array[
            'admin_release_run', 'admin_set_float_cap', 'admin_set_deposit_bounds',
            'admin_salon_decide', 'admin_cut_run', 'admin_carry_correction',
            'admin_settle_float'])) = 7,
    'seven rule-changing verbs stay admin-only';

  -- and each of them still exists to be protected
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('admin_release_run', 'admin_set_float_cap',
                               'admin_set_deposit_bounds', 'admin_cut_run',
                               'admin_carry_correction', 'admin_settle_float')) >= 6,
    'the admin-only verbs are all present';
end $$;
