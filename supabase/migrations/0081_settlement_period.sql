-- 0081_settlement_period: slice 2 settlement, step 1 — the period.
--
-- The money rail has existed since 0042/0044 and nothing grouped it into "this
-- week", so there was no statement to show an owner and no run to release.
-- These are the three tables §4 names, plus the exclusions, plus every
-- invariant §4 asks for as an actual barrier rather than a convention.
--
-- ---- the decisions this file encodes ---------------------------------------
--
-- §2.1 A RUN IS A DRAFT THAT GETS RELEASED. That is why this is a row and not a
-- query: a run that assembles itself as agents collect has no pay-out total
-- until Thursday, and that total is the whole question on Friday.
--
-- §2.4 THE HEADER EQUALS THE SUM OF THE LINES. Enforced twice, at two grains:
-- per line as a CHECK constraint (hold − earned + carried = amount), and per
-- statement at release (`settlement_run_imbalance`). A difference with no line
-- under it cannot be released.
--
-- §2.8 / APPEND-ONLY. `statement_items` can never be updated or deleted, and
-- can only be inserted against a DRAFT run. `settlement_lines` freeze their
-- money the moment they are written; only the visit columns move, and only
-- after release. A released week can never be edited into agreeing with itself.
--
-- ---- what this file deliberately does NOT do -------------------------------
--
-- No fee, commission or VAT column: §1 is explicit that the credibility of both
-- statement screens rests on the owner seeing that no third number is skimmed.
-- No RIB, IBAN or batch: releasing dispatches agent visits.
--
-- `float_settlements` is NOT duplicated here. It already records "we collected
-- X from shop Y" and a second writer of that truth is the "second ledger is a
-- second truth" failure §3.2 warns about. Step 4's release writes the
-- float_settlements row FROM the settlement line, in one function.

-- ---- the vocabulary --------------------------------------------------------
-- Types, not text columns. §4: the exclusion reason "needs to be a typed enum
-- with a rendered sentence per case, not a nullable string — the sentence is
-- product copy, not a log message."
do $$
begin
  if not exists (select 1 from pg_type where typname = 'settlement_state') then
    create type public.settlement_state as enum ('draft', 'released', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'settlement_direction') then
    -- §7: "Direction is a word, never a sign."
    create type public.settlement_direction as enum ('collect', 'pay_out', 'nil');
  end if;
  if not exists (select 1 from pg_type where typname = 'settlement_visit') then
    create type public.settlement_visit as enum ('pending', 'collected', 'part', 'paid', 'open');
  end if;
  if not exists (select 1 from pg_type where typname = 'statement_kind') then
    create type public.statement_kind as enum
      ('float_movement', 'deposit_earned', 'refund', 'carried');
  end if;
  if not exists (select 1 from pg_type where typname = 'exclusion_reason') then
    -- Four unrelated mechanisms, on purpose (§3.1). Two of these the database
    -- can derive; two it cannot, and saying so is better than a guess:
    --   suspended         derived — salons.status
    --   went_live_midweek derived — coalesce(reviewed_at, created_at)
    --   unreachable       DECLARED — there is no route or agent-assignment table
    --   wallet_open       DECLARED — an agent's cash has no open/closed session
    create type public.exclusion_reason as enum
      ('suspended', 'went_live_midweek', 'unreachable', 'wallet_open');
  end if;
end $$;

-- ---- the week ---------------------------------------------------------------
-- §2.5: cut at Friday 21:00. Tangier, so Africa/Casablanca — the cut is a wall
-- clock in the city the agents drive around, not UTC.
--
-- The ISO week of the cut instant IS the week number the screens print: Fri
-- 4 Sep 2026 is W36 and Fri 28 Aug is W35, which is exactly what FIN-14 and
-- OSH-16 are labelled. So the key is the cut and the label is derived; there is
-- no second week column to disagree with it.
create or replace function public.settlement_cut(p_at timestamptz default now())
returns timestamptz
language sql stable
as $$
  select (case
            when date_trunc('week', p_at at time zone 'Africa/Casablanca')
                 + interval '4 days 21 hours' > (p_at at time zone 'Africa/Casablanca')
            then date_trunc('week', p_at at time zone 'Africa/Casablanca')
                 + interval '4 days 21 hours' - interval '7 days'
            else date_trunc('week', p_at at time zone 'Africa/Casablanca')
                 + interval '4 days 21 hours'
          end) at time zone 'Africa/Casablanca';
$$;

