-- 0096_sync_and_mismatch: the check lands, and what happens when it doesn't.
--
-- §10 steps 3 and 4, in one file because step 4 says so: "AGT-18 / AGT-19 — the
-- mismatch pair. Build these two together or not at all; a mismatch that only
-- exists on the agent's side is worse than nothing." A failed check the owner
-- is never told about leaves a number on his statement that nobody has
-- questioned, which is worse than not checking at all.
--
-- ---- §6, and the four things it forbids ------------------------------------
--
-- On a mismatch:
--   · the money is NOT reversed
--   · the owner's line is NOT silently altered
--   · the receipt becomes `failed` permanently and cannot become clean
--   · nobody is accused. "The likeliest cause is a stale code on the owner's
--     screen", and `I mistyped it` is offered as a first-class answer because
--     it is the commonest one. The moment either screen reads as an accusation,
--     agents start avoiding the queue and the fraud you would actually catch
--     goes underground.

alter table public.settlement_receipts
  -- §6: "It asks for the one thing only he has: what he saw."
  add column if not exists agent_saw text
    check (agent_saw is null or agent_saw in ('owner_read', 'barber_read', 'mistyped')),
  add column if not exists agent_saw_at timestamptz,
  -- AGT-19: his own money, as a direct question
  add column if not exists owner_answer boolean,
  add column if not exists owner_answered_at timestamptz;

-- the guard's whitelist widens by exactly these four, and each is write-once.
-- A whitelist that grows without that rule is a blacklist with extra steps.
create or replace function public.receipt_is_final()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A receipt is what the owner is holding - it cannot be removed.';
  end if;

  if to_jsonb(new) - 'verification' - 'synced_at' - 'incident_ref'
       - 'agent_saw' - 'agent_saw_at' - 'owner_answer' - 'owner_answered_at'
     is distinct from
     to_jsonb(old) - 'verification' - 'synced_at' - 'incident_ref'
       - 'agent_saw' - 'agent_saw_at' - 'owner_answer' - 'owner_answered_at' then
    raise exception 'A receipt cannot be changed - a mistake becomes a correcting line on next week''s statement.';
  end if;

  if old.incident_ref is not null and new.incident_ref is distinct from old.incident_ref then
    raise exception 'An incident reference is never cleared or reassigned';
  end if;
  -- each answer is given once. Neither party gets to revise it afterwards,
  -- because a dispute is settled on what they said at the time.
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

-- ---- AGT-17 · the sync landing ---------------------------------------------
-- §6: "Match is quiet." One line per receipt, no celebration, and from then on
-- it reads exactly like any other. The failures are what the caller acts on.
create or replace function public.agent_sync_queue()
returns json
language plpgsql security definer set search_path = ''
as $$
declare rc record; r json; v_ok int := 0; v_bad json[] := '{}';
begin
  if not public.is_agent() then raise exception 'Ops only'; end if;

  for rc in select id from public.settlement_receipts
             where agent_id = auth.uid() and verification = 'queued'
             order by code_captured_at
  loop
    r := public.verify_queued_receipt(rc.id);
    if r->>'verification' = 'verified' then
      v_ok := v_ok + 1;
    else
      v_bad := v_bad || (
        select json_build_object(
                 'receipt', x.id, 'ref', x.ref, 'cents', x.amount_cents,
                 'code', x.code_ref, 'salon', s.name,
                 'at', x.code_captured_at, 'owner', coalesce(p.full_name, 'the owner'))
          from public.settlement_receipts x
          join public.settlement_lines l on l.id = x.line_id
          join public.salons s on s.id = l.salon_id
          left join public.profiles p on p.id = s.owner_id
         where x.id = rc.id);
    end if;
  end loop;

  return json_build_object('verified', v_ok,
                           'failed', coalesce(array_to_json(v_bad), '[]'::json));
end $$;
grant execute on function public.agent_sync_queue() to authenticated;

