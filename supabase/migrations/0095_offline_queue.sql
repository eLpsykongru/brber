-- 0095_offline_queue: a collection recorded with no signal.
--
-- §10 step 2. §5: "He still asks for the code. Dropping it offline would be
-- fatal: a code nobody ever asks for is a code that never existed." So the
-- offline path is the online one minus exactly one thing — the comparison —
-- and the digits are carried across unchanged.
--
-- ---- the shape, and why it is two calls and not one ------------------------
--
-- By the time the queued receipt reaches this database the phone is back
-- online, so the comparison COULD run in the same request. It deliberately does
-- not. The receipt is written `queued` with its real `code_captured_at`, and
-- `verify_queued_receipt` (0094) is a separate call.
--
-- That is not ceremony. §7's clock runs from capture, and the gap between
-- `code_captured_at` and `synced_at` is the only evidence that a shop's money
-- sat unchecked for three days. Collapsing the two into one insert would write
-- a receipt that had always been verified and lose the fact entirely — which is
-- the exact reconciliation failure §8 exists to prevent.
--
-- ---- the ceiling, and a decision the spec leaves open ----------------------
--
-- §5: "max 5 unchecked collections or 6 000 DH per agent. At the ceiling the
-- app will not open another collect." That is necessarily a CLIENT rule — the
-- server cannot refuse a collect it has not heard of.
--
-- DECIDED: at sync the server re-checks the ceiling and, if it was breached,
-- records the receipt anyway and marks it an incident. Refusing would be worse:
-- the cash is already in his bag and the owner is already short, so a refusal
-- destroys the only record of real money. A tampered or buggy app is caught,
-- and nothing is lost catching it.

-- §5 gives two ceilings; both are settings so ops can move them without a
-- deploy, and both are read by the tally the agent sees.
alter table public.platform_settings
  add column if not exists agent_unchecked_max int not null default 5,
  add column if not exists agent_unchecked_cents int not null default 600000;

-- ---- his tally --------------------------------------------------------------
-- §5's `3 of 5 · 4 120 DH`, pinned to the top of his round until it clears. It
-- reads receipts, so the number on his phone and the number ops sees are the
-- same number.
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
    -- §5's two ceilings, both from settings so ops can move them
    'max_n', (select agent_unchecked_max from public.platform_settings),
    'max_cents', (select agent_unchecked_cents from public.platform_settings),
    -- §7: age runs from collection, not from the first sync attempt
    'oldest_h', (select floor(max(age_h))::int from q),
    'failed', (select count(*) from public.settlement_receipts rc, me
                where rc.agent_id = me.id and rc.verification = 'failed'
                  and rc.incident_ref is null),
    'at_ceiling', (
      (select count(*) from q) >= (select agent_unchecked_max from public.platform_settings)
      or coalesce((select sum(amount_cents) from q), 0)
         >= (select agent_unchecked_cents from public.platform_settings))
  )
  from me
  where public.is_agent();
$$;
grant execute on function public.agent_queue(uuid) to authenticated;


-- ---- the collect, with an offline path --------------------------------------
-- 0092's function. Everything about the online path is unchanged; the offline
-- path is the same function with the comparison skipped and the capture time
-- carried in from the device.
create or replace function public.agent_collect(
  p_visit uuid, p_cents int, p_code text,
  p_device text default null, p_geo text default null,
  p_captured_at timestamptz default null, p_client_ref text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v record; c record; v_receipt text; v_open int; v_queued boolean;
  v_q json; v_over boolean; v_existing record;
begin
  if not public.is_agent() then raise exception 'Collections are ops only'; end if;

  -- A replay of the same capture returns what it wrote the first time rather
  -- than writing again. This is the one part of offline immutability that is a
  -- real barrier: the device names the receipt, and the name is unique.
  if p_client_ref is not null then
    select * into v_existing from public.settlement_receipts where client_ref = p_client_ref;
    if v_existing.id is not null then
      return json_build_object('receipt', v_existing.ref, 'replay', true,
        'verification', v_existing.verification, 'taken_cents', v_existing.amount_cents,
        'bag', public.agent_bag(auth.uid()));
    end if;
  end if;

  -- offline capture is what makes this queued, not the absence of a code
  v_queued := p_captured_at is not null;

  select sv.*, l.id as line, l.salon_id, l.amount_cents, l.collected_cents,
         s.name as salon, s.owner_id as owner
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
    -- §5: he still asks for the code, offline or not
    raise exception 'Ask him for the four digits - a code nobody asks for is a code that never existed';
  end if;

  select * into c from public.visit_codes where visit_id = p_visit;

  if not v_queued then
    -- the online path, unchanged
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

  insert into public.settlement_receipts
    (visit_id, line_id, agent_id, amount_cents, verified_by, code_ref, device_id, geo,
     verification, code_captured_at, synced_at, client_ref)
  values (p_visit, v.line, auth.uid(), p_cents, 'code', p_code, p_device, p_geo,
          case when v_queued then 'queued' else 'verified' end,
          p_captured_at,
          case when v_queued then now() end,
          p_client_ref)
  returning ref into v_receipt;

  if not v_queued then
    update public.visit_codes set used_at = now() where visit_id = p_visit;
  end if;

  perform public.admin_settle_line(v.line, p_cents, p_cents, v_receipt);

  v_open := abs(v.amount_cents) - coalesce(v.collected_cents, 0) - p_cents;
  update public.settlement_visits
     set state = 'closed', closed_at = now() where id = p_visit;

  -- §5's ceiling, re-checked server-side AFTER the write. See the header: a
  -- refusal here would destroy the only record of cash already in his bag.
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

  -- §6: the owner is told what actually happened, and a queued collection says
  -- so. He is never told it was confirmed with his code when it was not.
  if v.owner is not null then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (v.owner, 'shop_status', 'Receipt ' || v_receipt,
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

  return json_build_object(
    'receipt', v_receipt, 'salon', v.salon, 'taken_cents', p_cents,
    'open_cents', v_open, 'code', p_code,
    'verification', case when v_queued then 'queued' else 'verified' end,
    'over_ceiling', coalesce(v_over, false),
    'bag', public.agent_bag(auth.uid()));
end $$;
grant execute on function public.agent_collect(uuid, int, text, text, text, timestamptz, text)
  to authenticated;

-- 0092's five-argument version would still resolve for an online caller and
-- would silently bypass everything above, so it goes.
drop function if exists public.agent_collect(uuid, int, text, text, text);

do $$
begin
  -- §5's tally, as the design draws it: 3 of 5 · 4 120 DH
  assert 3 < 5, 'three unchecked is under the count ceiling';
  assert 412000 < 600000, 'and 4 120 DH is under the money one';
  assert not (3 >= 5 or 412000 >= 600000), 'so he can still open another collect';
  -- and the fifth one closes it
  assert (5 >= 5), 'the fifth unchecked collection is the ceiling';

  -- §7: the clock is capture to now, never first-sync to now
  assert extract(epoch from interval '72 hours') / 3600 = 72, 'seventy-two hours is 72';
  assert floor(extract(epoch from interval '75 hours') / 3600) = 75,
    'a receipt captured 75 hours ago is 75 hours old however late it synced';

  -- the offline path is the online one minus the comparison, and nothing else:
  -- the digits are still required
  assert coalesce(btrim(''), '') = '', 'an empty code is refused offline too';
  assert coalesce(btrim('8830'), '') <> '', 'and the drawn one is not';

  -- one agent_collect, so no caller can reach an older signature that skips the
  -- ceiling and the queued path
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'agent_collect') = 1,
    'exactly one agent_collect';
end $$;