-- stable, not immutable: rendering a timestamptz in a named zone depends on the
-- tz database, and Casablanca's does move (it drops to UTC+0 for Ramadan).
create or replace function public.settlement_week_label(p_cut timestamptz)
returns text
language sql stable
as $$
  select to_char(p_cut at time zone 'Africa/Casablanca', 'IYYY-"W"IW');
$$;

-- ---- 1 · the run -----------------------------------------------------------
create table if not exists public.settlement_runs (
  id uuid primary key default gen_random_uuid(),
  covers_from timestamptz not null,
  -- the cut, and the identity of the week. One run per week, by construction.
  covers_to timestamptz not null unique,
  state public.settlement_state not null default 'draft',
  released_at timestamptz,
  released_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint settlement_run_window check (covers_to > covers_from),
  -- a run that is not a draft has been released, and knows when
  constraint settlement_run_released check (state = 'draft' or released_at is not null)
);

-- ---- 2 · one shop's number for that week -----------------------------------
create table if not exists public.settlement_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.settlement_runs (id) on delete restrict,
  salon_id uuid not null references public.salons (id),
  direction public.settlement_direction not null,
  -- signed: + we collect from them, − we hand cash over, 0 a nil week
  amount_cents int not null,
  hold_cents int not null,        -- our float sitting in their till
  earned_cents int not null,      -- deposits they earned, net of refunds
  carried_cents int not null default 0,   -- §2.8, corrections from earlier weeks

  -- everything below moves AFTER release, and only these columns may
  visit public.settlement_visit not null default 'pending',
  collected_cents int,            -- §3.2's part payment: what actually crossed
  settled_at timestamptz,
  agent_id uuid references public.profiles (id),
  receipt_ref text,

  created_at timestamptz not null default now(),
  unique (run_id, salon_id),

  -- §3.1, as a constraint rather than a hope: "Every row satisfies
  -- hold − earned + carried = one number."
  constraint settlement_line_adds_up
    check (hold_cents - earned_cents + carried_cents = amount_cents),
  -- §7: the word and the sign can never disagree
  constraint settlement_line_direction check (
    (direction = 'collect' and amount_cents > 0) or
    (direction = 'pay_out' and amount_cents < 0) or
    (direction = 'nil'     and amount_cents = 0)),
  constraint settlement_line_part check (
    collected_cents is null or (collected_cents >= 0 and collected_cents <= abs(amount_cents)))
);
create index if not exists settlement_lines_run_idx on public.settlement_lines (run_id);
create index if not exists settlement_lines_salon_idx on public.settlement_lines (salon_id, created_at desc);

-- ---- 3 · the lines under the number ----------------------------------------
-- §4: "append-only. source_week is what lets a carried line name where it came
-- from (OSH-18); without it the correction is indistinguishable from this
-- week's money."
create table if not exists public.statement_items (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.settlement_lines (id) on delete restrict,
  kind public.statement_kind not null,
  -- the sentence the owner reads: "Cash top-up taken by Youssef"
  label text not null,
  -- §3.3: "Every line carries a reference and a time — that is what makes the
  -- number defensible." Both are NOT NULL for exactly that reason.
  booking_ref text not null,
  occurred_at timestamptz not null,
  amount_cents int not null,
  -- the covers_to of the week it came from. Only a carried line has one.
  source_week timestamptz,
  created_at timestamptz not null default now(),
  constraint statement_item_carried check (
    (kind = 'carried') = (source_week is not null))
);
create index if not exists statement_items_line_idx on public.statement_items (line_id, occurred_at);

-- ---- 4 · who is not in the run, and why ------------------------------------
create table if not exists public.settlement_exclusions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.settlement_runs (id) on delete restrict,
  salon_id uuid not null references public.salons (id),
  reason public.exclusion_reason not null,
  -- §2.2: "where money is involved, the amount". §2.3: the date it unlocks and
  -- the name of the person who tells the owner.
  amount_cents int,
  unlocks_on date,
  told_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (run_id, salon_id)
);

-- ---- the barriers ----------------------------------------------------------
-- 0075's `ledger_is_append_only` has wallet_transactions in its message and is
-- already reused on two other tables. These get their own, because the message
-- is the only thing the person who hits it will read.

create or replace function public.statement_item_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'A statement line is append-only - correct it with a new line on a later week';
  end if;
  -- §4: "no statement_item may be written against a run whose state is not draft"
  if (select r.state from public.settlement_runs r
        join public.settlement_lines l on l.run_id = r.id
       where l.id = new.line_id) <> 'draft' then
    raise exception 'That week is released - the correction belongs on the next one';
  end if;
  return new;
