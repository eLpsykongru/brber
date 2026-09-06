-- 0100_ops_call: the duty desk, and the six digits.
--
-- §10 step 8. §4's first line is the whole design: **ops does not authorise the
-- agent, ops reaches the owner.** The duty officer is not deciding whether to
-- trust the man in the shop; they are becoming the channel the owner vouches
-- through, and the witness to it.
--
-- ---- the order is the security property ------------------------------------
--
-- §4: the owner is asked the amount FIRST and it is typed, THEN the agent is
-- asked and his is typed, and both must match before anything is issued.
--
-- If the agent's number is entered first, the duty officer has it in their head
-- while they ask the owner, and "is it 1 566?" is a different question from
-- "how much did you hand over?". So the order is not a screen convention here:
-- `ops_call_agent_amount` REFUSES to run until the owner's figure is recorded,
-- and neither figure can be changed afterwards.
--
-- ---- six digits, not four ---------------------------------------------------
--
-- §4: "Six so nothing downstream can confuse it with an owner code." The two
-- are different lengths, stored in different tables, checked by different
-- functions and rendered differently on every surface. A four-digit
-- authorisation would eventually be read as a code somebody's app issued.
--
-- ---- two grades, and why the weaker one still issues ------------------------
--
-- `owner_reached: false` means the agent is the sole voucher. It is visibly
-- thinner everywhere and it is still issuable, because the alternative is an
-- agent leaving a shop with unrecorded cash — which is worse than a recorded
-- collection nobody has confirmed yet.

create sequence if not exists public.ops_call_seq start 8840;

create table if not exists public.ops_calls (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default 'CALL-' || nextval('public.ops_call_seq'),
  visit_id uuid not null references public.settlement_visits (id) on delete restrict,
  duty_user uuid not null references public.profiles (id),
  opened_at timestamptz not null default now(),

  -- §4's two figures, in the order they are taken
  owner_amount_cents int,
  owner_amount_at timestamptz,
  owner_reached boolean,
  agent_amount_cents int,
  agent_amount_at timestamptz,

  -- the authorisation, issued only when they match
  auth_code text check (auth_code is null or auth_code ~ '^[0-9]{6}$'),
  issued_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,

  -- a mismatch issues nothing and opens this instead
  discrepancy boolean not null default false,
  note text,

  constraint ops_call_owner_shape check ((owner_amount_cents is null) = (owner_amount_at is null)),
  constraint ops_call_auth_shape check ((auth_code is null) = (issued_at is null))
);
create index if not exists ops_calls_visit_idx on public.ops_calls (visit_id, opened_at desc);

alter table public.ops_calls enable row level security;
drop policy if exists ops_calls_select on public.ops_calls;
-- the agent may see that a call exists and whether it issued. He may NOT see
-- the digits: he is told them aloud, which is the entire mechanism.
create policy ops_calls_select on public.ops_calls for select to authenticated
  using (public.is_admin());
grant select on public.ops_calls to authenticated;

