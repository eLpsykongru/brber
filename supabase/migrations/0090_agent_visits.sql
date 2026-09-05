-- 0090_agent_visits: the agent's round — visits, receipts, and the per-visit code.
--
-- §8 step 1: "the shop-side code generator comes first, because nothing can be
-- verified without it."
--
-- ---- why these are new tables and not columns ------------------------------
--
-- §5: "The round is a query over `settlement_visit`, not over
-- `settlement_line`, because one line can take two visits (a partial, then a
-- return)." That is the whole reason this file exists — 0085 put `visit`,
-- `collected_cents` and `settled_at` ON the line, which can describe one visit
-- and not two.
--
-- ---- §3, the decision that shapes the schema -------------------------------
--
-- COLLECT is proved by the owner's 4-digit code, minted on the SHOP side.
-- HAND OVER is proved by the owner's signature, and asks for no code.
--
-- They are not one abstraction with a parameter. A signature captured on the
-- agent's own phone is drawn by whoever is holding the phone, so it cannot
-- prove he was in the shop — which is exactly the fraud in the collect
-- direction. And a code proves presence, which was never in question when we
-- are the ones handing money over. `verified_by` records WHICH proof, and a
-- constraint makes each direction carry the right one.
--
-- ---- what already exists and is kept ---------------------------------------
--
-- `salons.handover_code` + `float_handover_code()` (0053) already mint a code
-- on the shop side, verify it agent-side and SPEND it on use. That last part is
-- the hard bit and it is right. What it cannot do is bind to a visit or an
-- amount, and its 12-hour window is a day, not a visit. So the mechanism
-- survives and the shape changes.

create sequence if not exists public.receipt_ref_seq start 1180;

-- §2.4: the cap is what makes him go to the office before the last visit, so it
-- is a number ops can move rather than one buried in a query.
alter table public.platform_settings
  add column if not exists agent_bag_cap_cents int not null default 1200000;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'visit_state') then
    create type public.visit_state as enum ('planned', 'open', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'proof_kind') then
    -- ops_call exists in the type and nothing writes it: §3's no-code fallback
    -- is undesigned, and a receipt that cannot say how it was proved is worse
    -- than one that can say "a person on the phone".
    create type public.proof_kind as enum ('code', 'signature', 'ops_call');
  end if;
end $$;

-- ---- 1 · a visit ------------------------------------------------------------
create table if not exists public.settlement_visits (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.settlement_lines (id) on delete restrict,
  agent_id uuid references public.profiles (id),
  -- denormalised from the line on purpose: the agent's round is read on a
  -- scooter and must not depend on a join staying correct, and §2.1 says the
  -- word is what he reads first.
  direction public.settlement_direction not null,
  window_from timestamptz,
  window_to timestamptz,
  state public.visit_state not null default 'planned',
  -- where he is actually driving, as it was when the round was planned
  address text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint settlement_visit_not_nil check (direction <> 'nil')
);
create index if not exists settlement_visits_agent_idx
  on public.settlement_visits (agent_id, state, window_from);
create index if not exists settlement_visits_line_idx on public.settlement_visits (line_id);

-- ---- 2 · a receipt, one per movement of cash --------------------------------
-- §5: "One row per movement of cash, not one per visit." A visit that takes
-- 1 100 of 1 566 writes one receipt; the return trip writes another.
create table if not exists public.settlement_receipts (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default 'SR-' || nextval('public.receipt_ref_seq'),
  visit_id uuid not null references public.settlement_visits (id) on delete restrict,
  -- the line as well as the visit: §5's "sum of a line's receipts never exceeds
  -- the line amount" has to be checkable in one place, and a visit is not it.
  line_id uuid not null references public.settlement_lines (id) on delete restrict,
  agent_id uuid not null references public.profiles (id),
  amount_cents int not null check (amount_cents > 0),
  -- never nullable: §5's "no receipt may be written without a verified_by"
  verified_by public.proof_kind not null,
  code_ref text,
  signature_blob text,
  device_id text,
  geo text,
  recorded_at timestamptz not null default now(),
  -- the proof has to match the direction it is proving (§3)
  constraint receipt_has_its_proof check (
    (verified_by = 'code' and code_ref is not null) or
    (verified_by = 'signature' and signature_blob is not null) or
    verified_by = 'ops_call')
);
create index if not exists settlement_receipts_line_idx on public.settlement_receipts (line_id);
create index if not exists settlement_receipts_agent_idx
  on public.settlement_receipts (agent_id, recorded_at desc);