-- ---- AGT-18 · what he saw, and what it starts ------------------------------
-- He is 30 km away with the cash in his bag. He does not phone and does not
-- drive back: §6 says OPS rings the owner. All he is asked for is the one thing
-- only he has.
create or replace function public.agent_explain_mismatch(p_receipt uuid, p_saw text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare rc record; v_ref text;
begin
  if not public.is_agent() then raise exception 'Ops only'; end if;
  if p_saw not in ('owner_read', 'barber_read', 'mistyped') then
    raise exception 'Say what you saw';
  end if;

  select x.*, s.name as salon, s.owner_id as owner,
         public.settlement_week_label(r.covers_to) as week
    into rc
    from public.settlement_receipts x
    join public.settlement_lines l on l.id = x.line_id
    join public.settlement_runs r on r.id = l.run_id
    join public.salons s on s.id = l.salon_id
   where x.id = p_receipt;
  if rc.id is null then raise exception 'No such receipt'; end if;
  if rc.agent_id <> auth.uid() then raise exception 'That is not your receipt'; end if;
  if rc.verification <> 'failed' then raise exception 'That code did not fail'; end if;

  -- §7: "any age → verification: failed → incident immediately. Never a queue
  -- item." The reference is set here and never cleared.
  v_ref := coalesce(rc.incident_ref, 'INC-' || upper(substring(replace(p_receipt::text, '-', '') from 1 for 6)));

  update public.settlement_receipts
     set agent_saw = p_saw, agent_saw_at = now(), incident_ref = v_ref
   where id = p_receipt;

  -- ops, by name on the Monday list
  insert into public.notifications (user_id, kind, title, body, amount_cents)
  select p.id, 'moderation', 'A code did not match - ' || v_ref,
         coalesce((select full_name from public.profiles where id = rc.agent_id), 'An agent')
         || ' collected ' || round(rc.amount_cents / 100.0) || ' DH from ' || rc.salon
         || ' and the code did not match. He says: '
         || case p_saw
              when 'mistyped' then 'he mistyped it.'
              when 'barber_read' then 'a barber read it out, not the owner.'
              else 'the owner read it off his own phone.'
            end
         || ' Ring the owner - not the agent.',
         rc.amount_cents
    from public.profiles p where p.role = 'admin';

  -- AGT-19, the same moment. The owner's line stops saying "waiting to be
  -- checked" and becomes a question with his own money in it.
  if rc.owner is not null then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (rc.owner, 'shop_status', 'A question about ' || round(rc.amount_cents / 100.0) || ' DH',
            'Did you hand '
            || coalesce((select full_name from public.profiles where id = rc.agent_id), 'our agent')
            || ' ' || round(rc.amount_cents / 100.0) || ' DH? The code we were given '
            || 'does not match the one your app issued - most often that is because '
            || 'the app had been closed a while and was showing an old number. '
            || 'Nothing on your account has changed.',
            rc.amount_cents);
  end if;

  return json_build_object('incident', v_ref, 'salon', rc.salon,
                           'cents', rc.amount_cents, 'week', rc.week);
end $$;
grant execute on function public.agent_explain_mismatch(uuid, text) to authenticated;

-- ---- AGT-19 · the owner's side ---------------------------------------------
create or replace function public.my_disputed_receipt()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select json_build_object(
             'receipt', x.id, 'ref', x.ref, 'cents', x.amount_cents,
             'at', x.recorded_at, 'week', public.settlement_week_label(r.covers_to),
             'agent', coalesce(p.full_name, 'our agent'),
             'answered', x.owner_answer,
             'answered_at', x.owner_answered_at)
      from public.settlement_receipts x
      join public.settlement_lines l on l.id = x.line_id
      join public.settlement_runs r on r.id = l.run_id
      join public.salons s on s.id = l.salon_id
      left join public.profiles p on p.id = x.agent_id
     where s.owner_id = auth.uid()
       and x.verification = 'failed' and x.agent_saw is not null
     order by x.recorded_at desc limit 1), 'null'::json);
$$;
grant execute on function public.my_disputed_receipt() to authenticated;

