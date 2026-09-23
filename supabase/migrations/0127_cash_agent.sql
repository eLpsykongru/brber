-- 0127_cash_agent: who holds the shop's cash, pays the chairs, and hands it on.
-- `design_handoff_billing_rail/` README §7 steps 6–9 — OBR-07…09, BAC-09/10,
-- FIN-18 — and ADDENDUM §9 "Who pays a barber who is owed" and its five rules.
--
-- Sterncut settles with the SHOP (the Friday lines, 0084…0123). The shop settles
-- with its barbers, in the shop, in cash, out of one drawer held by one person:
-- the cash agent the owner appoints — himself by default (0025's
-- `salons.cash_agent_id`, which until now was a flag that moved no cash).
--
-- ---- the drawer, as arithmetic ------------------------------------------------
--
-- Nothing here counts cash. What the drawer SHOULD hold follows from rows that
-- already exist:
--
--     drawer = what the shop owes Sterncut (salon_net_cents, 0044/0123)
--            + what the shop owes each of its barbers (their "due")
--
-- A top-up puts cash in and raises the first term. A cleared deposit raises what
-- Sterncut owes the shop (lowers the first) and what the shop owes that barber
-- (raises the second): no cash moved, and the sum does not move. A Friday
-- collection takes the first term out in cash; a payout takes a barber's due out
-- in cash. Every figure the agent sees is one of those two terms.
--
-- A barber's due is his cleared column (0125's `barber_ledger`, held_for_him)
-- since the shop's `payouts_from`, less what the drawer has paid him
-- (`drawer_entries`). For the OWNER it is also less the subscription netted off
-- the Friday (0123): the bill comes out of the deposits in the drawer, and it is
-- his bill, so it comes off his share and never a barber's.
--
-- `payouts_from` is the shop's last settled week (0125's window) for every shop
-- that exists today: before this file the owner held everything, so what was
-- settled before is settled between them. A new shop starts from its first row.
--
-- ---- the five rules (§9), and where each is enforced ---------------------------
--
-- 1. The payee's code, not the payer's. `agent_pay` takes the RECEIVING barber's
--    four digits (`my_payout_code`, minted on his phone). Five wrong tries spend
--    the code and tell him. Paying himself is the agent's own row and needs no
--    code: the code proves the cash reached somebody else's hand.
-- 2. The agent cannot edit the figure. `agent_pay` refuses more than the due and
--    more than the drawer; less is "pay part" and the rest stays on his column.
-- 3. Two hats, two balances. `my_drawer` (the shop's cash, BAC-10) and
--    `my_account` (his own) are separate reads; his own due is a separate row.
-- 4. Least privilege. `my_drawer` returns, per colleague, a name, a chair and a
--    figure — never a client, a price, a booking or a total taken.
-- 5. Revocation is a handover, not a flag. `set_cash_agent` moves the role only
--    when the drawer is empty and nobody is owed; otherwise OBR-08's two routes:
--    settle with the collection agent first, or `start_drawer_transfer` and the
--    successor counts it in on his own phone (`confirm_drawer_transfer`). A count
--    that disagrees leaves the role where it is, stops top-ups, and pages ops
--    (FIN-18). 0025's `salon_remove_member`, which handed the role back to the
--    owner as a flag, now refuses to remove the agent or a barber the drawer owes.
--
-- ---- FIN-18's open question, answered only as far as the rows allow ------------
--
-- README §8.1: "a barber-level shortfall has no home" in Sterncut's books. It does
-- not need one there: Sterncut's figure with the shop never changes when cash goes
-- missing inside it. The gap is a debt to the SHOP's drawer, so it is recorded as
-- a `handover_gap` entry on the outgoing agent's due — exactly as if he had taken
-- that cash out — and the new agent is only ever answerable for what he counted.
-- Writing it off (Sterncut absorbing it) is still finance's decision: not built.

-- ---- 1 · the shop's side ------------------------------------------------------
alter table public.salons
  add column if not exists payouts_from timestamptz,
  add column if not exists cash_agent_since timestamptz default now();

update public.salons s
   set payouts_from = coalesce(public.barber_account_since(s.id), '-infinity'::timestamptz)
 where s.payouts_from is null;
alter table public.salons alter column payouts_from set default '-infinity'::timestamptz;
alter table public.salons alter column payouts_from set not null;
update public.salons set cash_agent_since = coalesce(reviewed_at, created_at) where cash_agent_since is null;

-- ---- 2 · what the drawer has paid, and to whom ---------------------------------
-- One signed ledger, in the direction of the barber's due: + the drawer paid him
-- (or, for a handover gap, he is answerable for cash as if he had taken it), − he
-- put cash in. Person columns carry no foreign key on purpose: a ledger outlives
-- the people on it, and 0075's rule holds here — a correction is a new row.
create table if not exists public.drawer_entries (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete restrict,
  barber_id uuid not null,
  agent_id uuid,
  kind text not null check (kind in ('payout', 'received', 'handover_gap')),
  amount_cents int not null check (amount_cents <> 0),
  proof text not null check (proof in ('payee_code', 'self', 'agent_received', 'ops_record')),
  transfer_id uuid,
  idem_key text unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint drawer_entry_sign check (
    (kind = 'payout' and amount_cents > 0) or (kind = 'received' and amount_cents < 0)
    or kind = 'handover_gap'),
  constraint drawer_entry_proof check (
    (kind = 'payout' and proof in ('payee_code', 'self'))
    or (kind = 'received' and proof = 'agent_received')
    or (kind = 'handover_gap' and proof = 'ops_record' and transfer_id is not null))
);
create index if not exists drawer_entries_salon_idx on public.drawer_entries (salon_id, barber_id);
alter table public.drawer_entries enable row level security;
revoke all on public.drawer_entries from anon, authenticated;

create or replace function public.drawer_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'drawer_entries is append-only — correct with a new entry';
end $$;
drop trigger if exists drawer_entries_no_edit on public.drawer_entries;
create trigger drawer_entries_no_edit before update or delete on public.drawer_entries
  for each row execute function public.drawer_is_append_only();

-- the payee's four digits (rule 1). Its own table: `barbers` is read by anyone.
create table if not exists public.payout_codes (
  barber_id uuid primary key,
  salon_id uuid not null references public.salons (id) on delete cascade,
  code text not null,
  issued_at timestamptz not null default now(),
  fails int not null default 0
);
alter table public.payout_codes enable row level security;
revoke all on public.payout_codes from anon, authenticated;

-- OBR-08 route 2, OBR-09, FIN-18
create sequence if not exists public.drawer_transfer_ref_seq start 100;
create table if not exists public.drawer_transfers (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('TRF-' || nextval('public.drawer_transfer_ref_seq')),
  salon_id uuid not null references public.salons (id) on delete restrict,
  from_id uuid not null,
  to_id uuid not null,
  state text not null default 'pending'
    check (state in ('pending', 'done', 'mismatch', 'resolved', 'cancelled')),
  started_cents int not null,          -- the drawer when the owner started it
  declared_cents int,                  -- the drawer at the moment the successor counted: what the outgoing hands over
  counted_cents int,                   -- what the successor typed
  dues jsonb,                          -- who was owed what then: the rows that move with the role
  created_by uuid not null,
  created_at timestamptz not null default now(),
  counted_at timestamptz,
  count_requested_at timestamptz,      -- FIN-18 "send the collection agent to count it"
  count_requested_by uuid,
  agreed_cents int,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  closed_at timestamptz,
  constraint drawer_transfer_people check (from_id <> to_id),
  constraint drawer_transfer_counted check ((state in ('pending', 'cancelled')) or counted_cents is not null)
);
create unique index if not exists drawer_transfers_open
  on public.drawer_transfers (salon_id) where state in ('pending', 'mismatch');
alter table public.drawer_transfers enable row level security;
revoke all on public.drawer_transfers from anon, authenticated;

-- a closed transfer is history
create or replace function public.drawer_transfer_guard()
returns trigger language plpgsql as $$
begin
  if old.state in ('done', 'resolved', 'cancelled') then
    raise exception 'drawer transfer % is closed', old.ref;
  end if;
  if old.counted_cents is not null and (new.counted_cents is distinct from old.counted_cents
      or new.declared_cents is distinct from old.declared_cents) then
    raise exception 'the two counts on % are fixed once made', old.ref;
  end if;
  return new;
end $$;
drop trigger if exists drawer_transfers_guard on public.drawer_transfers;
create trigger drawer_transfers_guard before update on public.drawer_transfers
  for each row execute function public.drawer_transfer_guard();
drop trigger if exists drawer_transfers_no_delete on public.drawer_transfers;
create trigger drawer_transfers_no_delete before delete on public.drawer_transfers
  for each row execute function public.drawer_is_append_only();

-- ---- 3 · the arithmetic ---------------------------------------------------------
create or replace function public.till_of(p_salon uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce(s.cash_agent_id, s.owner_id) from public.salons s where s.id = p_salon;
$$;

-- the shop whose drawer the caller holds
create or replace function public.my_till_salon()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id from public.salons s where coalesce(s.cash_agent_id, s.owner_id) = auth.uid() limit 1;
$$;

-- the shop whose cash the caller may read: its owner, or its agent
create or replace function public.my_cash_salon()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id from public.salons s
   where s.owner_id = auth.uid() or coalesce(s.cash_agent_id, s.owner_id) = auth.uid()
   order by (s.owner_id = auth.uid()) desc limit 1;
$$;

create or replace function public.drawer_due_cents(p_salon uuid, p_barber uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select (
    coalesce((select sum(x.amount_cents) from public.barber_ledger x
               where x.direction = 'held_for_him' and x.salon_id = s.id and x.barber_id = p_barber
                 and x.cleared_at > s.payouts_from), 0)
    - coalesce((select sum(e.amount_cents) from public.drawer_entries e
                 where e.salon_id = s.id and e.barber_id = p_barber), 0)
    -- the owner's bill, netted off the Friday: his share, never a barber's
    - case when p_barber = s.owner_id then coalesce((
        select sum(a.amount_cents) from public.subscription_applications a
          join public.settlement_lines l on l.id = a.line_id
         where l.salon_id = s.id and a.method = 'netted' and a.applied_at > s.payouts_from), 0)
      else 0 end
  )::int
  from public.salons s where s.id = p_salon;
$$;

-- everyone the drawer may owe: the team, the owner, and anyone with a row
create or replace function public.drawer_dues(p_salon uuid)
returns table (barber_id uuid, due_cents int)
language sql stable security definer set search_path = ''
as $$
  select m.id, public.drawer_due_cents(p_salon, m.id)
    from (select b.id from public.barbers b where b.salon_id = p_salon and b.salon_status = 'approved'
          union select s.owner_id from public.salons s where s.id = p_salon
          union select x.barber_id from public.barber_ledger x
                  join public.salons s on s.id = x.salon_id
                 where x.salon_id = p_salon and x.direction = 'held_for_him'
                   and x.cleared_at > s.payouts_from
          union select e.barber_id from public.drawer_entries e where e.salon_id = p_salon) m;
$$;

create or replace function public.drawer_cents(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select (public.salon_net_cents(p_salon)
          + coalesce((select sum(d.due_cents) from public.drawer_dues(p_salon) d), 0))::int;
$$;

-- "the drawer is empty and nobody is owed" — the only state the role moves in by itself
create or replace function public.drawer_clear(p_salon uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.drawer_cents(p_salon) = 0
     and not exists (select 1 from public.drawer_dues(p_salon) d where d.due_cents <> 0);
$$;

-- a name for a person, in every read below
create or replace function public.person_name(p_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.full_name from public.profiles p where p.id = p_id), 'A barber');
$$;

-- ---- 4 · the till's functions, now the agent's -----------------------------------
-- 0075's body verbatim but for WHO: the shop's cash agent takes top-ups, and nobody
-- does while the drawer is changing hands.
create or replace function public.agent_cash_topup(
  customer_phone text, topup_cents int, p_idem text default null)
returns table (tx_id uuid, customer_name text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_customer uuid;
  v_name text;
  v_cap int;
  v_net int;
  v_id uuid;
  v_state text;
  v_digits text := right(regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g'), 9);
begin
  if p_idem is not null then
    select w.id, coalesce(p.full_name, 'Client') into v_id, v_name
      from public.wallet_transactions w
      join public.profiles p on p.id = w.user_id
     where w.idem_key = p_idem;
    if found then
      tx_id := v_id; customer_name := v_name; return next; return;
    end if;
  end if;

  select s.id, s.float_cap_cents into v_salon, v_cap
    from public.salons s where coalesce(s.cash_agent_id, s.owner_id) = auth.uid() limit 1;
  if v_salon is null then
    raise exception 'Only the shop''s cash agent can take cash top-ups';
  end if;
  select t.state into v_state from public.drawer_transfers t
   where t.salon_id = v_salon and t.state in ('pending', 'mismatch');
  if v_state = 'pending' then
    raise exception 'The drawer is changing hands — no top-ups until the new agent has counted it';
  elsif v_state = 'mismatch' then
    raise exception 'Sterncut is sorting out the drawer handover — no top-ups until it is settled';
  end if;
  if topup_cents is null or topup_cents <= 0 then
    raise exception 'Amount must be more than zero';
  end if;

  v_net := public.salon_net_cents(v_salon);
  if v_net + topup_cents > v_cap then
    raise exception 'This would put % DH of ours in your till — the limit is % DH. Settle up first.',
      ((v_net + topup_cents) / 100.0)::numeric(12,2), (v_cap / 100.0)::numeric(12,2);
  end if;

  if length(v_digits) < 9 then
    raise exception 'Enter the customer''s full phone number';
  end if;
  begin
    select p.id, coalesce(p.full_name, 'Client') into strict v_customer, v_name
    from public.profiles p
    where right(regexp_replace(p.phone, '\D', '', 'g'), 9) = v_digits;
  exception
    when no_data_found then raise exception 'No brber account with that phone';
    when too_many_rows then raise exception 'That phone matches more than one account';
  end;

  return query
    insert into public.wallet_transactions
      (user_id, salon_id, created_by, amount_cents, idem_key)
    values (v_customer, v_salon, auth.uid(), topup_cents, p_idem)
    returning id, v_name;
end;
$$;

-- 0082's body; the owner still reads his shop's float, the agent reads the drawer he holds
create or replace function public.my_float()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_salon uuid;
  j json;
begin
  v_salon := public.my_cash_salon();
  if v_salon is null then return json_build_object('salon', null); end if;

  select json_build_object(
    'salon', v_salon,
    'till', public.till_of(v_salon) = auth.uid(),
    'float_cents', public.salon_float_cents(v_salon),
    'owed_cents', public.salon_owed_cents(v_salon),
    'net_cents', public.salon_net_cents(v_salon),
    'cap_cents', (select float_cap_cents from public.salons where id = v_salon),
    'code', (select handover_code from public.salons where id = v_salon),
    'topups', public.salon_uncollected_topups(v_salon),
    'held_days', public.salon_float_age_days(v_salon),
    'hold_limit_days', (select float_hold_days from public.platform_settings)
  ) into j;
  return j;
end;
$$;

create or replace function public.float_handover_code()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_code text;
  v_at timestamptz;
begin
  v_salon := public.my_cash_salon();
  if v_salon is null then raise exception 'You do not hold a shop''s cash'; end if;
  select s.handover_code, s.handover_code_at into v_code, v_at from public.salons s where s.id = v_salon;

  if v_code is null or v_at is null or v_at < now() - interval '12 hours' then
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
    update public.salons set handover_code = v_code, handover_code_at = now()
     where id = v_salon;
  end if;
  return v_code;
end;
$$;

create or replace function public.request_float_collection()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
begin
  v_salon := public.my_cash_salon();
  if v_salon is null then raise exception 'You do not hold a shop''s cash'; end if;
  update public.salons set collection_requested_at = now()
   where id = v_salon and collection_requested_at is null;
end;
$$;

-- 0090's body: the code the collection agent types is shown to whoever hands the cash over
create or replace function public.my_visit_code()
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid; v_visit uuid; v_amount int; v_code text; v_exp timestamptz;
begin
  v_salon := public.my_cash_salon();
  if v_salon is null then raise exception 'You do not hold a shop''s cash'; end if;

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

-- 0094's body, for the owner or the agent
create or replace function public.my_visit_status()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_salon uuid; j json;
begin
  v_salon := public.my_cash_salon();
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

-- ---- 5 · the owner: OBR-07 appoint, OBR-08 blocked ---------------------------------
-- The one place the role moves by itself: an empty drawer and nobody owed.
create or replace function public.appoint_till(p_salon uuid, p_barber uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_old uuid; v_owner uuid; v_drawer int;
begin
  select coalesce(s.cash_agent_id, s.owner_id), s.owner_id into v_old, v_owner
    from public.salons s where s.id = p_salon for update;
  if p_barber is distinct from v_owner and not exists (
       select 1 from public.barbers b
        where b.id = p_barber and b.salon_id = p_salon and b.salon_status = 'approved') then
    raise exception 'The cash agent must be one of your approved barbers, or you';
  end if;
  if p_barber = v_old then return json_build_object('state', 'same'); end if;
  if exists (select 1 from public.drawer_transfers t
              where t.salon_id = p_salon and t.state in ('pending', 'mismatch')) then
    raise exception 'A handover of the drawer is already under way';
  end if;

  v_drawer := public.drawer_cents(p_salon);
  if not public.drawer_clear(p_salon) then
    return json_build_object('state', 'blocked', 'drawer_cents', v_drawer,
      'dues', (select coalesce(json_agg(json_build_object(
                  'barber', d.barber_id, 'name', public.person_name(d.barber_id), 'cents', d.due_cents,
                  'is_agent', d.barber_id = v_old) order by d.due_cents desc), '[]'::json)
                 from public.drawer_dues(p_salon) d where d.due_cents <> 0));
  end if;

  update public.salons set cash_agent_id = p_barber, cash_agent_since = now() where id = p_salon;
  insert into public.notifications (user_id, kind, title, body)
  values (p_barber, 'shop_status', 'You hold the shop''s cash',
          'From now on you take the cash top-ups and pay the chairs what the shop owes them.');
  if v_old <> v_owner then
    insert into public.notifications (user_id, kind, title, body)
    values (v_old, 'shop_status', 'You no longer hold the shop''s cash',
            'The drawer was empty and nobody was owed, so the role moved with nothing to hand over.');
  end if;
  return json_build_object('state', 'done');
end $$;

create or replace function public.set_cash_agent(p_barber uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the shop''s owner appoints its cash agent'; end if;
  return public.appoint_till(v_salon, p_barber);
end $$;

-- 0025's call, kept for builds that still send it: the same gate, as a refusal
create or replace function public.salon_set_cash_agent(p_barber uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid; v_owner uuid; r json;
begin
  select s.id, s.owner_id into v_salon, v_owner from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can set the cash agent'; end if;
  r := public.appoint_till(v_salon, coalesce(p_barber, v_owner));
  if r->>'state' = 'blocked' then
    raise exception 'The drawer holds % DH and people are owed from it. Open "Who holds the cash" to hand it over.',
      round((r->>'drawer_cents')::int / 100.0);
  end if;
end $$;

-- OBR-07 and OBR-08 in one read
create or replace function public.cash_agent_state()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare s record; v_till uuid; t record;
begin
  select * into s from public.salons where owner_id = auth.uid() limit 1;
  if s.id is null then return json_build_object('salon', null); end if;
  v_till := coalesce(s.cash_agent_id, s.owner_id);
  select * into t from public.drawer_transfers
   where salon_id = s.id and state in ('pending', 'mismatch');

  return json_build_object(
    'salon', s.id,
    'agent', json_build_object('id', v_till, 'name', public.person_name(v_till),
                               'is_me', v_till = s.owner_id, 'since', s.cash_agent_since),
    'drawer_cents', public.drawer_cents(s.id),
    'clear', public.drawer_clear(s.id),
    'dues', (select coalesce(json_agg(json_build_object(
               'barber', d.barber_id, 'name', public.person_name(d.barber_id), 'cents', d.due_cents,
               'is_agent', d.barber_id = v_till) order by d.due_cents desc), '[]'::json)
               from public.drawer_dues(s.id) d where d.due_cents <> 0),
    'candidates', (select coalesce(json_agg(json_build_object(
               'id', b.id, 'name', public.person_name(b.id), 'chair', b.chair_label,
               'role', b.salon_role, 'is_owner', b.id = s.owner_id,
               -- "Manages the shop · doesn't cut": the shop page's own rule (0123)
               'cuts', public.on_shop_page(b) and b.accepting_bookings)
               order by (b.id = s.owner_id) desc, b.chair_label nulls last), '[]'::json)
               from public.barbers b
              where b.salon_id = s.id and b.salon_status = 'approved' and b.id <> v_till),
    'transfer', case when t.id is null then null else json_build_object(
               'id', t.id, 'ref', t.ref, 'state', t.state,
               'to', t.to_id, 'to_name', public.person_name(t.to_id),
               'from_name', public.person_name(t.from_id),
               'started_cents', t.started_cents, 'declared_cents', t.declared_cents,
               'counted_cents', t.counted_cents, 'at', t.created_at, 'counted_at', t.counted_at) end,
    -- the last handover that came up short, until the man it is on has paid it back
    'gaps', (select coalesce(json_agg(json_build_object(
               'barber', e.barber_id, 'name', public.person_name(e.barber_id),
               'cents', e.amount_cents, 'at', e.created_at,
               'owes_cents', greatest(-public.drawer_due_cents(s.id, e.barber_id), 0))), '[]'::json)
               from public.drawer_entries e
              where e.salon_id = s.id and e.kind = 'handover_gap'
                and public.drawer_due_cents(s.id, e.barber_id) < 0)
  );
end $$;

-- OBR-08 route 2: "count it into his hands"
create or replace function public.start_drawer_transfer(p_barber uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid; v_owner uuid; v_till uuid; v_id uuid; v_ref text; v_drawer int;
begin
  select s.id, s.owner_id, coalesce(s.cash_agent_id, s.owner_id) into v_salon, v_owner, v_till
    from public.salons s where s.owner_id = auth.uid() limit 1 for update;
  if v_salon is null then raise exception 'Only the shop''s owner hands the drawer on'; end if;
  if p_barber = v_till then raise exception 'He already holds it'; end if;
  if p_barber <> v_owner and not exists (
       select 1 from public.barbers b
        where b.id = p_barber and b.salon_id = v_salon and b.salon_status = 'approved') then
    raise exception 'The cash agent must be one of your approved barbers, or you';
  end if;
  if exists (select 1 from public.drawer_transfers t
              where t.salon_id = v_salon and t.state in ('pending', 'mismatch')) then
    raise exception 'A handover of the drawer is already under way';
  end if;
  -- nothing attached: nothing to count, the role just moves
  if public.drawer_clear(v_salon) then return public.appoint_till(v_salon, p_barber); end if;

  v_drawer := public.drawer_cents(v_salon);
  insert into public.drawer_transfers (salon_id, from_id, to_id, started_cents, created_by)
  values (v_salon, v_till, p_barber, v_drawer, auth.uid())
  returning id, ref into v_id, v_ref;

  insert into public.notifications (user_id, kind, title, body, amount_cents)
  values (p_barber, 'shop_status', 'You are taking the shop''s cash',
          public.person_name(v_till) || ' is counting ' || round(v_drawer / 100.0) || ' DH into your hands. '
          || 'Count it yourself, then confirm it on your phone.', v_drawer);
  if v_till <> v_owner then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (v_till, 'shop_status', 'Hand the drawer to ' || public.person_name(p_barber),
            'Count ' || round(v_drawer / 100.0) || ' DH into his hands. Until he confirms, you still pay the chairs.',
            v_drawer);
  end if;
  return json_build_object('state', 'pending', 'id', v_id, 'ref', v_ref, 'drawer_cents', v_drawer);
end $$;

-- the owner changes his mind, or the successor says "not me"
create or replace function public.cancel_drawer_transfer()
returns void
language plpgsql security definer set search_path = ''
as $$
declare t record;
begin
  select tr.* into t from public.drawer_transfers tr
    join public.salons s on s.id = tr.salon_id
   where tr.state = 'pending'
     and (s.owner_id = auth.uid() or tr.to_id = auth.uid() or tr.from_id = auth.uid())
   limit 1;
  if t.id is null then raise exception 'No handover is waiting'; end if;
  update public.drawer_transfers set state = 'cancelled', closed_at = now() where id = t.id;
end $$;

-- ---- 6 · the barber's side: BAC-09, BAC-10, OBR-09 ---------------------------------
-- BAC-09: the four digits he reads out once the cash is in his hand. Minted here,
-- on his phone, and spent on use; twelve hours at most.
create or replace function public.my_payout_code()
returns json
language plpgsql security definer set search_path = ''
as $$
declare me record; v_due int; c record; v_till uuid;
begin
  select b.id, b.salon_id into me from public.barbers b
   where b.id = auth.uid() and b.salon_status = 'approved';
  if me.id is null then return json_build_object('code', null); end if;
  v_till := public.till_of(me.salon_id);
  v_due := public.drawer_due_cents(me.salon_id, me.id);
  -- the agent pays himself from his own row; a code proves nothing there
  if v_due <= 0 or v_till = me.id then
    return json_build_object('code', null, 'due_cents', v_due);
  end if;

  select * into c from public.payout_codes where barber_id = me.id;
  if c.code is null or c.salon_id <> me.salon_id or c.issued_at < now() - interval '12 hours' then
    insert into public.payout_codes (barber_id, salon_id, code, issued_at, fails)
    values (me.id, me.salon_id, lpad((floor(random() * 10000))::int::text, 4, '0'), now(), 0)
    on conflict (barber_id) do update
      set salon_id = excluded.salon_id, code = excluded.code, issued_at = now(), fails = 0;
    select * into c from public.payout_codes where barber_id = me.id;
  end if;
  return json_build_object('code', c.code, 'due_cents', v_due,
                           'expires_at', c.issued_at + interval '12 hours',
                           'agent', public.person_name(v_till));
end $$;

-- BAC-10: the shop's cash, for the one holding it
create or replace function public.my_drawer()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_salon uuid; v_net int;
begin
  v_salon := public.my_till_salon();
  if v_salon is null then return json_build_object('salon', null); end if;
  v_net := public.salon_net_cents(v_salon);
  return json_build_object(
    'salon', v_salon,
    'me', auth.uid(),
    'drawer_cents', public.drawer_cents(v_salon),
    -- + the shop hands this to Sterncut; − Sterncut hands it to the shop
    'sterncut_cents', v_net,
    'to_pay_cents', (select coalesce(sum(d.due_cents), 0) from public.drawer_dues(v_salon) d
                      where d.due_cents > 0 and d.barber_id <> auth.uid()),
    'my_due_cents', public.drawer_due_cents(v_salon, auth.uid()),
    -- rule 4: a name, a chair, a figure. Nothing behind it.
    'chairs', (select coalesce(json_agg(json_build_object(
                 'barber', d.barber_id, 'name', public.person_name(d.barber_id),
                 'chair', (select b.chair_label from public.barbers b where b.id = d.barber_id),
                 'due_cents', d.due_cents,
                 'last_paid', (select json_build_object('cents', e.amount_cents, 'at', e.created_at)
                                 from public.drawer_entries e
                                where e.salon_id = v_salon and e.barber_id = d.barber_id and e.kind = 'payout'
                                order by e.created_at desc limit 1))
                 order by d.due_cents desc), '[]'::json)
                 from public.drawer_dues(v_salon) d
                where d.barber_id <> auth.uid()
                  and (d.due_cents <> 0 or exists (
                        select 1 from public.drawer_entries e
                         where e.salon_id = v_salon and e.barber_id = d.barber_id
                           and e.created_at > now() - interval '7 days'))),
    'transfer', (select json_build_object('ref', t.ref, 'state', t.state, 'to_name', public.person_name(t.to_id))
                   from public.drawer_transfers t
                  where t.salon_id = v_salon and t.state in ('pending', 'mismatch'))
  );
end $$;

-- rule 1 and rule 2. Returns {ok:false} on a wrong code rather than raising, so the
-- count of wrong tries survives the call.
create or replace function public.agent_pay(p_barber uuid, p_cents int, p_code text default null, p_idem text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid; v_due int; v_drawer int; c record; e record; v_self boolean;
begin
  if p_idem is not null then
    select * into e from public.drawer_entries where idem_key = p_idem;
    if e.id is not null then
      return json_build_object('ok', true, 'replay', true, 'cents', e.amount_cents);
    end if;
  end if;

  v_salon := public.my_till_salon();
  if v_salon is null then raise exception 'Only the shop''s cash agent pays the chairs'; end if;
  if p_cents is null or p_cents <= 0 then raise exception 'Amount must be more than zero'; end if;
  v_self := p_barber = auth.uid();
  v_due := public.drawer_due_cents(v_salon, p_barber);
  if v_due <= 0 then raise exception 'The shop owes him nothing right now'; end if;
  if p_cents > v_due then
    raise exception 'The shop owes % DH — you can''t pay more than that', round(v_due / 100.0);
  end if;
  v_drawer := public.drawer_cents(v_salon);
  if p_cents > v_drawer then
    raise exception 'The drawer only holds % DH — pay part, the rest stays on his column',
      round(greatest(v_drawer, 0) / 100.0);
  end if;

  if not v_self then
    select * into c from public.payout_codes where barber_id = p_barber for update;
    if c.code is null or c.salon_id <> v_salon or c.issued_at < now() - interval '12 hours' then
      return json_build_object('ok', false, 'reason', 'no_code');
    end if;
    if c.code is distinct from p_code then
      if c.fails + 1 >= 5 then
        -- spent: he opens the app for a new one, and is told why
        delete from public.payout_codes where barber_id = p_barber;
        insert into public.notifications (user_id, kind, title, body)
        values (p_barber, 'shop_status', 'Your payout code was typed wrong five times',
                'It no longer works. Open "You & Sterncut" for a new one, and only read it out once the cash is in your hand.');
        return json_build_object('ok', false, 'reason', 'spent');
      end if;
      update public.payout_codes set fails = fails + 1 where barber_id = p_barber;
      return json_build_object('ok', false, 'reason', 'code', 'left', 4 - c.fails);
    end if;
    delete from public.payout_codes where barber_id = p_barber;
  end if;

  insert into public.drawer_entries (salon_id, barber_id, agent_id, kind, amount_cents, proof, idem_key, created_by)
  values (v_salon, p_barber, auth.uid(), 'payout', p_cents,
          case when v_self then 'self' else 'payee_code' end, p_idem, auth.uid());
  if not v_self then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (p_barber, 'shop_status', 'Paid in the shop',
            public.person_name(auth.uid()) || ' paid you ' || round(p_cents / 100.0) || ' DH from the drawer.'
            || case when v_due > p_cents
                    then ' The shop still owes you ' || round((v_due - p_cents) / 100.0) || ' DH.' else '' end,
            p_cents);
  end if;
  return json_build_object('ok', true, 'cents', p_cents, 'left_cents', v_due - p_cents);
end $$;

-- the other direction: a barber who owes the drawer (a deposit handed back after he
-- was paid, the owner's bill, a handover gap) puts cash in. The agent is the one
-- receiving, so his word is the receipt — the same rule, pointed the other way.
create or replace function public.agent_receive(p_barber uuid, p_cents int)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid; v_due int;
begin
  v_salon := public.my_till_salon();
  if v_salon is null then raise exception 'Only the shop''s cash agent takes cash into the drawer'; end if;
  if p_cents is null or p_cents <= 0 then raise exception 'Amount must be more than zero'; end if;
  v_due := public.drawer_due_cents(v_salon, p_barber);
  if v_due >= 0 then raise exception 'He owes the drawer nothing'; end if;
  if p_cents > -v_due then
    raise exception 'He owes the drawer % DH — not more', round(-v_due / 100.0);
  end if;
  insert into public.drawer_entries (salon_id, barber_id, agent_id, kind, amount_cents, proof, created_by)
  values (v_salon, p_barber, auth.uid(), 'received', -p_cents, 'agent_received', auth.uid());
  if p_barber <> auth.uid() then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (p_barber, 'shop_status', 'Put in the drawer',
            public.person_name(auth.uid()) || ' took ' || round(p_cents / 100.0) || ' DH from you into the shop''s drawer.',
            p_cents);
  end if;
  return json_build_object('ok', true, 'left_cents', v_due + p_cents);
end $$;

-- OBR-09, and the outgoing agent's side of it
create or replace function public.my_drawer_transfer()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare t record;
begin
  select * into t from public.drawer_transfers
   where state in ('pending', 'mismatch') and (to_id = auth.uid() or from_id = auth.uid())
   order by created_at desc limit 1;
  if t.id is null then return null; end if;
  return json_build_object(
    'id', t.id, 'ref', t.ref, 'state', t.state,
    'role', case when t.to_id = auth.uid() then 'incoming' else 'outgoing' end,
    'from_name', public.person_name(t.from_id), 'to_name', public.person_name(t.to_id),
    'drawer_cents', public.drawer_cents(t.salon_id),
    'declared_cents', t.declared_cents, 'counted_cents', t.counted_cents,
    -- what moves with the role: who is owed, including him
    'dues', (select coalesce(json_agg(json_build_object(
               'name', public.person_name(d.barber_id), 'cents', d.due_cents,
               'is_me', d.barber_id = auth.uid()) order by (d.barber_id = auth.uid()), d.due_cents desc), '[]'::json)
               from public.drawer_dues(t.salon_id) d where d.due_cents <> 0 and d.barber_id <> t.from_id),
    'at', t.created_at);
end $$;

-- OBR-09's button. p_expected is the figure his screen showed: a payout made while
-- he was counting changes the drawer, and that is a recount, not a mismatch.
create or replace function public.confirm_drawer_transfer(p_transfer uuid, p_counted int, p_expected int)
returns json
language plpgsql security definer set search_path = ''
as $$
declare t record; v_books int; v_dues jsonb; v_owner uuid;
begin
  select * into t from public.drawer_transfers where id = p_transfer for update;
  if t.id is null or t.to_id <> auth.uid() then raise exception 'That handover is not yours to confirm'; end if;
  if t.state <> 'pending' then raise exception 'That handover is no longer waiting'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Type what you counted'; end if;
  v_books := public.drawer_cents(t.salon_id);
  if p_expected is distinct from v_books then
    raise exception 'The drawer changed while you were counting — it should now hold % DH. Count it again.',
      round(v_books / 100.0);
  end if;
  select owner_id into v_owner from public.salons where id = t.salon_id;
  select coalesce(jsonb_agg(jsonb_build_object('barber', d.barber_id, 'cents', d.due_cents)), '[]'::jsonb)
    into v_dues from public.drawer_dues(t.salon_id) d where d.due_cents <> 0;

  if p_counted = v_books then
    update public.drawer_transfers
       set state = 'done', declared_cents = v_books, counted_cents = p_counted, dues = v_dues,
           counted_at = now(), closed_at = now()
     where id = t.id;
    update public.salons set cash_agent_id = t.to_id, cash_agent_since = now() where id = t.salon_id;
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    select distinct u, 'shop_status'::public.notif_kind, 'The drawer changed hands',
           public.person_name(t.to_id) || ' counted ' || round(p_counted / 100.0) || ' DH and now holds the shop''s cash.',
           p_counted
      from unnest(array[t.from_id, v_owner]) u where u <> t.to_id;
    return json_build_object('state', 'done');
  end if;

  -- two claims and no way to choose between them from here: the role stays where
  -- it is, top-ups stop, and a person at Sterncut rings them both (FIN-18)
  update public.drawer_transfers
     set state = 'mismatch', declared_cents = v_books, counted_cents = p_counted, dues = v_dues,
         counted_at = now()
   where id = t.id;
  insert into public.notifications (user_id, kind, title, body, amount_cents)
  select distinct u, 'shop_status'::public.notif_kind, 'The drawer count did not match',
         public.person_name(t.from_id) || ' handed over ' || round(v_books / 100.0) || ' DH by our books; '
         || public.person_name(t.to_id) || ' counted ' || round(p_counted / 100.0) || ' DH. '
         || 'Sterncut will call you both. Until then ' || public.person_name(t.from_id)
         || ' still pays the chairs, and nothing else about the shop changes.',
         v_books - p_counted
    from unnest(array[t.from_id, t.to_id, v_owner]) u;
  return json_build_object('state', 'mismatch', 'declared_cents', v_books, 'counted_cents', p_counted);
end $$;

-- ---- 7 · the owner's remove, which used to flip the role back as a flag --------------
create or replace function public.salon_remove_member(p_barber uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid; v_owner uuid; v_due int;
begin
  select s.id, s.owner_id into v_salon, v_owner from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can remove staff'; end if;
  if p_barber = v_owner then raise exception 'The owner cannot be removed'; end if;
  -- rule 5: cash follows the person, and the drawer clears first
  if p_barber = public.till_of(v_salon) then
    raise exception 'He holds the shop''s cash. Hand the drawer to someone else first, in "Who holds the cash".';
  end if;
  if exists (select 1 from public.drawer_transfers t
              where t.salon_id = v_salon and t.state in ('pending', 'mismatch')
                and p_barber in (t.from_id, t.to_id)) then
    raise exception 'A handover of the drawer involving him is under way';
  end if;
  v_due := public.drawer_due_cents(v_salon, p_barber);
  if v_due > 0 then
    raise exception 'The shop owes him % DH. Pay him from the drawer first — he gives the agent his code.',
      round(v_due / 100.0);
  elsif v_due < 0 then
    raise exception 'He owes the drawer % DH. Settle that in the shop first.', round(-v_due / 100.0);
  end if;
  update public.barbers set
    salon_id = null, salon_status = 'pending', salon_role = 'barber',
    pay_model = 'rent', commission_pct = 55, rent_cents = 0, chair_label = null
  where id = p_barber and salon_id = v_salon;
  if not found then raise exception 'Not a member of your salon'; end if;
end;
$$;

-- ---- 8 · BAC-01 … BAC-04 and BAC-09, re-read around the agent ------------------------
-- 0125's body. What changed: the till is the cash agent, not the owner, and it
-- reads the whole drawer's top-ups (the one before him took some of them); a barber
-- who is not the till reads what the drawer owes him — `due` — with the lines that
-- make it up, since the shop settles with him on no calendar but his own payouts.
create or replace function public.my_account()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  me record;
  v_since timestamptz;
  v_till boolean;
  v_owner boolean;
  v_ours int; v_ours_n int;
  v_mine int; v_dep int; v_dep_n int; v_ns int; v_ns_n int; v_ref int; v_ref_n int;
  v_wc int; v_wc_n int;
  v_pend int; v_pend_n int;
  v_coll int; v_coll_n int;
  v_bill int := 0;
  v_due int; v_paid int; v_billed int;
  v_last record;
begin
  select b.id, b.salon_id, coalesce(p.full_name, 'Barber') as name,
         s.name as salon, s.owner_id, s.float_cap_cents, s.cash_agent_id, s.payouts_from
    into me
    from public.barbers b
    join public.salons s on s.id = b.salon_id
    left join public.profiles p on p.id = b.id
   where b.id = auth.uid() and b.salon_status = 'approved';
  if me.id is null then return json_build_object('salon', null); end if;

  v_since := public.barber_account_since(me.salon_id);
  v_till := coalesce(me.cash_agent_id, me.owner_id) = me.id;
  v_owner := me.owner_id = me.id;

  -- the drawer's top-ups, whoever took them
  select coalesce(sum(amount_cents), 0), count(*) into v_ours, v_ours_n
    from public.barber_ledger
   where direction = 'held_for_us' and salon_id = me.salon_id
     and (v_since is null or occurred_at > v_since);

  select coalesce(sum(amount_cents) filter (where kind = 'wallet_cut'), 0),
         count(*) filter (where kind = 'wallet_cut'),
         coalesce(sum(amount_cents) filter (where kind = 'deposit'), 0),
         count(*) filter (where kind = 'deposit'),
         coalesce(sum(amount_cents) filter (where kind in ('no_show', 'late_cancel')), 0),
         count(*) filter (where kind in ('no_show', 'late_cancel')),
         coalesce(sum(amount_cents) filter (where kind = 'refund'), 0),
         count(*) filter (where kind = 'refund')
    into v_wc, v_wc_n, v_dep, v_dep_n, v_ns, v_ns_n, v_ref, v_ref_n
    from public.barber_ledger
   where direction = 'held_for_him' and barber_id = me.id and salon_id = me.salon_id
     and cleared_at is not null and (v_since is null or cleared_at > v_since);
  v_mine := v_wc + v_dep + v_ns + v_ref;

  select coalesce(sum(amount_cents), 0), count(*) into v_pend, v_pend_n
    from public.barber_ledger
   where direction = 'held_for_him' and barber_id = me.id and salon_id = me.salon_id
     and cleared_at is null;

  if v_till then
    select coalesce(sum(amount_cents), 0), count(distinct barber_id) into v_coll, v_coll_n
      from public.barber_ledger
     where direction = 'held_for_him' and salon_id = me.salon_id and barber_id <> me.id
       and cleared_at is not null and (v_since is null or cleared_at > v_since);
    select least(coalesce(sum(st.balance_cents - st.pending_cents), 0), greatest(v_mine + v_coll, 0))
      into v_bill
      from public.subscription_invoice_state st
     where st.salon_id = me.salon_id and st.status = 'open';
  else
    v_coll := 0; v_coll_n := 0;
  end if;

  -- what the drawer owes him, and the two lines besides this week's that make it up
  v_due := public.drawer_due_cents(me.salon_id, me.id);
  select coalesce(sum(e.amount_cents), 0) into v_paid
    from public.drawer_entries e
   where e.salon_id = me.salon_id and e.barber_id = me.id and (v_since is null or e.created_at > v_since);
  v_billed := case when v_owner then coalesce((
      select sum(a.amount_cents) from public.subscription_applications a
        join public.settlement_lines l on l.id = a.line_id
       where l.salon_id = me.salon_id and a.method = 'netted'
         and a.applied_at > me.payouts_from and (v_since is null or a.applied_at > v_since)), 0)
    else 0 end;

  select coalesce(p.full_name, 'the agent') as agent, rc.recorded_at as at into v_last
    from public.settlement_receipts rc
    join public.settlement_lines l on l.id = rc.line_id
    left join public.profiles p on p.id = rc.agent_id
   where l.salon_id = me.salon_id
   order by rc.recorded_at desc limit 1;

  return json_build_object(
    'me', me.name, 'salon', me.salon, 'salon_id', me.salon_id,
    'till', v_till,
    'is_owner', v_owner,
    'since', v_since,
    'last_visit', case when v_last.at is null then null
                       else json_build_object('agent', v_last.agent, 'at', v_last.at) end,
    'ours', json_build_object('cents', case when v_till then v_ours else 0 end,
                              'count', case when v_till then v_ours_n else 0 end),
    'mine', json_build_object('cents', v_mine,
              'wallet_cuts', json_build_object('cents', v_wc, 'count', v_wc_n),
              'deposits', json_build_object('cents', v_dep, 'count', v_dep_n),
              'no_shows', json_build_object('cents', v_ns, 'count', v_ns_n),
              'refunds', json_build_object('cents', v_ref, 'count', v_ref_n)),
    'pending', json_build_object('cents', v_pend, 'count', v_pend_n),
    'colleagues', json_build_object('cents', v_coll, 'barbers', v_coll_n),
    -- §7: a barber holding the drawer carries the shop's bill in his Friday figure,
    -- but only the owner is told what it is
    'bill_cents', v_bill,
    -- the till: + he hands over on Friday, − Sterncut hands the shop that much.
    -- anyone else: − the drawer owes him that much.
    'net_cents', case when v_till then v_ours - v_mine - v_coll + v_bill else -v_due end,
    'due', json_build_object(
              'cents', v_due,
              'paid_cents', v_paid,
              'bill_cents', v_billed,
              'carried_cents', v_due - v_mine + v_paid + v_billed),
    'cap', case when v_till then json_build_object(
             'cap_cents', me.float_cap_cents,
             'net_cents', public.salon_net_cents(me.salon_id),
             'room_cents', greatest(me.float_cap_cents - public.salon_net_cents(me.salon_id), 0)) end,
    'agent', (select json_build_object('name', coalesce(p.full_name, 'the owner'),
                                       'is_me', ab.id = me.id)
                from public.barbers ab left join public.profiles p on p.id = ab.id
               where ab.id = coalesce(me.cash_agent_id, me.owner_id)),
    'handover', public.my_drawer_transfer()
  );
end $$;

-- 0125's body; 'topups' is the drawer's, for whoever holds it
create or replace function public.my_account_lines(p_kind text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare me record; v_since timestamptz;
begin
  select b.id, b.salon_id, s.owner_id, coalesce(s.cash_agent_id, s.owner_id) as till into me
    from public.barbers b join public.salons s on s.id = b.salon_id
   where b.id = auth.uid() and b.salon_status = 'approved';
  if me.id is null then return '[]'::json; end if;
  v_since := public.barber_account_since(me.salon_id);

  if p_kind = 'topups' then
    if me.till <> me.id then return '[]'::json; end if;
    return coalesce((
      select json_agg(json_build_object(
               'ref', x.ref, 'cents', x.amount_cents, 'at', x.occurred_at,
               'name', coalesce(p.full_name, 'Client')) order by x.occurred_at desc)
        from public.barber_ledger x
        left join public.profiles p on p.id = x.customer_id
       where x.direction = 'held_for_us' and x.salon_id = me.salon_id
         and (v_since is null or x.occurred_at > v_since)), '[]'::json);
  end if;

  return coalesce((
    select json_agg(json_build_object(
             'booking', x.booking_id, 'ref', x.ref, 'kind', x.kind,
             'cents', x.amount_cents, 'at', x.occurred_at, 'cleared_at', x.cleared_at,
             'starts_at', b.starts_at, 'status', b.status,
             'name', coalesce(b.walk_in_name, p.full_name, 'Client'),
             'service', sv.name,
             'in_chair_cents', greatest(b.price_cents - coalesce(b.discount_cents, 0) - b.deposit_cents, 0),
             'client_says', (select sc.detail from public.support_cases sc
                              where sc.booking_id = b.id and sc.user_id = b.customer_id
                              order by sc.created_at desc limit 1),
             'disputed', exists (select 1 from public.support_cases sc
                                  where sc.booking_id = b.id and sc.user_id = me.id
                                    and sc.status = 'open'))
           order by x.occurred_at desc)
      from public.barber_ledger x
      join public.bookings b on b.id = x.booking_id
      left join public.profiles p on p.id = x.customer_id
      left join public.services sv on sv.id = b.service_id
     where x.direction = 'held_for_him' and x.barber_id = me.id and x.salon_id = me.salon_id
       and case p_kind
             when 'wallet_cuts' then x.kind = 'wallet_cut'
             when 'deposits' then x.kind = 'deposit'
             when 'no_shows' then x.kind in ('no_show', 'late_cancel')
             when 'refunds' then x.kind = 'refund'
             when 'pending' then x.cleared_at is null
             else false end
       and (p_kind = 'pending' or v_since is null or x.cleared_at > v_since)), '[]'::json);
end $$;

-- ---- 9 · ops: FIN-18 ------------------------------------------------------------------
create or replace function public.admin_drawer_transfers()
returns json
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', t.id, 'ref', t.ref, 'state', t.state, 'salon', s.name, 'salon_id', s.id,
             'from_name', public.person_name(t.from_id), 'to_name', public.person_name(t.to_id),
             'declared_cents', t.declared_cents, 'counted_cents', t.counted_cents,
             'gap_cents', t.declared_cents - t.counted_cents,
             'at', t.created_at, 'counted_at', t.counted_at, 'closed_at', t.closed_at,
             'count_requested_at', t.count_requested_at)
           order by (t.state = 'mismatch') desc, t.created_at desc)
      from public.drawer_transfers t
      join public.salons s on s.id = t.salon_id
     where t.state in ('pending', 'mismatch')
        or (t.state = 'resolved' and t.resolved_at > now() - interval '30 days')), '[]'::json);
end $$;

create or replace function public.admin_drawer_transfer(p_id uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare t record; s record; v_since timestamptz;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into t from public.drawer_transfers where id = p_id;
  if t.id is null then raise exception 'No such transfer'; end if;
  select * into s from public.salons where id = t.salon_id;
  v_since := public.barber_account_since(s.id);

  return json_build_object(
    'id', t.id, 'ref', t.ref, 'state', t.state,
    'salon', json_build_object('id', s.id, 'name', s.name, 'address', s.address,
               'chairs', (select count(*) from public.barbers b
                           where b.salon_id = s.id and b.salon_status = 'approved')),
    'from', json_build_object('id', t.from_id, 'name', public.person_name(t.from_id),
               'is_owner', t.from_id = s.owner_id,
               'chair', (select b.chair_label from public.barbers b where b.id = t.from_id),
               'agent_since', s.cash_agent_since,
               -- his collection record: the shop's Friday receipts while he held it
               'collections', (select count(*) from public.settlement_receipts rc
                                 join public.settlement_lines l on l.id = rc.line_id
                                where l.salon_id = s.id and rc.verification = 'verified'
                                  and rc.recorded_at > s.cash_agent_since),
               'failed', (select count(*) from public.settlement_receipts rc
                            join public.settlement_lines l on l.id = rc.line_id
                           where l.salon_id = s.id and rc.verification not in ('verified', 'queued')
                             and rc.recorded_at > s.cash_agent_since)),
    'to', json_build_object('id', t.to_id, 'name', public.person_name(t.to_id),
               'chair', (select b.chair_label from public.barbers b where b.id = t.to_id),
               'held_before', t.to_id = s.owner_id or exists (
                  select 1 from public.drawer_transfers o
                   where o.to_id = t.to_id and o.state in ('done', 'resolved') and o.id <> t.id)),
    'declared_cents', t.declared_cents, 'counted_cents', t.counted_cents,
    'gap_cents', t.declared_cents - t.counted_cents,
    -- what our books say, and why that is not evidence: every top-up on it was his
    'books', json_build_object(
               'since', v_since,
               'topups', (select count(*) from public.wallet_transactions w
                           where w.salon_id = s.id and w.kind = 'cash_topup'
                             and (v_since is null or w.created_at > v_since)),
               'topups_cents', (select coalesce(sum(w.amount_cents), 0) from public.wallet_transactions w
                                 where w.salon_id = s.id and w.kind = 'cash_topup'
                                   and (v_since is null or w.created_at > v_since)),
               'topups_by_him', (select count(*) from public.wallet_transactions w
                                  where w.salon_id = s.id and w.kind = 'cash_topup' and w.created_by = t.from_id
                                    and (v_since is null or w.created_at > v_since)),
               'paid_out_cents', (select coalesce(sum(e.amount_cents), 0) from public.drawer_entries e
                                   where e.salon_id = s.id and e.kind = 'payout'
                                     and (v_since is null or e.created_at > v_since)),
               'sterncut_cents', public.salon_net_cents(s.id),
               'drawer_cents', public.drawer_cents(s.id)),
    'dues', (select coalesce(json_agg(json_build_object('name', public.person_name(d.barber_id),
               'cents', d.due_cents) order by d.due_cents desc), '[]'::json)
               from public.drawer_dues(s.id) d where d.due_cents <> 0),
    'at', t.created_at, 'counted_at', t.counted_at, 'closed_at', t.closed_at,
    'count_requested_at', t.count_requested_at,
    'count_requested_by', case when t.count_requested_by is null then null else public.person_name(t.count_requested_by) end,
    'agreed_cents', t.agreed_cents, 'resolution_note', t.resolution_note,
    'resolved_by', case when t.resolved_by is null then null else public.person_name(t.resolved_by) end,
    'resolved_at', t.resolved_at);
end $$;

-- "Send the collection agent to count it": logged, so the call knows it was asked for
create or replace function public.admin_request_drawer_count(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.drawer_transfers set count_requested_at = now(), count_requested_by = auth.uid()
   where id = p_id and state = 'mismatch';
  if not found then raise exception 'That handover is not waiting on a count'; end if;
end $$;

-- "Record what was agreed": names the new agent; the difference stays on the man who
-- handed over, as cash he is answerable for. Nothing disappears, nothing is written off.
create or replace function public.admin_resolve_drawer_transfer(p_id uuid, p_agreed_cents int, p_note text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare t record; v_gap int; v_owner uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_agreed_cents is null or p_agreed_cents < 0 then raise exception 'Record the figure that was agreed'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Say what the call settled — it is logged against your name'; end if;
  select * into t from public.drawer_transfers where id = p_id for update;
  if t.id is null or t.state <> 'mismatch' then raise exception 'That handover is not open'; end if;
  select owner_id into v_owner from public.salons where id = t.salon_id;

  -- against the books as they stand now, not as they stood when he counted: the
  -- outgoing agent goes on paying the chairs while this is open, and those payouts
  -- are not missing cash. After the entry the books hold exactly what was agreed.
  v_gap := public.drawer_cents(t.salon_id) - p_agreed_cents;
  if v_gap <> 0 then
    insert into public.drawer_entries (salon_id, barber_id, agent_id, kind, amount_cents, proof, transfer_id, created_by)
    values (t.salon_id, t.from_id, null, 'handover_gap', v_gap, 'ops_record', t.id, auth.uid());
  end if;
  update public.drawer_transfers
     set state = 'resolved', agreed_cents = p_agreed_cents, resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = btrim(p_note), closed_at = now()
   where id = t.id;
  update public.salons set cash_agent_id = t.to_id, cash_agent_since = now() where id = t.salon_id;

  insert into public.notifications (user_id, kind, title, body, amount_cents)
  select distinct u, 'shop_status'::public.notif_kind, 'The drawer handover is settled',
         public.person_name(t.to_id) || ' now holds the shop''s cash, from ' || round(p_agreed_cents / 100.0) || ' DH. '
         || case when v_gap > 0 then public.person_name(t.from_id) || ' owes the drawer the other '
                                     || round(v_gap / 100.0) || ' DH.'
                 when v_gap < 0 then 'The drawer owes ' || public.person_name(t.from_id) || ' '
                                     || round(-v_gap / 100.0) || ' DH.'
                 else 'Nothing was missing.' end,
         p_agreed_cents
    from unnest(array[t.from_id, t.to_id, v_owner]) u;
  return json_build_object('state', 'resolved', 'gap_cents', v_gap);
end $$;

-- ---- 10 · grants ----------------------------------------------------------------------
do $$
declare f text;
begin
  -- internal: reached only through the definer functions above
  foreach f in array array[
    'public.till_of(uuid)', 'public.drawer_due_cents(uuid, uuid)', 'public.drawer_dues(uuid)',
    'public.drawer_cents(uuid)', 'public.drawer_clear(uuid)', 'public.person_name(uuid)',
    'public.appoint_till(uuid, uuid)', 'public.my_till_salon()', 'public.my_cash_salon()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- signed-in callers, each checking who they are
  foreach f in array array[
    'public.set_cash_agent(uuid)', 'public.cash_agent_state()', 'public.start_drawer_transfer(uuid)',
    'public.cancel_drawer_transfer()', 'public.my_payout_code()', 'public.my_drawer()',
    'public.agent_pay(uuid, int, text, text)', 'public.agent_receive(uuid, int)',
    'public.my_drawer_transfer()', 'public.confirm_drawer_transfer(uuid, int, int)',
    'public.admin_drawer_transfers()', 'public.admin_drawer_transfer(uuid)',
    'public.admin_request_drawer_count(uuid)', 'public.admin_resolve_drawer_transfer(uuid, int, text)',
    'public.agent_cash_topup(text, int, text)', 'public.my_float()', 'public.float_handover_code()',
    'public.request_float_collection()', 'public.my_visit_code()', 'public.my_visit_status()',
    'public.salon_set_cash_agent(uuid)', 'public.salon_remove_member(uuid)',
    'public.my_account()', 'public.my_account_lines(text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---- checked at apply time ------------------------------------------------------------
do $$
declare v_salon uuid;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    assert not exists (
      select 1 from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public'
         and p.proname in (
           'till_of', 'my_till_salon', 'my_cash_salon', 'drawer_due_cents', 'drawer_dues', 'drawer_cents',
           'drawer_clear', 'person_name', 'appoint_till', 'set_cash_agent', 'cash_agent_state',
           'start_drawer_transfer', 'cancel_drawer_transfer', 'my_payout_code', 'my_drawer', 'agent_pay',
           'agent_receive', 'my_drawer_transfer', 'confirm_drawer_transfer', 'admin_drawer_transfers',
           'admin_drawer_transfer', 'admin_request_drawer_count', 'admin_resolve_drawer_transfer',
           'agent_cash_topup', 'my_float', 'float_handover_code', 'request_float_collection',
           'my_visit_code', 'my_visit_status', 'salon_set_cash_agent', 'salon_remove_member',
           'my_account', 'my_account_lines')
         and (p.proacl is null or exists (
               select 1 from aclexplode(p.proacl) a
                where a.privilege_type = 'EXECUTE'
                  and (a.grantee = 0 or a.grantee = 'anon'::regrole)))),
      'every cash-agent function needs a signed-in caller';
  end if;
  -- the identity the whole slice rests on: the drawer is the two terms, in every shop
  for v_salon in select id from public.salons loop
    assert public.drawer_cents(v_salon) = public.salon_net_cents(v_salon)
      + coalesce((select sum(d.due_cents) from public.drawer_dues(v_salon) d), 0), 'drawer arithmetic';
  end loop;
end $$;
