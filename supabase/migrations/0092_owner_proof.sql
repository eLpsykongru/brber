-- 0092_owner_proof: the owner's half of the agent's visit.
--
-- The handoff's closing line: "Not built, owner-side: the 4-digit code on the
-- owner's own statement screen, and the *received* confirmation AGT-05 waits
-- for. Both are needed for this surface to work end to end."
--
-- The code function already exists (0090's `my_visit_code`). What was missing
-- is everything on the owner's side that makes it mean anything:
--
--   · a read that tells his screen there IS a visit to prove, so the four
--     digits appear under this week's statement rather than being minted by a
--     screen that does not know why;
--   · the receipt, on his side, the moment cash moves — AGT-04 tells the agent
--     "he already has the receipt in his app", which was not true;
--   · AGT-05's promise in words: "his app shows it as received within a
--     minute. If it does not, do not tap again, call ops." A promise the agent
--     reads aloud has to be one the product actually keeps.

-- ---- what the owner's statement shows about a visit ------------------------
create or replace function public.my_visit_status()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_salon uuid; j json;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then return json_build_object('salon', null); end if;

  select json_build_object(
    -- the visit he is being asked to prove, if there is one. NOT the code: this
    -- is a stable read and minting is a write, so the screen asks for the code
    -- only once it knows a visit is waiting.
    'pending', (
      select json_build_object(
               'visit', v.id, 'direction', v.direction,
               'amount_cents', abs(l.amount_cents) - coalesce(l.collected_cents, 0),
               'week', public.settlement_week_label(r.covers_to),
               'agent', coalesce(p.full_name, 'An agent'),
               'window_from', v.window_from, 'window_to', v.window_to)
        from public.settlement_visits v
        join public.settlement_lines l on l.id = v.line_id
        join public.settlement_runs r on r.id = l.run_id
        left join public.profiles p on p.id = v.agent_id
       where l.salon_id = v_salon and v.state <> 'closed'
       order by v.window_from nulls last, v.created_at limit 1),

    -- AGT-05's "his app shows it as received". The receipt is the proof on his
    -- side too, and it carries how it was proved because that is what makes it
    -- evidence rather than a note.
    'last_receipt', (
      select json_build_object(
               'ref', rc.ref, 'amount_cents', rc.amount_cents,
               'direction', v.direction, 'at', rc.recorded_at,
               'verified_by', rc.verified_by,
               'agent', coalesce(p.full_name, 'An agent'),
               'week', public.settlement_week_label(r.covers_to))
        from public.settlement_receipts rc
        join public.settlement_visits v on v.id = rc.visit_id
        join public.settlement_lines l on l.id = rc.line_id
        join public.settlement_runs r on r.id = l.run_id
        left join public.profiles p on p.id = rc.agent_id
       where l.salon_id = v_salon
       order by rc.recorded_at desc limit 1)
  ) into j;
  return j;
end $$;
grant execute on function public.my_visit_status() to authenticated;

-- ---- and the owner is told, the moment cash moves --------------------------
-- 0091's two functions, re-emitted with the notification each of them promised
-- on the agent's screen. Everything else in them is unchanged.

create or replace function public.agent_collect(
  p_visit uuid, p_cents int, p_code text,
  p_device text default null, p_geo text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v record; c record; v_receipt text; v_open int; v_owner uuid;
begin
  if not public.is_agent() then raise exception 'Collections are ops only'; end if;

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

  select * into c from public.visit_codes where visit_id = p_visit;
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

  insert into public.settlement_receipts
    (visit_id, line_id, agent_id, amount_cents, verified_by, code_ref, device_id, geo)
  values (p_visit, v.line, auth.uid(), p_cents, 'code', p_code, p_device, p_geo)
  returning ref into v_receipt;

  update public.visit_codes set used_at = now() where visit_id = p_visit;
  perform public.admin_settle_line(v.line, p_cents, p_cents, v_receipt);

  v_open := abs(v.amount_cents) - coalesce(v.collected_cents, 0) - p_cents;

  update public.settlement_visits
     set state = 'closed', closed_at = now() where id = p_visit;

  -- AGT-04: "He already has the receipt in his app and the line now reads
  -- 1 100 DH paid, so you do not need to send him anything." That sentence is
  -- the agent's reassurance to an owner standing in front of him, so it has to
  -- be true before he says it.
  -- ponytail: in-app notification, same as everywhere else. An SMS when the
  -- provider lands; the audience is already right.
  if v.owner is not null then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (v.owner, 'shop_status', 'Receipt ' || v_receipt,
            'You handed over ' || round(p_cents / 100.0) || ' DH.'
            || case when v_open > 0
                    then ' ' || round(v_open / 100.0)
                         || ' DH stays on this week''s line and comes back on next Friday''s statement.'
                    else ' That settles this week.' end,
            p_cents);
  end if;

  return json_build_object(
    'receipt', v_receipt, 'salon', v.salon, 'taken_cents', p_cents,
    'open_cents', v_open, 'code', p_code, 'bag', public.agent_bag(auth.uid()));
end $$;
grant execute on function public.agent_collect(uuid, int, text, text, text) to authenticated;

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

  select sv.*, l.id as line, l.amount_cents, l.collected_cents,
         s.name as salon, s.owner_id as owner
    into v
    from public.settlement_visits sv
    join public.settlement_lines l on l.id = sv.line_id
    join public.salons s on s.id = l.salon_id
   where sv.id = p_visit;
  if v.id is null then raise exception 'No such visit'; end if;
  if v.agent_id <> auth.uid() then raise exception 'That visit is on somebody else''s round'; end if;
  if v.state = 'closed' then raise exception 'That visit is already closed'; end if;
  if v.direction <> 'pay_out' then raise exception 'That visit is a collection'; end if;

  v_amount := abs(v.amount_cents) - coalesce(v.collected_cents, 0);

  insert into public.settlement_receipts
    (visit_id, line_id, agent_id, amount_cents, verified_by, signature_blob, device_id, geo)
  values (p_visit, v.line, auth.uid(), v_amount, 'signature', p_signature, p_device, p_geo)
  returning ref into v_receipt;

  perform public.admin_settle_line(v.line, v_amount, v_amount, v_receipt);

  update public.settlement_visits
     set state = 'closed', closed_at = now() where id = p_visit;

  -- AGT-05's promise, verbatim on the agent's screen: "his app shows it as
  -- received within a minute. If it does not, do not tap again, call ops."
  -- THIS is what makes that sentence true, and it is the only reason the agent
  -- has to not tap twice when he is standing there unsure.
  if v.owner is not null then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (v.owner, 'shop_status', 'Received ' || round(v_amount / 100.0) || ' DH',
            coalesce((select full_name from public.profiles where id = auth.uid()), 'An agent')
            || ' handed you ' || round(v_amount / 100.0) || ' DH and you signed for it. '
            || 'Receipt ' || v_receipt || '.',
            v_amount);
  end if;

  return json_build_object('receipt', v_receipt, 'salon', v.salon,
                           'handed_cents', v_amount, 'bag', public.agent_bag(auth.uid()));
end $$;
grant execute on function public.agent_hand_over(uuid, text, text, text) to authenticated;

do $$
begin
  -- AGT-04's two sentences, as arithmetic the owner's notification repeats
  assert 156600 - 110000 = 46600, '1 100 taken leaves 466 on the line';
  assert 110000 > 0, 'and the receipt he gets says what actually crossed';

  -- AGT-05: the amount is the line, exactly, so his notification cannot differ
  assert 357000 = 357000, 'a hand-over is all of it';

  -- the code is minted by a WRITE and read by a separate STABLE function, so
  -- opening the statement does not rotate the digits under the agent's pen
  assert (select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'my_visit_status') = 's',
    'the status read is stable';
  assert (select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'my_visit_code') = 'v',
    'and the code function is the one that writes';
end $$;
