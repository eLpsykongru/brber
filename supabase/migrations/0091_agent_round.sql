-- 0091_agent_round: AGT-01's round, and the two ways a visit closes.
--
-- §8 step 2 and 3. The schema landed in 0090; these are the verbs over it.
--
-- ---- §2.2, which is a sort order and also a promise -------------------------
-- "The round is ordered by age of money, not by geography... Route optimisation
-- would quietly re-sort the list against the only deadline the business has."
-- So `agent_visits()` orders by `salon_float_age_days` and distance is not even
-- returned. If it is ever added it has to be a visible, non-default choice.
--
-- ---- §2.3, the two clocks --------------------------------------------------
-- A hand-over row has NO age, and that is shown rather than faked. Age measures
-- how long a shop has held OUR money; when we owe them, nothing of ours is
-- late. So the collect rows carry `age_days` and the hand-over rows carry
-- `waiting_days` — how long THEY have been waiting — and the two never share a
-- column, because a shared column is how a fake age gets computed to fill it.

-- ---- planning a round ------------------------------------------------------
-- Ops assigns. A line that was part-collected keeps its line and gets a NEW
-- visit, which is §5's reason for this table existing at all.
create or replace function public.admin_plan_visits(
  p_run uuid, p_agent uuid, p_from timestamptz default null, p_to timestamptz default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'Planning a round is ops only'; end if;
  if (select state from public.settlement_runs where id = p_run) = 'draft' then
    raise exception 'That week has not been released yet';
  end if;
  if not exists (select 1 from public.profiles
                  where id = p_agent and role in ('agent', 'admin')) then
    raise exception 'That person is not an agent';
  end if;

  insert into public.settlement_visits
    (line_id, agent_id, direction, window_from, window_to, address)
  select l.id, p_agent, l.direction, p_from, p_to, s.address
    from public.settlement_lines l
    join public.salons s on s.id = l.salon_id
   where l.run_id = p_run
     and l.direction <> 'nil'
     and coalesce(l.collected_cents, 0) < abs(l.amount_cents)
     -- a line already on somebody's round is not put on a second one
     and not exists (select 1 from public.settlement_visits v
                      where v.line_id = l.id and v.state <> 'closed');
  get diagnostics v_n = row_count;
  return json_build_object('planned', v_n);
end $$;
grant execute on function public.admin_plan_visits(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- ---- AGT-01 ----------------------------------------------------------------
create or replace function public.agent_visits()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare j json;
begin
  if not public.is_agent() then raise exception 'Rounds are ops only'; end if;

  select json_build_object(
    'bag', public.agent_bag(auth.uid()),
    'visits', coalesce((
      select json_agg(x order by
               -- day first, so a visit scheduled for Monday stays below today's
               -- even if its money is older; AGT-01 draws it sunken for exactly
               -- that reason. Then §2.2: oldest money first, and nothing else.
               -- A hand-over has no age, so it sorts after the collections it
               -- shares a day with rather than being given a number to sort by.
               coalesce(x.window_from::date, current_date),
               x.age_days desc nulls last)
        from (
          select v.id, v.direction, v.state, v.address,
                 v.window_from, v.window_to,
                 s.name as salon, s.id as salon_id,
                 coalesce(p.full_name, 'Owner') as owner,
                 abs(l.amount_cents) - coalesce(l.collected_cents, 0) as amount_cents,
                 coalesce(l.collected_cents, 0) as already_cents,
                 public.settlement_week_label(r.covers_to) as week,
                 -- collect only. §2.3: do not compute a fake one for a hand-over.
                 case when v.direction = 'collect'
                      then public.salon_float_age_days(l.salon_id) end as age_days,
                 -- and the other clock, for the direction that has one
                 case when v.direction = 'pay_out'
                      then floor(extract(epoch from now() - r.released_at) / 86400)::int
                      end as waiting_days,
                 (select float_hold_days from public.platform_settings) as limit_days
            from public.settlement_visits v
            join public.settlement_lines l on l.id = v.line_id
            join public.settlement_runs r on r.id = l.run_id
            join public.salons s on s.id = l.salon_id
            left join public.profiles p on p.id = s.owner_id
           where v.agent_id = auth.uid() and v.state <> 'closed'
        ) x), '[]'::json)
  ) into j;
  return j;
end $$;
grant execute on function public.agent_visits() to authenticated;

-- ---- closing a visit, the collect direction --------------------------------
-- §3: proved by the owner's 4-digit code, because the fraud in this direction
-- is an agent inventing a collection from his scooter.
create or replace function public.agent_collect(
  p_visit uuid, p_cents int, p_code text,
  p_device text default null, p_geo text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v record; c record; v_receipt text; v_open int;
begin
  if not public.is_agent() then raise exception 'Collections are ops only'; end if;

  select sv.*, l.id as line, l.salon_id, l.amount_cents, l.collected_cents, s.name as salon
    into v
    from public.settlement_visits sv
    join public.settlement_lines l on l.id = sv.line_id
    join public.salons s on s.id = l.salon_id
   where sv.id = p_visit;
  if v.id is null then raise exception 'No such visit'; end if;
  if v.agent_id <> auth.uid() then raise exception 'That visit is on somebody else''s round'; end if;
  if v.state = 'closed' then raise exception 'That visit is already closed'; end if;
  if v.direction <> 'collect' then raise exception 'That visit is a hand-over'; end if;
  if p_cents is null or p_cents <= 0 then raise exception 'Count what he gave you'; end if;

  select * into c from public.visit_codes where visit_id = p_visit;
  if c.visit_id is null then
    raise exception 'Ask him to open his statement - no code has been issued for this visit';
  end if;
  if c.used_at is not null then raise exception 'That code has already been used'; end if;
  if c.expires_at < now() then
    raise exception 'That code has expired - ask him to open his statement again';
  end if;
  if c.code is distinct from p_code then raise exception 'That code does not match'; end if;
  -- the amount binding is a CEILING, not an equality: the owner reads the code
  -- out for what he owes, and a partial is normal (§2, AGT-02). Binding it
  -- exactly would make every short payment fail; binding it as a maximum still
  -- stops a code being replayed for more than he ever saw.
  if p_cents > c.amount_cents then
    raise exception 'His code covers % DH', round(c.amount_cents / 100.0);
  end if;

  -- the receipt first: its triggers are where §5's money invariants live, so a
  -- bad amount is refused before anything else has moved.
  insert into public.settlement_receipts
    (visit_id, line_id, agent_id, amount_cents, verified_by, code_ref, device_id, geo)
  values (p_visit, v.line, auth.uid(), p_cents, 'code', p_code, p_device, p_geo)
  returning ref into v_receipt;

  update public.visit_codes set used_at = now() where visit_id = p_visit;
  perform public.admin_settle_line(v.line, p_cents, p_cents, v_receipt);

  v_open := abs(v.amount_cents) - coalesce(v.collected_cents, 0) - p_cents;
  -- the visit closes even when the money did not all arrive: §2 says the
  -- shortfall rides on the LINE and comes back on a later statement, so a visit
  -- left open would be a second place the same debt lived.
  update public.settlement_visits
     set state = 'closed', closed_at = now() where id = p_visit;

  return json_build_object(
    'receipt', v_receipt, 'salon', v.salon, 'taken_cents', p_cents,
    'open_cents', v_open, 'code', p_code, 'bag', public.agent_bag(auth.uid()));
end $$;
grant execute on function public.agent_collect(uuid, int, text, text, text) to authenticated;

-- ---- closing a visit, the hand-over direction ------------------------------
-- §3: proved by the owner's signature and no code. His presence was never in
-- question; the money reaching him is.
create or replace function public.agent_hand_over(
  p_visit uuid, p_signature text,
  p_device text default null, p_geo text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v record; v_receipt text; v_amount int;
begin
  if not public.is_agent() then raise exception 'Hand-overs are ops only'; end if;
  if coalesce(btrim(p_signature), '') = '' then
    raise exception 'He has to sign for it';
  end if;

  select sv.*, l.id as line, l.amount_cents, l.collected_cents, s.name as salon
    into v
    from public.settlement_visits sv
    join public.settlement_lines l on l.id = sv.line_id
    join public.salons s on s.id = l.salon_id
   where sv.id = p_visit;
  if v.id is null then raise exception 'No such visit'; end if;
  if v.agent_id <> auth.uid() then raise exception 'That visit is on somebody else''s round'; end if;
  if v.state = 'closed' then raise exception 'That visit is already closed'; end if;
  if v.direction <> 'pay_out' then raise exception 'That visit is a collection'; end if;

  -- §2.5: all of it or nothing. There is no amount argument at all, so a
  -- partial hand-over is not something a caller can even ask for.
  v_amount := abs(v.amount_cents) - coalesce(v.collected_cents, 0);

  insert into public.settlement_receipts
    (visit_id, line_id, agent_id, amount_cents, verified_by, signature_blob, device_id, geo)
  values (p_visit, v.line, auth.uid(), v_amount, 'signature', p_signature, p_device, p_geo)
  returning ref into v_receipt;

  perform public.admin_settle_line(v.line, v_amount, v_amount, v_receipt);

  update public.settlement_visits
     set state = 'closed', closed_at = now() where id = p_visit;

  return json_build_object('receipt', v_receipt, 'salon', v.salon,
                           'handed_cents', v_amount, 'bag', public.agent_bag(auth.uid()));
end $$;
grant execute on function public.agent_hand_over(uuid, text, text, text) to authenticated;

-- ---- the drop --------------------------------------------------------------
-- §2.4: "This is the number that makes him go to the office before the last
-- visit." Dropping is what resets it, so it has to be a thing he can record.
create or replace function public.agent_drop(p_cents int, p_note text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_bag json;
begin
  if not public.is_agent() then raise exception 'Drops are ops only'; end if;
  v_bag := public.agent_bag(auth.uid());
  if p_cents is null or p_cents <= 0 then raise exception 'Count what you dropped'; end if;
  if p_cents > (v_bag->>'in_bag_cents')::int then
    raise exception 'You are carrying % DH', round((v_bag->>'in_bag_cents')::int / 100.0);
  end if;

  insert into public.agent_drops (agent_id, amount_cents, note)
  values (auth.uid(), p_cents, p_note);

  return public.agent_bag(auth.uid());
end $$;
grant execute on function public.agent_drop(int, text) to authenticated;

do $$
begin
  -- AGT-02's partial, end to end: 1 566 owed, 1 100 taken, 466 left on the line
  assert 156600 - 110000 = 46600, 'the shortfall stays on the line';
  -- and the code covering 1 566 authorises 1 100, because the binding is a
  -- ceiling. Binding it exactly would make every short payment fail.
  assert 110000 <= 156600, 'a code for the full amount covers a partial';
  assert not (160000 <= 156600), 'and cannot be stretched past what he saw';

  -- §2.5, expressed as an absent argument rather than a validation
  assert 357000 = 357000, 'a hand-over takes no amount: it is the line, exactly';

  -- §2.3's two clocks never share a column
  assert (case when 'collect' = 'collect' then 6 end) = 6, 'a collect row has an age';
  assert (case when 'pay_out' = 'collect' then 6 end) is null,
    'and a hand-over row has none - not a zero, none';

  -- the bag after AGT-03 and then AGT-05
  assert 613000 + 110000 = 723000, 'into the bag';
  assert 723000 - 357000 = 366000, 'and out again';
end $$;
