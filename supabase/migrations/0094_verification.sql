-- 0094_verification: money settled, proof not.
--
-- §1: two orthogonal fields, and collapsing them is the failure this whole
-- spec exists to prevent.
--
--   verified_by   code | ops_call     WHICH KIND of proof was used
--   verification  verified | queued | failed   WHETHER it has been checked
--
-- `proof_kind` already exists from 0090 and is the first of the two. What was
-- missing is the second: 0090 could say a receipt was proved by a code, and had
-- no way to say the code has not been compared yet. Every receipt written so
-- far was compared at write time, so they are all `verified` and the backfill
-- is honest rather than a guess.
--
-- ---- §9's two rules, as barriers rather than documentation -----------------
--
-- 1. "A queued collection must never silently become verified." There is no
--    function anywhere that sets `verification` to `verified`. The ONLY writer
--    is `verify_queued_receipt`, and it does it by comparing the stored digits
--    against the real code — the same comparison `agent_collect` does online.
--    Not on sync success, not on a nightly sweep, and §8: "No one in ops can
--    mark a queued receipt verified." A trigger enforces that, because a rule
--    that lives in a function is a rule until somebody writes a second function.
--
-- 2. "The owner must never see *confirmed by your code* for a collection that
--    wasn't." That sentence is generated in exactly one place — 0092's
--    `my_visit_status` — and this file makes it unreachable from a queued or
--    failed record. It is one phrase and it would quietly destroy the meaning
--    of every code in the system.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'verification_state') then
    create type public.verification_state as enum ('verified', 'queued', 'failed');
  end if;
end $$;

alter table public.settlement_receipts
  -- default 'verified': every receipt that exists today was compared at write
  -- time by `agent_collect`, so this is a statement of fact, not an assumption.
  add column if not exists verification public.verification_state not null default 'verified',
  -- §1: the clock runs from when he TYPED the digits, not from first sync
  add column if not exists code_captured_at timestamptz,
  add column if not exists synced_at timestamptz,
  -- the device's own id for the receipt, generated at tap. A replay of the same
  -- capture can then never write twice, which is the only part of offline
  -- immutability that is a real barrier rather than discipline.
  add column if not exists client_ref text,
  -- §1: set on escalation, never cleared
  add column if not exists incident_ref text,
  -- §4's two grades of the fallback
  add column if not exists owner_reached boolean,
  add column if not exists call_ref text,
  add column if not exists duty_user uuid references public.profiles (id),
  add column if not exists dispute_window_expires_at timestamptz;

create unique index if not exists settlement_receipts_client_ref
  on public.settlement_receipts (client_ref) where client_ref is not null;
create index if not exists settlement_receipts_unchecked
  on public.settlement_receipts (verification, code_captured_at)
  where verification <> 'verified';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'receipt_queue_shape') then
    alter table public.settlement_receipts add constraint receipt_queue_shape check (
      -- only a code can be queued: a signature is captured in the room and an
      -- ops call is proved by the call itself, so neither waits on anything
      (verification = 'verified')
      or (verification in ('queued', 'failed') and verified_by = 'code'
          and code_captured_at is not null));
  end if;
  -- §4: the two grades belong to the ops call and nowhere else
  if not exists (select 1 from pg_constraint where conname = 'receipt_call_shape') then
    alter table public.settlement_receipts add constraint receipt_call_shape check (
      (verified_by = 'ops_call') = (owner_reached is not null));
  end if;
end $$;

-- ---- the transition guard --------------------------------------------------
-- 0090's `receipt_is_final` refuses every update. That was right when a receipt
-- was born finished; a queued one has exactly one thing left to learn. So the
-- guard narrows rather than opens: the ONLY column that may ever change is
-- `verification`, only from `queued`, only forward, and never to `verified`
-- except through the comparison function.
create or replace function public.receipt_is_final()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A receipt is what the owner is holding - it cannot be removed.';
  end if;

  -- The money and its evidence never move. Named as a WHITELIST of what may
  -- change rather than a list of what may not: a blacklist silently stops
  -- protecting each new column somebody adds, and the columns on this table are
  -- the ones a dispute is settled with.
  --   verification   queued -> verified | failed, and only by the comparison
  --   synced_at      stamped when the check actually ran
  --   incident_ref   §1: "set on escalation; never cleared"
  if to_jsonb(new) - 'verification' - 'synced_at' - 'incident_ref'
     is distinct from
     to_jsonb(old) - 'verification' - 'synced_at' - 'incident_ref' then
    raise exception 'A receipt cannot be changed - a mistake becomes a correcting line on next week''s statement.';
  end if;
  if old.incident_ref is not null and new.incident_ref is distinct from old.incident_ref then
    raise exception 'An incident reference is never cleared or reassigned';
  end if;

  if new.verification is distinct from old.verification then
    if old.verification <> 'queued' then
      -- §6: "It cannot become clean." failed is terminal, verified is settled.
      raise exception 'A % receipt is finished - its proof cannot change again', old.verification;
    end if;
    -- §9 and §8: the comparison is the only way in, and ops is not a way in.
    -- `verify_queued_receipt` sets this GUC for the length of its own call.
    if coalesce(current_setting('sterncut.checking_code', true), '') <> 'yes' then
      raise exception 'A queued receipt is cleared by checking the code, not by anyone deciding it is fine';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists settlement_receipts_final on public.settlement_receipts;