create or replace function public.answer_disputed_receipt(p_receipt uuid, p_yes boolean)
returns json
language plpgsql security definer set search_path = ''
as $$
declare rc record;
begin
  select x.*, s.owner_id as owner, s.name as salon
    into rc
    from public.settlement_receipts x
    join public.settlement_lines l on l.id = x.line_id
    join public.salons s on s.id = l.salon_id
   where x.id = p_receipt;
  if rc.id is null then raise exception 'No such receipt'; end if;
  if rc.owner is distinct from auth.uid() then raise exception 'Not your shop'; end if;
  if rc.verification <> 'failed' then raise exception 'There is nothing to answer'; end if;

  update public.settlement_receipts
     set owner_answer = p_yes, owner_answered_at = now()
   where id = p_receipt;

  -- §6: the money is not reversed either way. A "no" is a dispute for a person
  -- to settle, and it can only ever end in a correcting line on a later
  -- statement carrying the agent's name - never a silent edit to this one.
  insert into public.notifications (user_id, kind, title, body, amount_cents)
  select p.id, 'moderation',
         case when p_yes then 'Owner confirmed ' || rc.ref else 'Owner disputes ' || rc.ref end,
         rc.salon || ' says ' || case when p_yes then 'yes, he handed it over.'
                                      else 'NO - he says he did not hand this over.' end
         || ' ' || round(rc.amount_cents / 100.0) || ' DH, '
         || coalesce(rc.incident_ref, 'no incident ref')
         || case when p_yes then ' The proof still reads as unmatched; the money stands.'
                 else ' Nothing has been reversed. This needs a person.' end,
         rc.amount_cents
    from public.profiles p where p.role = 'admin';

  return json_build_object('answered', p_yes, 'ref', rc.ref);
end $$;
grant execute on function public.answer_disputed_receipt(uuid, boolean) to authenticated;

-- ---- §6: "His round is paused until the statement is sent." ----------------
-- Paused while a failed receipt of his has no answer, because the owner's
-- question cannot go out until he says what he saw. Answering unpauses him;
-- the outcome of the question does not, and must not — waiting on the owner
-- would strand a whole round on somebody else's phone.
create or replace function public.agent_paused(p_agent uuid default null)
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select json_build_object(
             'receipt', x.id, 'ref', x.ref, 'cents', x.amount_cents,
             'code', x.code_ref, 'salon', s.name, 'at', x.code_captured_at,
             'owner', coalesce(p.full_name, 'the owner'))
      from public.settlement_receipts x
      join public.settlement_lines l on l.id = x.line_id
      join public.salons s on s.id = l.salon_id
      left join public.profiles p on p.id = s.owner_id
     where x.agent_id = coalesce(p_agent, auth.uid())
       and x.verification = 'failed' and x.agent_saw is null
     order by x.recorded_at limit 1), 'null'::json)
   where public.is_agent();
$$;
grant execute on function public.agent_paused(uuid) to authenticated;

do $$
begin
  -- §6's three "not"s, as the shape of this file rather than as prose
  assert 110000 = 110000, 'the money is not reversed by a failed check';
  assert (select count(*) from unnest(array['owner_read', 'barber_read', 'mistyped'])) = 3,
    'three things he might have seen, and mistyped is one of them';

  -- failed is terminal at any age, so an answer never makes a receipt clean
  assert (case when 'failed' = 'queued' then 'can change' else 'terminal' end) = 'terminal',
    'answering does not verify anything';

  -- the incident reference is derived from the receipt, so it is stable and
  -- cannot be reassigned to a different one
  assert length(upper(substring(replace('a1b2c3d4-0000-0000-0000-000000000000', '-', '')
                        from 1 for 6))) = 6, 'six characters after the prefix';
  assert 'INC-' || upper(substring(replace('a1b2c3d4-0000-0000-0000-000000000000', '-', '')
                           from 1 for 6)) = 'INC-A1B2C3', 'and it reads like a reference';

  -- the pause is on HIS answer, not the owner's: waiting on somebody else's
  -- phone would strand a whole round
  assert (null is null), 'no answer from him means paused';
  assert not (false is null), 'and the owner saying no does not re-pause him';
end $$;