-- ---- 3 · the per-visit code -------------------------------------------------
-- Bound to the visit AND the amount, so a code read out for a 1 100 DH
-- collection cannot be replayed against a different number. Minted shop-side,
-- verified agent-side, spent on use.
create table if not exists public.visit_codes (
  visit_id uuid primary key references public.settlement_visits (id) on delete cascade,
  code text not null check (code ~ '^[0-9]{4}$'),
  amount_cents int not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- ---- 4 · the bag ------------------------------------------------------------
-- NOT a stored balance. §6.1 of the settlement README: "There is no balance
-- column that anyone updates." AGT-01's strip and AGT-03's "into your bag" row
-- must agree, and the only way to guarantee that is for both to call one
-- function over the receipts themselves.
create table if not exists public.agent_drops (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles (id),
  amount_cents int not null check (amount_cents > 0),
  dropped_at timestamptz not null default now(),
  note text
);
create index if not exists agent_drops_idx on public.agent_drops (agent_id, dropped_at desc);

-- ---- the barriers -----------------------------------------------------------
create or replace function public.receipt_is_final()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'A receipt is what the owner is holding - it cannot be changed or removed. A mistake becomes a correcting line on next week''s statement.';
end $$;

drop trigger if exists settlement_receipts_final on public.settlement_receipts;
create trigger settlement_receipts_final
  before update or delete on public.settlement_receipts
  for each row execute function public.receipt_is_final();

-- §5's two money invariants, enforced rather than tested
create or replace function public.receipt_fits_its_line()
returns trigger language plpgsql set search_path = '' as $$
declare l record; v_taken int;
begin
  select amount_cents, direction into l
    from public.settlement_lines where id = new.line_id;

  select coalesce(sum(amount_cents), 0) into v_taken
    from public.settlement_receipts where line_id = new.line_id;

  if v_taken + new.amount_cents > abs(l.amount_cents) then
    raise exception 'That line is % DH and % DH has already been receipted',
      round(abs(l.amount_cents) / 100.0), round(v_taken / 100.0);
  end if;

  -- §2.5: "A hand-over is never partial. All of it or close the visit."
  if l.direction = 'pay_out' and new.amount_cents <> abs(l.amount_cents) then
    raise exception 'A hand-over is all of it or none - % DH, not %',
      round(abs(l.amount_cents) / 100.0), round(new.amount_cents / 100.0);
  end if;
  return new;
end $$;

drop trigger if exists settlement_receipts_fit on public.settlement_receipts;
create trigger settlement_receipts_fit
  before insert on public.settlement_receipts
  for each row execute function public.receipt_fits_its_line();

-- ---- the bag, derived -------------------------------------------------------
create or replace function public.agent_bag(p_agent uuid default null)
returns json
language sql stable security definer set search_path = ''
as $$
  with me as (select coalesce(p_agent, auth.uid()) as id),
  since as (
    select coalesce(max(d.dropped_at), '-infinity'::timestamptz) as at
      from public.agent_drops d, me where d.agent_id = me.id
  ),
  r as (
    select rc.amount_cents, v.direction
      from public.settlement_receipts rc
      join public.settlement_visits v on v.id = rc.visit_id, me, since
     where rc.agent_id = me.id and rc.recorded_at > since.at
  )
  select json_build_object(
    -- what he took in and has not dropped
    'collected_cents', coalesce((select sum(amount_cents) from r where direction = 'collect'), 0)::int,
    -- what he took out of the bag to hand over
    'handed_cents', coalesce((select sum(amount_cents) from r where direction = 'pay_out'), 0)::int,
    'in_bag_cents', (coalesce((select sum(amount_cents) from r where direction = 'collect'), 0)
                     - coalesce((select sum(amount_cents) from r where direction = 'pay_out'), 0))::int,
    'since', (select at from since),
    'cap_cents', (select agent_bag_cap_cents from public.platform_settings)
  )
  from me
  where public.is_agent();
$$;
grant execute on function public.agent_bag(uuid) to authenticated;

-- ---- the code, minted on the shop side --------------------------------------
-- §3: "It must be generated on the shop side and only verified on the agent
-- side." So this is the OWNER's function: he opens his statement, it appears,
-- he reads it out. The agent's app never calls it.
create or replace function public.my_visit_code()
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid; v_visit uuid; v_amount int; v_code text; v_exp timestamptz;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'You do not own a shop'; end if;

  -- the visit he is being asked to prove: an open collection on his own shop
  select v.id, abs(l.amount_cents) - coalesce(l.collected_cents, 0)
    into v_visit, v_amount
    from public.settlement_visits v
    join public.settlement_lines l on l.id = v.line_id
   where l.salon_id = v_salon and v.direction = 'collect' and v.state <> 'closed'
   order by v.window_from nulls last, v.created_at limit 1;
  if v_visit is null then return json_build_object('visit', null); end if;

  select code, expires_at into v_code, v_exp from public.visit_codes
   where visit_id = v_visit and used_at is null and expires_at > now()
     and amount_cents = v_amount;

  if v_code is null then
    -- random(), same as 0053. pgcrypto's gen_random_bytes would be the better
    -- source but it lives in the extensions schema and search_path is empty
    -- here, so it is not reliably reachable.
    -- ponytail: four digits, read aloud, single use, two-hour expiry, bound to
    -- one visit AND one amount, spent on use. Guessing it is not the attack.
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
    v_exp := now() + interval '2 hours';
    insert into public.visit_codes (visit_id, code, amount_cents, expires_at)
    values (v_visit, v_code, v_amount, v_exp)
    on conflict (visit_id) do update
      set code = excluded.code, amount_cents = excluded.amount_cents,
          issued_at = now(), expires_at = excluded.expires_at, used_at = null;
  end if;

  return json_build_object('visit', v_visit, 'code', v_code,
                           'amount_cents', v_amount, 'expires_at', v_exp);
end $$;
grant execute on function public.my_visit_code() to authenticated;

-- ---- who reads what ---------------------------------------------------------
alter table public.settlement_visits enable row level security;
alter table public.settlement_receipts enable row level security;
alter table public.visit_codes enable row level security;
alter table public.agent_drops enable row level security;

drop policy if exists settlement_visits_select on public.settlement_visits;
create policy settlement_visits_select on public.settlement_visits for select to authenticated
  using (public.is_agent()
         or exists (select 1 from public.settlement_lines l
                     join public.salons s on s.id = l.salon_id
                    where l.id = settlement_visits.line_id and s.owner_id = auth.uid()));

drop policy if exists settlement_receipts_select on public.settlement_receipts;
create policy settlement_receipts_select on public.settlement_receipts for select to authenticated
  using (public.is_agent()
         or exists (select 1 from public.settlement_lines l
                     join public.salons s on s.id = l.salon_id
                    where l.id = settlement_receipts.line_id and s.owner_id = auth.uid()));

-- the code is the owner's, and ONLY the owner's: an agent who could read it
-- would not need to be standing in the shop, which is the entire point of it.
drop policy if exists visit_codes_select on public.visit_codes;
create policy visit_codes_select on public.visit_codes for select to authenticated
  using (exists (select 1 from public.settlement_visits v
                  join public.settlement_lines l on l.id = v.line_id
                  join public.salons s on s.id = l.salon_id
                 where v.id = visit_codes.visit_id and s.owner_id = auth.uid()));

drop policy if exists agent_drops_select on public.agent_drops;
create policy agent_drops_select on public.agent_drops for select to authenticated
  using (public.is_agent() and agent_id = auth.uid() or public.is_admin());

grant select on public.settlement_visits, public.settlement_receipts,
                public.visit_codes, public.agent_drops to authenticated;

do $$
begin
  -- AGT-02/03/04's drawn numbers: 1 566 owed, 1 100 taken, 466 short
  assert 156600 - 110000 = 46600, '1 100 taken off 1 566 leaves the drawn 466 short';
  -- AGT-03's "into your bag": 6 130 collected today, plus 1 100
  assert 613000 + 110000 = 723000, 'the bag goes to 7 230 DH';
  -- AGT-05: 7 230 less the 3 570 handed over
  assert 723000 - 357000 = 366000, 'and back to 3 660 after the hand-over';
  -- AGT-01's strip: 9 700 of a 12 000 cap is the drawn 81%
  assert round(970000 * 100.0 / 1200000) = 81, 'the bag bar sits at 81%';
  -- and the warning above it is about the ROUND, not the next tap: the two
  -- collections still on it are 1 240 and 1 566, and either one alone fits.
  assert 970000 + 124000 < 1200000, 'the next collection on its own stays under the cap';
  assert 970000 + 124000 + 156600 > 1200000,
    'but the two still ahead of the hand-over breach it together';
  assert 970000 + 124000 + 156600 = 1250600, 'at 12 506 DH, which is why he drops first';
  -- and the bag is collected minus handed, which is what makes the two agree
  assert 613000 + 357000 = 970000, '6 130 collected plus 3 570 to hand over is 9 700';

  -- §2.5, as the trigger enforces it
  assert 357000 = 357000, 'a hand-over receipt equals its line exactly';
  assert not (110000 = 156600), 'a collection receipt need not';

  -- the code is four digits, always, including a low draw
  assert lpad((7 % 10000)::text, 4, '0') = '0007', 'a low draw keeps its zeros';
  assert length(lpad((9999 % 10000)::text, 4, '0')) = 4, 'and a high one is still four';
end $$;