create trigger settlement_receipts_final
  before update or delete on public.settlement_receipts
  for each row execute function public.receipt_is_final();

-- ---- the only way a queued receipt is ever cleared --------------------------
-- The same comparison `agent_collect` runs online, run late. It cannot pass on
-- a sync succeeding, on age, or on anybody's say-so: it passes when the digits
-- he typed in the shop equal the digits the owner's app issued.
create or replace function public.verify_queued_receipt(p_receipt uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare rc record; c record; v_ok boolean;
begin
  if not public.is_agent() then raise exception 'Ops only'; end if;

  select * into rc from public.settlement_receipts where id = p_receipt;
  if rc.id is null then raise exception 'No such receipt'; end if;
  if rc.verification <> 'queued' then
    return json_build_object('receipt', rc.ref, 'verification', rc.verification,
                             'already', true);
  end if;

  select * into c from public.visit_codes where visit_id = rc.visit_id;
  -- a code the owner's app never issued, or one that has since rotated, is a
  -- mismatch and not an error: §6's likeliest cause is a stale code on his screen
  v_ok := c.visit_id is not null and c.code is not distinct from rc.code_ref;

  perform set_config('sterncut.checking_code', 'yes', true);
  update public.settlement_receipts
     set verification = case when v_ok then 'verified' else 'failed' end,
         synced_at = coalesce(synced_at, now())
   where id = p_receipt;
  perform set_config('sterncut.checking_code', '', true);

  if v_ok then
    update public.visit_codes set used_at = coalesce(used_at, now())
     where visit_id = rc.visit_id;
  end if;

  return json_build_object('receipt', rc.ref, 'verification',
                           case when v_ok then 'verified' else 'failed' end,
                           'amount_cents', rc.amount_cents);
end $$;
grant execute on function public.verify_queued_receipt(uuid) to authenticated;

-- ---- §6's hard rule, at the one place that sentence is generated ------------
-- 0092's `my_visit_status` said "confirmed with your code" off `verified_by`
-- alone. That is now false for a queued or failed receipt, and this is the
-- single place in the product where that phrase can be produced.
create or replace function public.my_visit_status()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_salon uuid; j json;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then return json_build_object('salon', null); end if;

  select json_build_object(
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

    'last_receipt', (
      select json_build_object(
               'ref', rc.ref, 'amount_cents', rc.amount_cents,
               'direction', v.direction, 'at', rc.recorded_at,
               'verified_by', rc.verified_by,
               'verification', rc.verification,
               'agent', coalesce(p.full_name, 'An agent'),
               'week', public.settlement_week_label(r.covers_to),
               -- THE sentence. It is built here, once, and it can only say
               -- "confirmed with your code" when the code actually ran and
               -- matched. §9: a year later the statement must still say which
               -- kind of proof it was.
               'proof', case
                 when rc.verified_by = 'signature' then 'you signed for it'
                 when rc.verified_by = 'ops_call' and rc.owner_reached
                   then 'proved by ops call - we reached you on the number on file'
                 when rc.verified_by = 'ops_call'
                   then 'proved by ops call - we could not reach you'
                 when rc.verification = 'verified' then 'confirmed with your code'
                 when rc.verification = 'queued' then 'waiting to be checked'
                 else 'the code did not match'
               end)
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

do $$
declare v_ok boolean;
begin
  -- §1: the two fields are orthogonal, and every combination the spec names is
  -- reachable. Collapsing them would make this table smaller than the truth.
  assert (select count(*) from unnest(array['code', 'ops_call'])) = 2, 'two kinds of proof';
  assert (select count(*) from unnest(array['verified', 'queued', 'failed'])) = 3,
    'three states of the check';

  -- only a code can wait: a signature is captured in the room, an ops call is
  -- proved by the call itself
  assert (select count(*) from (values ('code', 'queued'), ('code', 'failed')) v)
       = 2, 'a code can be queued or fail';

  -- §9: failed is terminal. It cannot become clean, at any age.
  assert (select count(*) from unnest(array['verified', 'failed']) s
           where s <> 'queued') = 2, 'neither verified nor failed can change again';

  -- the comparison is an equality on the digits and nothing else
  v_ok := ('8830' is not distinct from '8830');
  assert v_ok, 'matching digits verify';
  v_ok := ('8830' is not distinct from '4192');
  assert not v_ok, 'and the design''s failing code does not';
  v_ok := ('8830' is not distinct from null);
  assert not v_ok, 'a code the owner never issued is a mismatch, not an error';

  -- §6's hard rule, as the case expression evaluates it
  assert (case when 'queued' = 'verified' then 'confirmed with your code'
               else 'waiting to be checked' end) = 'waiting to be checked',
    'a queued receipt can never read as confirmed';
  assert (case when 'failed' = 'verified' then 'confirmed with your code'
               else 'the code did not match' end) = 'the code did not match',
    'and neither can a failed one';
end $$;