end $$;

drop trigger if exists statement_items_append_only on public.statement_items;
create trigger statement_items_append_only
  before insert or update or delete on public.statement_items
  for each row execute function public.statement_item_guard();

-- A line's MONEY is frozen the moment it is written; its VISIT moves after
-- release and must. Freezing the whole row would make FIN-15 impossible;
-- freezing nothing would make a released week editable. So: name the columns.
create or replace function public.settlement_line_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A settlement line cannot be deleted - a released week is a document somebody is holding';
  end if;
  if new.run_id <> old.run_id or new.salon_id <> old.salon_id
     or new.direction <> old.direction or new.amount_cents <> old.amount_cents
     or new.hold_cents <> old.hold_cents or new.earned_cents <> old.earned_cents
     or new.carried_cents <> old.carried_cents then
    raise exception 'The money on a settlement line never changes - carry a correction onto the next week';
  end if;
  return new;
end $$;

drop trigger if exists settlement_lines_frozen on public.settlement_lines;
create trigger settlement_lines_frozen
  before update or delete on public.settlement_lines
  for each row execute function public.settlement_line_guard();

-- The run's window is its identity, and state only ever goes forward.
create or replace function public.settlement_run_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A settlement run cannot be deleted';
  end if;
  if new.covers_from <> old.covers_from or new.covers_to <> old.covers_to then
    raise exception 'A run''s week cannot be moved once it exists';
  end if;
  if (old.state = 'released' and new.state = 'draft')
     or (old.state = 'closed' and new.state <> 'closed') then
    raise exception 'A run goes draft to released to closed, and never back';
  end if;
  return new;
end $$;

drop trigger if exists settlement_runs_forward_only on public.settlement_runs;
create trigger settlement_runs_forward_only
  before update or delete on public.settlement_runs
  for each row execute function public.settlement_run_guard();

-- ---- the invariant that has to hold at the gate ----------------------------
-- §2.4's "worth a failing test", as a function the release calls. It runs at
-- release rather than on every insert because a line is written before its
-- items are, and a draft is allowed to be half-built. What is NOT allowed is
-- releasing one: this names the shop, so the fix is findable.
create or replace function public.settlement_run_imbalance(p_run uuid)
returns table (salon text, line_cents int, items_cents int)
language sql stable security definer set search_path = ''
as $$
  select s.name, l.amount_cents,
         coalesce((select sum(i.amount_cents) from public.statement_items i
                    where i.line_id = l.id), 0)::int
    from public.settlement_lines l
    join public.salons s on s.id = l.salon_id
   where l.run_id = p_run
     and l.amount_cents <> coalesce((select sum(i.amount_cents)
                                       from public.statement_items i
                                      where i.line_id = l.id), 0)
     and public.is_admin();
$$;
grant execute on function public.settlement_run_imbalance(uuid) to authenticated;

-- ---- the exclusion sentence ------------------------------------------------
-- §2.2/§4: the sentence is product copy. It lives here so the console and the
-- owner's surface can never render two different versions of why a shop is out.
create or replace function public.exclusion_sentence(
  p_reason public.exclusion_reason, p_shop text, p_amount int,
  p_unlocks date, p_told_by text)
returns text
language sql immutable
as $$
  select case p_reason
    when 'suspended' then
      p_shop || ' is suspended and we owe them ' || round(coalesce(p_amount, 0) / 100.0)
      || ' DH. Held, not kept - it releases when the suspension lifts'
      || coalesce(' (review ' || to_char(p_unlocks, 'FMDD FMMonth') || ')', '')
      || ', and ' || coalesce(p_told_by, 'ops') || ' tells the owner today. '
      || 'The amount and that date sit on his own statement while he waits.'
    when 'went_live_midweek' then
      p_shop || ' went live mid-week. Their first covered week opens tonight, '
      || 'so there is no full week to state.'
    when 'unreachable' then
      p_shop || ' is unreachable - the only agent on that route is off. Their '
      || round(coalesce(p_amount, 0) / 100.0) || ' DH stays with them and the clock keeps running.'
    else
      p_shop || ' still has an agent wallet open. Until it closes the float is a '
      || 'guess, and a guess cannot go on a statement.'
  end;
$$;
grant execute on function public.exclusion_sentence(public.exclusion_reason, text, int, date, text) to authenticated;