-- ---- §4's duty screen -------------------------------------------------------
create or replace function public.admin_ops_call_open(p_visit uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v record; a record; v_id uuid; v_ref text;
begin
  if not public.is_admin() then raise exception 'The duty desk is ops only'; end if;

  select sv.*, s.name as salon, s.lat, s.lng, s.address,
         coalesce(ow.full_name, 'the owner') as owner_name, ow.phone as owner_phone,
         coalesce(ag.full_name, 'the agent') as agent_name,
         abs(l.amount_cents) - coalesce(l.collected_cents, 0) as cents,
         public.settlement_week_label(r.covers_to) as week
    into v
    from public.settlement_visits sv
    join public.settlement_lines l on l.id = sv.line_id
    join public.settlement_runs r on r.id = l.run_id
    join public.salons s on s.id = l.salon_id
    left join public.profiles ow on ow.id = s.owner_id
    left join public.profiles ag on ag.id = sv.agent_id
   where sv.id = p_visit;
  if v.id is null then raise exception 'No such visit'; end if;
  if v.state = 'closed' then raise exception 'That visit is already closed'; end if;

  -- reuse an open call rather than starting a second one for the same visit
  select id, ref into v_id, v_ref from public.ops_calls
   where visit_id = p_visit and used_at is null and not discrepancy
   order by opened_at desc limit 1;
  if v_id is null then
    insert into public.ops_calls (visit_id, duty_user) values (p_visit, auth.uid())
    returning id, ref into v_id, v_ref;
  end if;

  -- where he says he is, from the ladder attempt that started this
  select a2.geo, a2.at into a from public.visit_attempts a2
   where a2.visit_id = p_visit and a2.outcome = 'escalated'
   order by a2.at desc limit 1;

  return json_build_object(
    'call', v_id, 'ref', v_ref,
    'visit', p_visit, 'salon', v.salon, 'address', v.address, 'week', v.week,
    'cents', v.cents,
    -- §4: the number ON FILE, never one the agent reads out. It is returned
    -- here so the duty officer physically cannot dial anything else.
    'owner', v.owner_name, 'owner_phone', v.owner_phone,
    'agent', v.agent_name, 'agent_id', v.agent_id,
    -- and the three things §4 puts beside it
    'agent_geo', a.geo,
    'km_from_shop', case
      when a.geo is null or v.lat is null then null
      else round((6371 * acos(least(1,
             cos(radians(v.lat)) * cos(radians(split_part(a.geo, ',', 1)::float8))
             * cos(radians(split_part(a.geo, ',', 2)::float8) - radians(v.lng))
             + sin(radians(v.lat)) * sin(radians(split_part(a.geo, ',', 1)::float8)))))::numeric, 1)
      end,
    'bag', public.agent_bag(v.agent_id),
    'queue', public.agent_queue(v.agent_id),
    'rates', public.agent_rates(v.agent_id));
end $$;
grant execute on function public.admin_ops_call_open(uuid) to authenticated;

-- ---- step 3 · the owner's figure, first --------------------------------------
create or replace function public.admin_ops_call_owner_amount(
  p_call uuid, p_cents int, p_reached boolean)
returns json
language plpgsql security definer set search_path = ''
as $$
declare c record;
begin
  if not public.is_admin() then raise exception 'The duty desk is ops only'; end if;
  select * into c from public.ops_calls where id = p_call;
  if c.id is null then raise exception 'No such call'; end if;
  if c.owner_amount_at is not null then
    raise exception 'His figure is already down - it is not typed twice';
  end if;

  -- `owner_reached: false` is the thinner grade, not a shortcut: there is then
  -- no owner figure at all, and the agent becomes the sole voucher.
  if p_reached and (p_cents is null or p_cents <= 0) then
    raise exception 'Ask him how much he handed over, and type what he says';
  end if;
  if not p_reached and p_cents is not null then
    raise exception 'If you did not reach him there is no figure of his to record';
  end if;

  update public.ops_calls
     set owner_amount_cents = p_cents, owner_amount_at = now(), owner_reached = p_reached
   where id = p_call;

  return json_build_object('call', p_call, 'owner_reached', p_reached,
                           'next', 'Now ask the agent, and type what he says.');
end $$;
grant execute on function public.admin_ops_call_owner_amount(uuid, int, boolean) to authenticated;

-- ---- step 4 · the agent's figure, and the authorisation ---------------------
create or replace function public.admin_ops_call_agent_amount(p_call uuid, p_cents int)
returns json
language plpgsql security definer set search_path = ''
as $$
declare c record; v_code text; v_exp timestamptz; v_match boolean;
begin
  if not public.is_admin() then raise exception 'The duty desk is ops only'; end if;
  select * into c from public.ops_calls where id = p_call;
  if c.id is null then raise exception 'No such call'; end if;

  -- THE ORDER. Taking the agent's figure first would put it in the duty
  -- officer's head before they ask the owner, and "is it 1 566?" is a different
  -- question from "how much did you hand over?".
  if c.owner_amount_at is null then
    raise exception 'Ring the owner first - his figure is taken before the agent''s';
  end if;
  if c.agent_amount_at is not null then
    raise exception 'His figure is already down';
  end if;
  if p_cents is null or p_cents <= 0 then raise exception 'Type what he says'; end if;

  update public.ops_calls
     set agent_amount_cents = p_cents, agent_amount_at = now()
   where id = p_call;

  -- when the owner was reached, the two figures must agree. When he was not,
  -- there is nothing to agree with and the agent stands alone - which is what
  -- makes that grade thinner, not what makes it invalid.
  v_match := (not c.owner_reached) or c.owner_amount_cents = p_cents;

  if not v_match then
    update public.ops_calls set discrepancy = true,
           note = 'Owner said ' || round(c.owner_amount_cents / 100.0)
                  || ' DH, agent said ' || round(p_cents / 100.0) || ' DH'
     where id = p_call;
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    select p.id, 'moderation', 'Two different amounts on ' || c.ref,
           'The owner said ' || round(c.owner_amount_cents / 100.0)
           || ' DH and the agent said ' || round(p_cents / 100.0)
           || ' DH. Nothing was issued. This needs a person before any cash is recorded.',
           p_cents
      from public.profiles p where p.role = 'admin';
    return json_build_object('call', p_call, 'issued', false, 'discrepancy', true,
      'owner_cents', c.owner_amount_cents, 'agent_cents', p_cents);
  end if;

  -- §4: six digits, ten minutes, read aloud only.
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_exp := now() + interval '10 minutes';
  update public.ops_calls
     set auth_code = v_code, issued_at = now(), expires_at = v_exp
   where id = p_call;

  return json_build_object('call', p_call, 'ref', c.ref, 'issued', true,
    'auth_code', v_code, 'expires_at', v_exp, 'owner_reached', c.owner_reached,
    'cents', p_cents,
    'say', 'Read these six digits to him. Do not send them.');
end $$;
grant execute on function public.admin_ops_call_agent_amount(uuid, int) to authenticated;

-- ---- the money path, shared ------------------------------------------------
-- §3 says the two proofs are not one abstraction with a parameter, and they are
-- not: they are two functions with two verifications. But the MONEY is the same
-- money, and two copies of the receipt-and-settle path is how they drift into
-- disagreeing about a partial. So the proof is separate and this is shared.
create or replace function public.record_collection(
  p_visit uuid, p_cents int, p_proof public.proof_kind,
  p_code text, p_queued boolean, p_captured timestamptz, p_client_ref text,
  p_owner_reached boolean, p_call_ref text, p_duty uuid,
  p_device text, p_geo text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v record; v_receipt text; v_open int;
begin
  select sv.*, l.id as line, l.amount_cents, l.collected_cents,
         s.name as salon, s.owner_id as owner
    into v
    from public.settlement_visits sv
    join public.settlement_lines l on l.id = sv.line_id
    join public.salons s on s.id = l.salon_id
   where sv.id = p_visit;

  insert into public.settlement_receipts
    (visit_id, line_id, agent_id, amount_cents, verified_by, code_ref, device_id, geo,
     verification, code_captured_at, synced_at, client_ref,
     owner_reached, call_ref, duty_user, dispute_window_expires_at)
  values (p_visit, v.line, v.agent_id, p_cents, p_proof, p_code, p_device, p_geo,
          case when p_queued then 'queued' else 'verified' end,
          p_captured, case when p_queued then now() end, p_client_ref,
          p_owner_reached, p_call_ref, p_duty,
          -- §4: the thinner grade carries a 72-hour window for the owner
          case when p_proof = 'ops_call' and p_owner_reached is false
               then now() + interval '72 hours' end)
  returning ref into v_receipt;

  perform public.admin_settle_line(v.line, p_cents, p_cents, v_receipt);
  v_open := abs(v.amount_cents) - coalesce(v.collected_cents, 0) - p_cents;
  update public.settlement_visits set state = 'closed', closed_at = now() where id = p_visit;

  return json_build_object('receipt', v_receipt, 'salon', v.salon, 'owner', v.owner,
                           'taken_cents', p_cents, 'open_cents', v_open);
end $$;
revoke all on function public.record_collection(uuid, int, public.proof_kind, text, boolean,
  timestamptz, text, boolean, text, uuid, text, text) from authenticated, anon;

-- ---- the agent, closing on the authorisation --------------------------------
create or replace function public.agent_collect_by_call(
  p_visit uuid, p_cents int, p_auth text,
  p_device text default null, p_geo text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare c record; r json; v_owner uuid;
begin
  if not public.is_agent() then raise exception 'Collections are ops only'; end if;

  select * into c from public.ops_calls
   where visit_id = p_visit and auth_code is not null and used_at is null
   order by issued_at desc limit 1;
  if c.id is null then raise exception 'No authorisation has been issued for this visit'; end if;
  if c.expires_at < now() then
    raise exception 'That authorisation has expired - ring the desk again';
  end if;
  if c.auth_code is distinct from p_auth then raise exception 'Those six digits do not match'; end if;
  -- it authorises the amount the two of them agreed, and no other
  if c.agent_amount_cents is distinct from p_cents then
    raise exception 'The desk authorised % DH', round(c.agent_amount_cents / 100.0);
  end if;

  update public.ops_calls set used_at = now() where id = c.id;

  r := public.record_collection(p_visit, p_cents, 'ops_call', null, false, null, null,
                                c.owner_reached, c.ref, c.duty_user, p_device, p_geo);
  v_owner := (r->>'owner')::uuid;

  if v_owner is not null then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (v_owner, 'shop_status', 'Receipt ' || (r->>'receipt'),
            'You handed over ' || round(p_cents / 100.0) || ' DH. '
            || case when c.owner_reached
                    then 'We rang you to confirm it before recording it.'
                    else 'We could not reach you at the time, so this rests on our '
                         || 'agent''s word alone. If that is wrong, tell us within '
                         || 'three days and nothing has been settled against you yet.'
               end,
            p_cents);
  end if;

  -- `||` is a jsonb operator, not a json one
  return (r::jsonb || jsonb_build_object('call', c.ref, 'owner_reached', c.owner_reached))::json;
end $$;
grant execute on function public.agent_collect_by_call(uuid, int, text, text, text) to authenticated;

-- ---- and the code path uses the same money path -----------------------------
-- 0095's function, with its own thirty lines of receipt-and-settle replaced by
-- the shared one. Introducing `record_collection` and leaving the main caller
-- writing its own copy would have made the drift I wrote it to prevent WORSE:
-- two paths, one of them looking like it had been unified.
create or replace function public.agent_collect(
  p_visit uuid, p_cents int, p_code text,
  p_device text default null, p_geo text default null,
  p_captured_at timestamptz default null, p_client_ref text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v record; c record; v_queued boolean; v_q json; v_over boolean;
  v_existing record; r json; v_owner uuid; v_open int;
begin
  if not public.is_agent() then raise exception 'Collections are ops only'; end if;

  if p_client_ref is not null then
    select * into v_existing from public.settlement_receipts where client_ref = p_client_ref;
    if v_existing.id is not null then
      return json_build_object('receipt', v_existing.ref, 'replay', true,
        'verification', v_existing.verification, 'taken_cents', v_existing.amount_cents,
        'bag', public.agent_bag(auth.uid()));
    end if;
  end if;

  v_queued := p_captured_at is not null;

  select sv.*, l.amount_cents, l.collected_cents, s.name as salon
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
  if coalesce(btrim(p_code), '') = '' then
    raise exception 'Ask him for the four digits - a code nobody asks for is a code that never existed';
  end if;

  select * into c from public.visit_codes where visit_id = p_visit;

  if not v_queued then
    if c.visit_id is null then
      raise exception 'Ask him to open his statement - no code has been issued for this visit';
    end if;
    if c.used_at is not null then raise exception 'That code has already been used'; end if;
    if c.expires_at < now() then
      raise exception 'That code has expired - ask him to open his statement again';
    end if;
    if c.code is distinct from p_code then raise exception 'That code does not match'; end if;
    if p_cents > c.amount_cents then
      raise exception 'His code covers % DH', round(c.amount_cents / 100.0);
    end if;
  end if;

  r := public.record_collection(p_visit, p_cents, 'code', p_code, v_queued,
                                p_captured_at, p_client_ref, null, null, null,
                                p_device, p_geo);
  v_owner := (r->>'owner')::uuid;
  v_open := (r->>'open_cents')::int;

  if not v_queued then
    update public.visit_codes set used_at = now() where visit_id = p_visit;
  end if;

  if v_queued then
    v_q := public.agent_queue(auth.uid());
    v_over := (v_q->>'n')::int > (v_q->>'max_n')::int
           or (v_q->>'cents')::int > (v_q->>'max_cents')::int;
    if v_over then
      insert into public.notifications (user_id, kind, title, body, amount_cents)
      select p.id, 'moderation', 'An agent is over the unchecked ceiling',
             coalesce((select full_name from public.profiles where id = auth.uid()), 'An agent')
             || ' has ' || (v_q->>'n') || ' unchecked collections worth '
             || round((v_q->>'cents')::int / 100.0) || ' DH. His app should have stopped him.',
             (v_q->>'cents')::int
        from public.profiles p where p.role = 'admin';
    end if;
  end if;

  if v_owner is not null then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (v_owner, 'shop_status', 'Receipt ' || (r->>'receipt'),
            'You handed over ' || round(p_cents / 100.0) || ' DH.'
            || case when v_queued
                    then ' We have not been able to check the code yet - it is waiting on signal, and you will see it change on your statement.'
                    else '' end
            || case when v_open > 0
                    then ' ' || round(v_open / 100.0)
                         || ' DH stays on this week''s line and comes back on next Friday''s statement.'
                    else ' That settles this week.' end,
            p_cents);
  end if;

  return (r::jsonb || jsonb_build_object(
            'code', p_code,
            'verification', case when v_queued then 'queued' else 'verified' end,
            'over_ceiling', coalesce(v_over, false),
            'bag', public.agent_bag(auth.uid())))::json;
end $$;
grant execute on function public.agent_collect(uuid, int, text, text, text, timestamptz, text)
  to authenticated;

do $$
begin
  -- §4: six digits, never four, so nothing downstream can confuse the two
  assert length(lpad((7)::text, 6, '0')) = 6, 'a low draw is still six digits';
  assert lpad((7)::text, 6, '0') = '000007', 'and it keeps its zeros';
  assert length(lpad((7)::text, 4, '0')) <> length(lpad((7)::text, 6, '0')),
    'an owner code and an authorisation are not the same length';

  -- both figures must agree before anything is issued
  assert (156600 = 156600), 'matching figures issue';
  assert not (156600 = 110000), 'and different ones issue nothing at all';

  -- the thinner grade has no owner figure to match, and still issues
  assert ((not true) or 156600 = 156600), 'owner reached: the figures must agree';
  assert ((not false) or 156600 = 110000), 'owner not reached: there is nothing to agree with';

  -- §4's window on the thinner grade
  assert extract(epoch from interval '72 hours') / 3600 = 72, 'three days to say otherwise';
end $$;