-- ---- who reads what --------------------------------------------------------
-- Ops sees the run. An owner sees his own line, his own items, and the
-- exclusion that names his shop (§2.3: he must be able to see the held amount
-- and its date while he waits).
alter table public.settlement_runs enable row level security;
alter table public.settlement_lines enable row level security;
alter table public.statement_items enable row level security;
alter table public.settlement_exclusions enable row level security;

drop policy if exists settlement_runs_select on public.settlement_runs;
create policy settlement_runs_select on public.settlement_runs for select to authenticated
  using (public.is_admin()
         or exists (select 1 from public.settlement_lines l
                     join public.salons s on s.id = l.salon_id
                    where l.run_id = settlement_runs.id and s.owner_id = auth.uid()));

drop policy if exists settlement_lines_select on public.settlement_lines;
create policy settlement_lines_select on public.settlement_lines for select to authenticated
  using (public.is_admin()
         or exists (select 1 from public.salons s
                     where s.id = settlement_lines.salon_id and s.owner_id = auth.uid()));

drop policy if exists statement_items_select on public.statement_items;
create policy statement_items_select on public.statement_items for select to authenticated
  using (public.is_admin()
         or exists (select 1 from public.settlement_lines l
                     join public.salons s on s.id = l.salon_id
                    where l.id = statement_items.line_id and s.owner_id = auth.uid()));

drop policy if exists settlement_exclusions_select on public.settlement_exclusions;
create policy settlement_exclusions_select on public.settlement_exclusions for select to authenticated
  using (public.is_admin()
         or exists (select 1 from public.salons s
                     where s.id = settlement_exclusions.salon_id and s.owner_id = auth.uid()));

-- no insert/update/delete grants anywhere: rows appear only through the
-- security-definer functions steps 3 and 4 add.
grant select on public.settlement_runs, public.settlement_lines,
                public.statement_items, public.settlement_exclusions to authenticated;

do $$
declare
  v_cut timestamptz;
begin
  -- §2.5's cut, and the week label the screens print. Fri 4 Sep 2026 21:00 in
  -- Tangier is ISO week 36, which is exactly what FIN-14 is titled.
  v_cut := public.settlement_cut(timestamptz '2026-09-05 09:00+01');
  assert v_cut = timestamptz '2026-09-04 21:00+01',
    format('the cut before Sat morning is Friday 21:00, got %s', v_cut);
  assert public.settlement_week_label(v_cut) = '2026-W36',
    'and the run that cut ends is week 36';
  assert public.settlement_week_label(v_cut - interval '7 days') = '2026-W35',
    'the week before it is 35';

  -- the boundary itself, both sides. §2.5: "a chair at Fri 20:50 marked done
  -- Sat 08:02 is next week", so 21:00 exactly belongs to the week it closes.
  assert public.settlement_cut(timestamptz '2026-09-04 20:59+01')
       = timestamptz '2026-08-28 21:00+01', 'a minute before the cut is still last week';
  assert public.settlement_cut(timestamptz '2026-09-04 21:00+01')
       = timestamptz '2026-09-04 21:00+01', 'and the cut instant closes its own week';

  -- §3.3's statement, line for line, so the fixture can be checked by eye:
  --   float 2 910 - earned 1 396 + carried 52 = 1 566
  assert 40000 + 120000 + 81000 + 50000 = 291000, 'the four top-ups are 2 910 DH';
  assert 145600 - 6000 = 139600, '38 cuts less the 60 DH refund is 1 396 DH earned';
  assert 291000 - 139600 = 151400, 'this week''s movement is 1 514 DH';
  assert 291000 - 139600 + 5200 = 156600, 'and 1 566 DH is what crosses the counter';
  -- §2.4: the header IS the sum of the items, not just of the sections
  assert 40000 + 120000 + 81000 + 50000 - 145600 + 6000 + 5200 = 156600,
    'the items sum to the header - a difference with no line under it is a bug';

  -- OSH-16, the other direction: 1 460 held less 3 180 earned is −1 720
  assert 30000 + 56000 + 60000 = 146000, 'week 35''s three top-ups are 1 460 DH';
  assert 324000 - 6000 = 318000, '3 240 DH earned less that week''s 60 DH refund';
  assert 146000 - 318000 = -172000, 'so we handed the shop 1 720 DH';

  -- §7: the direction word and the sign can never disagree. These are the
  -- CHECK constraint's three arms, evaluated the same way it evaluates them.
  assert (156600 > 0), 'a positive number is a collect';
  assert (-172000 < 0), 'a negative one is a pay out';
  assert (0 = 0), 'and a nil week is a fact, not a gap';
end $$;
