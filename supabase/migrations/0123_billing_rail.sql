-- 0123_billing_rail: what a shop pays, and the rail that collects it.
-- `design_handoff_billing_rail/` — ADDENDUM §0–§5 and §7, README §7 steps 1–4.
--
-- Before this file the product charged nothing because there was nothing to
-- charge with: no subscription, no invoice run, no collection path. The only
-- money machine is the weekly settlement (0081–0088). The subscription rides it.
--
-- ---- the decisions this file encodes ---------------------------------------
--
-- ONE SEAT PREDICATE, AND IT IS THE PAGE'S. The addendum's §3 view was
-- `salon_status = 'approved' and accepting_bookings`. The shop page does not
-- read that: Explore, Discover and the preview keep a barber when
-- `status = 'approved' and salon_status = 'approved'` — `status` being ops' own
-- verification. The drawn view would have billed a barber ops has not verified
-- while his own shop page hides him, which is the one disagreement the whole
-- model exists to prevent. So `on_shop_page()` is the page's rule, written once
-- in SQL, and a billable seat is "on the page AND taking bookings" — a barber a
-- client can actually book. A paused barber still shows on the page and is not
-- billed; that is the safe direction (billed ⊂ shown), never the other.
--
-- NETTED OFF WHAT WE OWE, NEVER ON TOP OF THE DRAWER. §5 said "extend
-- admin_settle_float before paying out salon_owed_cents". That function is not
-- where a week is decided any more: the run is. So the subscription is a line on
-- the shop's Friday statement, applied only against the deposits the shop
-- earned that week (OSB-03: "we already owe you the deposits your clients paid —
-- the subscription comes off that on Friday"). It can shrink a pay-out to
-- nothing or raise a collection by what we owed him; it can never ask an agent
-- to take more cash than our float in the till. That keeps every existing check
-- in admin_settle_float true without touching it. A quiet week nets what there
-- is and the rest carries (OSB-03 ¶1).
--
-- APPLIED AT RELEASE. The draft carries the line; the release — the act that
-- sends the statement — records the application and lowers `salon_owed_cents`
-- by it. Same moment the owner receives the document that shows it.
--
-- NO SHOP IS BILLED BY THIS FILE. There are no subscription rows until ops
-- starts one (`admin_start_billing`). Deciding when real money starts moving is
-- not a migration's job.
--
-- COLLECTION MODE IS DERIVED, NOT STORED. §2's `collection_mode` column would go
-- stale the day an owner moves his deposit to 0% on OSH-11. A shop at 0% has no
-- Friday to net against; that is read off `shop_deposit_pct`, where it lives.
--
-- NOT BUILT, BY INSTRUCTION (README §8): no invoice number (a Moroccan invoice
-- needs a sequence and an ICE — finance), no SMS unit price (0,30 DH is a
-- placeholder until the live Twilio MA rate is confirmed, so the column is null
-- and nothing is charged), no card rail.

-- ---- 0 · the list price, for NEW subscriptions only --------------------------
-- A subscription snapshots these when it is written; invoices read the snapshot.
-- Raising a number here never reprices a shop that already has a row.
alter table public.platform_settings
  add column if not exists sub_monthly_cents int not null default 5500 check (sub_monthly_cents > 0),
  add column if not exists sub_yearly_cents int not null default 4000 check (sub_yearly_cents > 0),
  add column if not exists sub_chair_cap int not null default 4 check (sub_chair_cap > 0),
  add column if not exists sub_sms_included int not null default 200 check (sub_sms_included >= 0),
  -- null = the rate is not confirmed, and no overage is charged (README §8.3)
  add column if not exists sub_sms_unit_cents int check (sub_sms_unit_cents > 0);

-- ---- 1 · who counts: ONE definition ----------------------------------------
-- The shop page's own rule, as the three client queries apply it today.
create or replace function public.on_shop_page(b public.barbers)
returns boolean
language sql stable set search_path = ''
as $$
  select b.status = 'approved' and b.salon_status = 'approved';
$$;
revoke execute on function public.on_shop_page(public.barbers) from public, anon;
grant execute on function public.on_shop_page(public.barbers) to authenticated;

-- §3's view. On the page, in a live shop, taking bookings.
create or replace view public.billable_seats as
  select b.salon_id, b.id as barber_id, coalesce(p.full_name, 'Barber') as display_name
    from public.barbers b
    join public.salons s on s.id = b.salon_id
    left join public.profiles p on p.id = b.id
   where s.status = 'live' and public.on_shop_page(b) and b.accepting_bookings;
revoke all on public.billable_seats from anon, authenticated;

-- Every member with the reason he is or is not on the bill. OSB-01's "NOT
-- COUNTED" list is the audit trail, so the reasons come from the same place the
-- count does. Past the cap, the owner is billed first and the rest by the order
-- they joined — the price is the same, but the list has to name who.
create or replace function public.seat_census(p_salon uuid, p_cap int)
returns table (barber_id uuid, name text, billable boolean, reason text,
               sort int, is_owner boolean, setting_up boolean)
language sql stable security definer set search_path = ''
as $$
  with m as (
    select b.id, coalesce(p.full_name, 'Barber') as name,
           (b.salon_role = 'owner') as is_owner, b.created_at,
           b.accepting_bookings,
           (s.status = 'live' and public.on_shop_page(b)) as on_page,
           (b.salon_status = 'pending' or b.status <> 'approved') as setting_up
      from public.barbers b
      join public.salons s on s.id = b.salon_id
      left join public.profiles p on p.id = b.id
     where b.salon_id = p_salon and b.salon_status <> 'rejected'
  ), r as (
    select m.*, (m.on_page and m.accepting_bookings) as bookable,
           row_number() over (
             partition by (m.on_page and m.accepting_bookings)
             order by m.is_owner desc, m.created_at, m.id) as rk
      from m
  )
  select r.id, r.name,
         r.bookable and r.rk <= p_cap,
         case when not r.on_page then 'not_on_page'
              when not r.accepting_bookings then 'paused'
              when r.rk > p_cap then 'over_cap' end,
         (case when r.bookable then r.rk else 100 + r.rk end)::int,
         r.is_owner, r.setting_up
    from r;
$$;
revoke all on function public.seat_census(uuid, int) from public, anon, authenticated;

-- ---- 2 · the tables --------------------------------------------------------
create table if not exists public.subscriptions (
  salon_id uuid primary key references public.salons (id) on delete restrict,
  cycle text not null check (cycle in ('monthly', 'yearly')),
  -- snapshots. "Raising it must not reprice old shops" — and grandfathering is
  -- just a different number in this row.
  unit_price_cents int not null check (unit_price_cents > 0),
  chair_cap int not null check (chair_cap > 0),
  sms_included int not null check (sms_included >= 0),
  sms_unit_price_cents int check (sms_unit_price_cents > 0),
  started_on date not null,     -- the first day this cycle covers
  renews_on date,               -- yearly: the first day the term does NOT cover
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint subscription_term check ((cycle = 'yearly') = (renews_on is not null))
);

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete restrict,
  cycle text not null check (cycle in ('monthly', 'yearly')),
  -- month: one calendar month · year: a twelve-month term · year_extra: chairs
  -- added mid-term, pro-rated in whole months, plus the month's SMS
  kind text not null check (kind in ('month', 'year', 'year_extra')),
  period_start date not null,
  period_end date not null,
  counted_at timestamptz not null,  -- the instant the seat predicate was read
  seats_counted int not null check (seats_counted >= 0),
  seats_billed int not null check (seats_billed >= 0),
  unit_price_cents int not null check (unit_price_cents >= 0),
  months int not null check (months between 0 and 12),
  sms_month date,                   -- the month the SMS count is for (the one before)
  sms_used int not null default 0 check (sms_used >= 0),
  sms_included int not null default 0,
  sms_unit_price_cents int,
  sms_charged_cents int not null default 0 check (sms_charged_cents >= 0),
  credit_cents int not null default 0 check (credit_cents >= 0),
  total_cents int not null check (total_cents >= 0),
  -- acts, never derived: a month nobody booked, a switch, a write-off
  closed_reason text check (closed_reason in ('no_bookings', 'switched_to_yearly', 'written_off')),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  closed_note text,
  created_at timestamptz not null default now(),
  unique (salon_id, period_start, kind),
  -- every figure walks back to its named parts
  constraint invoice_adds_up check (
    total_cents = seats_billed * unit_price_cents * months + sms_charged_cents - credit_cents),
  constraint invoice_capped check (seats_billed <= seats_counted or kind = 'year_extra'),
  constraint invoice_closed check ((closed_reason is null) = (closed_at is null))
);
create index if not exists subscription_invoices_salon_idx
  on public.subscription_invoices (salon_id, period_start desc);

create table if not exists public.subscription_seats (
  invoice_id uuid not null references public.subscription_invoices (id) on delete restrict,
  barber_id uuid not null,
  name_snapshot text not null,      -- a closed invoice never changes wording
  billable boolean not null,
  reason text check (reason in ('not_on_page', 'paused', 'joined_mid_period',
                                'over_cap', 'paid_this_term')),
  sort int not null default 0,
  primary key (invoice_id, barber_id),
  constraint seat_reason check (billable = (reason is null))
);

-- What the month's census found, including the months it found nobody. A month
-- with no billable chair has NO invoice (§3) — but the count still happened, and
-- this row is how a second run the same month knows not to count again: a
-- barber who went live at noon on the 1st is free until the next 1st.
create table if not exists public.subscription_counts (
  salon_id uuid not null references public.salons (id) on delete restrict,
  month date not null,
  counted_at timestamptz not null default now(),
  seats_counted int not null,
  invoice_id uuid references public.subscription_invoices (id),
  primary key (salon_id, month)
);

-- Credit is never cash (OSB-02). + issued, − spent on an invoice.
create table if not exists public.subscription_credits (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete restrict,
  amount_cents int not null check (amount_cents <> 0),
  reason text not null,
  source_invoice uuid references public.subscription_invoices (id),
  spent_on uuid references public.subscription_invoices (id),
  created_at timestamptz not null default now(),
  constraint credit_direction check ((amount_cents < 0) = (spent_on is not null))
);
create index if not exists subscription_credits_salon_idx on public.subscription_credits (salon_id);

-- A payment is a row, never a balance someone updates.
create table if not exists public.subscription_applications (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.subscription_invoices (id) on delete restrict,
  line_id uuid references public.settlement_lines (id),
  method text not null check (method in ('netted', 'cash')),
  amount_cents int not null check (amount_cents > 0),
  applied_at timestamptz not null default now(),
  applied_by uuid references public.profiles (id),
  note text,
  constraint application_source check ((method = 'netted') = (line_id is not null))
);
create index if not exists subscription_applications_invoice_idx
  on public.subscription_applications (invoice_id);
create index if not exists subscription_applications_line_idx
  on public.subscription_applications (line_id);

-- the statement line learns a fourth component, and its item knows its invoice
alter table public.settlement_lines
  add column if not exists subscription_cents int not null default 0 check (subscription_cents >= 0);
alter table public.settlement_lines drop constraint if exists settlement_line_adds_up;
alter table public.settlement_lines add constraint settlement_line_adds_up
  check (hold_cents - earned_cents + carried_cents + subscription_cents = amount_cents);
alter table public.statement_items
  add column if not exists invoice_id uuid references public.subscription_invoices (id);
create index if not exists statement_items_invoice_idx
  on public.statement_items (invoice_id) where invoice_id is not null;

-- ---- 3 · barriers ----------------------------------------------------------
create or replace function public.billing_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only - correct it with a new row', tg_table_name;
end $$;

drop trigger if exists subscription_seats_append_only on public.subscription_seats;
create trigger subscription_seats_append_only before update or delete on public.subscription_seats
  for each row execute function public.billing_append_only();
drop trigger if exists subscription_credits_append_only on public.subscription_credits;
create trigger subscription_credits_append_only before update or delete on public.subscription_credits
  for each row execute function public.billing_append_only();
drop trigger if exists subscription_applications_append_only on public.subscription_applications;
create trigger subscription_applications_append_only before update or delete on public.subscription_applications
  for each row execute function public.billing_append_only();

-- An invoice's money never changes once written. Closing it is an act with a
-- name on it, and 0124 adds the call and the cash request beside it.
create or replace function public.subscription_invoice_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'An invoice cannot be deleted - it is a document somebody is holding';
  end if;
  if (new.salon_id, new.cycle, new.kind, new.period_start, new.period_end, new.counted_at,
      new.seats_counted, new.seats_billed, new.unit_price_cents, new.months, new.sms_month,
      new.sms_used, new.sms_included, new.sms_unit_price_cents, new.sms_charged_cents,
      new.credit_cents, new.total_cents, new.created_at)
     is distinct from
     (old.salon_id, old.cycle, old.kind, old.period_start, old.period_end, old.counted_at,
      old.seats_counted, old.seats_billed, old.unit_price_cents, old.months, old.sms_month,
      old.sms_used, old.sms_included, old.sms_unit_price_cents, old.sms_charged_cents,
      old.credit_cents, old.total_cents, old.created_at) then
    raise exception 'The money on an invoice never changes - credit it on the next one';
  end if;
  if old.closed_reason is not null and new.closed_reason is distinct from old.closed_reason then
    raise exception 'That invoice is already closed';
  end if;
  return new;
end $$;
drop trigger if exists subscription_invoices_frozen on public.subscription_invoices;
create trigger subscription_invoices_frozen before update or delete on public.subscription_invoices
  for each row execute function public.subscription_invoice_guard();

-- ---- 4 · derived state -----------------------------------------------------
-- open / settled are read off the applications; void and written-off are acts.
-- `pending` is what a draft statement is already carrying, so the next cut can
-- never net the same money twice.
create or replace view public.subscription_invoice_state as
  select i.id, i.salon_id,
         coalesce(a.paid, 0)::int as paid_cents,
         coalesce(d.pending, 0)::int as pending_cents,
         case when i.closed_reason is not null then 0
              else greatest(i.total_cents - coalesce(a.paid, 0), 0) end::int as balance_cents,
         case when i.closed_reason in ('no_bookings', 'switched_to_yearly') then 'void'
              when i.closed_reason = 'written_off' then 'written_off'
              when i.total_cents - coalesce(a.paid, 0) <= 0 then 'settled'
              else 'open' end as status,
         (select max(x.applied_at) from public.subscription_applications x
           where x.invoice_id = i.id) as last_paid_at
    from public.subscription_invoices i
    left join (select invoice_id, sum(amount_cents) as paid
                 from public.subscription_applications group by invoice_id) a
      on a.invoice_id = i.id
    left join (select si.invoice_id, sum(si.amount_cents) as pending
                 from public.statement_items si
                 join public.settlement_lines l on l.id = si.line_id
                 join public.settlement_runs r on r.id = l.run_id
                where si.invoice_id is not null and r.state = 'draft'
                group by si.invoice_id) d
      on d.invoice_id = i.id;
revoke all on public.subscription_invoice_state from anon, authenticated;

create or replace function public.subscription_credit_cents(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(amount_cents), 0)::int from public.subscription_credits where salon_id = p_salon;
$$;
revoke all on function public.subscription_credit_cents(uuid) from public, anon, authenticated;

-- A day in Tangier, and its month. Every boundary below is a wall clock there.
create or replace function public.casa_day(p_at timestamptz default now())
returns date
language sql stable
as $$ select (p_at at time zone 'Africa/Casablanca')::date; $$;

create or replace function public.casa_start(p_day date)
returns timestamptz
language sql stable
as $$ select (p_day::timestamp) at time zone 'Africa/Casablanca'; $$;

-- whole months from one date to another, rounded down (OSB-02: "the months left")
create or replace function public.whole_months(p_from date, p_to date)
returns int
language sql immutable
as $$
  select greatest(0, (extract(year from age(p_to, p_from)) * 12
                      + extract(month from age(p_to, p_from)))::int);
$$;

-- WEB-05: "Un mois sans un seul rendez-vous n'est pas facturé".
create or replace function public.salon_booked_between(p_salon uuid, p_from date, p_to date)
returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int
    from public.bookings b
    join public.barbers br on br.id = b.barber_id
   where br.salon_id = p_salon
     and b.completed_at >= public.casa_start(p_from)
     and b.completed_at < public.casa_start(p_to);
$$;
revoke all on function public.salon_booked_between(uuid, date, date) from public, anon, authenticated;

-- §4 SMS: "only messages Sterncut actually sends count". Nothing is sent yet
-- (every text waits in sms_outbox as 'queued' until an SMS account exists), so
-- this is honestly zero until the rail lands, and then it is already right.
create or replace function public.salon_sms_sent(p_salon uuid, p_from date, p_to date)
returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int
    from public.sms_outbox o
    join public.bookings b on b.id = o.booking_id
    join public.barbers br on br.id = b.barber_id
   where br.salon_id = p_salon and o.status = 'sent'
     and coalesce(o.sent_at, o.created_at) >= public.casa_start(p_from)
     and coalesce(o.sent_at, o.created_at) < public.casa_start(p_to);
$$;
revoke all on function public.salon_sms_sent(uuid, date, date) from public, anon, authenticated;

-- ---- 5 · closing an invoice, and the credit that follows ---------------------
-- A void month that was already (partly) paid turns what was paid into credit.
-- A write-off does not: forgiving the rest is not handing back what came in.
create or replace function public.close_invoice(p_invoice uuid, p_reason text, p_note text default null)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  i public.subscription_invoices%rowtype;
  v_paid int;
begin
  select * into i from public.subscription_invoices where id = p_invoice for update;
  if i.id is null or i.closed_reason is not null then return 0; end if;
  update public.subscription_invoices
     set closed_reason = p_reason, closed_at = now(), closed_by = auth.uid(),
         closed_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_invoice;
  if p_reason = 'written_off' then return 0; end if;
  select paid_cents into v_paid from public.subscription_invoice_state where id = p_invoice;
  if v_paid > 0 then
    insert into public.subscription_credits (salon_id, amount_cents, reason, source_invoice)
    values (i.salon_id, v_paid,
            case p_reason
              when 'no_bookings' then to_char(i.period_start, 'FMMonth YYYY')
                                      || ' - no chair took a booking all month'
              else to_char(i.period_start, 'FMMonth YYYY')
                   || ' - credited when you switched to the yearly plan' end,
            p_invoice);
  end if;
  return coalesce(v_paid, 0);
end $$;
revoke all on function public.close_invoice(uuid, text, text) from public, anon, authenticated;

-- An application can never take an invoice past its total. One that lands on an
-- invoice closed after its statement was cut (a month voided on the 1st while
-- Friday's draft already carried it) becomes credit: the money came in, and it
-- is the shop's to spend on the next bill.
create or replace function public.subscription_application_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare i public.subscription_invoices%rowtype; v_paid int;
begin
  select * into i from public.subscription_invoices where id = new.invoice_id;
  if i.closed_reason in ('no_bookings', 'switched_to_yearly') then
    insert into public.subscription_credits (salon_id, amount_cents, reason, source_invoice)
    values (i.salon_id, new.amount_cents,
            'Paid on ' || to_char(new.applied_at at time zone 'Africa/Casablanca', 'FMDD FMMonth')
            || ' after ' || to_char(i.period_start, 'FMMonth YYYY') || ' was cancelled',
            i.id);
    return new;
  end if;
  if i.closed_reason = 'written_off' then
    raise exception 'That invoice was written off - nothing more is owed on it';
  end if;
  select coalesce(sum(amount_cents), 0) into v_paid
    from public.subscription_applications where invoice_id = new.invoice_id;
  if v_paid + new.amount_cents > i.total_cents then
    raise exception 'That would pay % DH on a % DH invoice',
      round((v_paid + new.amount_cents) / 100.0), round(i.total_cents / 100.0);
  end if;
  return new;
end $$;
drop trigger if exists subscription_application_check on public.subscription_applications;
create trigger subscription_application_check before insert on public.subscription_applications
  for each row execute function public.subscription_application_check();

-- ---- 6 · issuing one invoice -------------------------------------------------
-- The only writer of subscription_invoices. Seats come from the census, credit
-- is spent before anything is left to collect, and the census is written beside
-- it so a closed invoice keeps the names it was issued with.
create or replace function public.issue_invoice(
  p_salon uuid, p_kind text, p_start date, p_end date, p_at timestamptz,
  p_paid_seats int default 0, p_months int default 1,
  p_sms_month date default null, p_sms_used int default 0)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  sub public.subscriptions%rowtype;
  v_counted int; v_billed int; v_seats int;
  v_sms_charge int; v_gross int; v_credit int; v_id uuid;
begin
  select * into sub from public.subscriptions where salon_id = p_salon;

  select count(*) filter (where c.billable or c.reason = 'over_cap'),
         count(*) filter (where c.billable)
    into v_counted, v_billed
    from public.seat_census(p_salon, sub.chair_cap) c;

  -- a year_extra bills only the chairs the term has not already paid for
  v_seats := case when p_kind = 'year_extra' then greatest(v_billed - p_paid_seats, 0)
                  else v_billed end;
  v_sms_charge := case when sub.sms_unit_price_cents is null then 0
                       else greatest(p_sms_used - sub.sms_included, 0) * sub.sms_unit_price_cents end;
  v_gross := v_seats * sub.unit_price_cents * p_months + v_sms_charge;

  -- §3: a month with no billable chair is no invoice at all, not a 0 DH one
  if v_gross = 0 then return null; end if;

  v_credit := least(greatest(public.subscription_credit_cents(p_salon), 0), v_gross);

  insert into public.subscription_invoices
    (salon_id, cycle, kind, period_start, period_end, counted_at,
     seats_counted, seats_billed, unit_price_cents, months,
     sms_month, sms_used, sms_included, sms_unit_price_cents, sms_charged_cents,
     credit_cents, total_cents)
  values
    (p_salon, sub.cycle, p_kind, p_start, p_end, p_at,
     v_counted, v_seats, sub.unit_price_cents, p_months,
     p_sms_month, p_sms_used, sub.sms_included, sub.sms_unit_price_cents, v_sms_charge,
     v_credit, v_gross - v_credit)
  returning id into v_id;

  if v_credit > 0 then
    insert into public.subscription_credits (salon_id, amount_cents, reason, spent_on)
    values (p_salon, -v_credit,
            'Used on the ' || to_char(p_start, 'FMMonth YYYY') || ' invoice', v_id);
  end if;

  -- OSB-01's list, frozen: every member, billed or not, with the reason
  insert into public.subscription_seats (invoice_id, barber_id, name_snapshot, billable, reason, sort)
  select v_id, c.barber_id, c.name,
         c.billable and not (p_kind = 'year_extra' and c.sort <= p_paid_seats),
         case when c.billable and p_kind = 'year_extra' and c.sort <= p_paid_seats
              then 'paid_this_term' else c.reason end,
         c.sort
    from public.seat_census(p_salon, sub.chair_cap) c;

  return v_id;
end $$;
revoke all on function public.issue_invoice(uuid, text, date, date, timestamptz, int, int, date, int)
  from public, anon, authenticated;

-- the seats a yearly term has already paid for, across its invoices
create or replace function public.term_paid_seats(p_salon uuid, p_from date)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(seats_billed), 0)::int
    from public.subscription_invoices
   where salon_id = p_salon and kind in ('year', 'year_extra')
     and period_start >= p_from
     and (closed_reason is null or closed_reason = 'written_off');
$$;
revoke all on function public.term_paid_seats(uuid, date) from public, anon, authenticated;

-- ---- 7 · the run -------------------------------------------------------------
-- §4. Two events, both idempotent:
--   the 1st's count — once per month per shop, even when it finds nobody
--   a yearly renewal — on the day the term ends
create or replace function public.bill_salon(p_salon uuid, p_at timestamptz default now())
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  sub public.subscriptions%rowtype;
  v_today date := public.casa_day(p_at);
  v_month date := date_trunc('month', public.casa_day(p_at))::date;
  v_prev date := (date_trunc('month', public.casa_day(p_at)) - interval '1 month')::date;
  v_sms int;
  v_inv uuid; v_renewed uuid; v_counted int;
  pv record;
begin
  select * into sub from public.subscriptions where salon_id = p_salon for update;
  if sub.salon_id is null or sub.cancelled_at is not null then return null; end if;

  -- a yearly term that has run out renews, counted today
  if sub.cycle = 'yearly' and v_today >= sub.renews_on then
    update public.subscriptions
       set started_on = sub.renews_on, renews_on = (sub.renews_on + interval '12 months')::date
     where salon_id = p_salon
     returning * into sub;
    v_renewed := public.issue_invoice(p_salon, 'year', sub.started_on,
                   (sub.renews_on - 1), p_at, 0, 12);
  end if;

  if exists (select 1 from public.subscription_counts where salon_id = p_salon and month = v_month)
     or sub.started_on > v_today then
    return json_build_object('renewed', v_renewed, 'invoice', null);
  end if;

  -- WEB-05 / WEB-06 "June": the month that just ended, if nobody sat in a chair
  -- all month, is not billed. A monthly invoice only — a year is prepaid.
  for pv in select i.id from public.subscription_invoices i
             where i.salon_id = p_salon and i.kind = 'month'
               and i.period_start = v_prev and i.closed_reason is null
  loop
    if public.salon_booked_between(p_salon, v_prev, v_month) = 0 then
      perform public.close_invoice(pv.id, 'no_bookings', null);
    end if;
  end loop;

  -- the month just ended's SMS rides on this invoice: one number, one line
  v_sms := public.salon_sms_sent(p_salon, v_prev, v_month);

  if sub.cycle = 'monthly' then
    if sub.started_on <= v_month then
      v_inv := public.issue_invoice(p_salon, 'month', v_month,
                 (v_month + interval '1 month' - interval '1 day')::date, p_at,
                 0, 1, v_prev, v_sms);
    end if;
  elsif not exists (select 1 from public.subscription_invoices
                     where salon_id = p_salon and kind = 'year' and period_start = v_month) then
    -- chairs added since the term started, for the whole months left in it
    v_inv := public.issue_invoice(p_salon, 'year_extra', v_month, (sub.renews_on - 1), p_at,
               public.term_paid_seats(p_salon, sub.started_on),
               public.whole_months(v_month, sub.renews_on), v_prev, v_sms);
  end if;

  select count(*) filter (where c.billable or c.reason = 'over_cap') into v_counted
    from public.seat_census(p_salon, sub.chair_cap) c;
  insert into public.subscription_counts (salon_id, month, counted_at, seats_counted, invoice_id)
  values (p_salon, v_month, p_at, v_counted, v_inv);

  return json_build_object('renewed', v_renewed, 'invoice', v_inv);
end $$;
revoke all on function public.bill_salon(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.run_subscription_billing(p_at timestamptz default now())
returns int
language plpgsql security definer set search_path = ''
as $$
declare s record; n int := 0; r json;
begin
  for s in select salon_id from public.subscriptions where cancelled_at is null order by salon_id loop
    r := public.bill_salon(s.salon_id, p_at);
    if r is not null and (r->>'invoice' is not null or r->>'renewed' is not null) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.run_subscription_billing(timestamptz) from public, anon, authenticated;

-- §4: "Cron 1st, 00:05 Africa/Casablanca". pg_cron speaks UTC and Casablanca
-- moves to UTC+0 for Ramadan, so it runs daily just after midnight UTC — 01:05
-- in Tangier most of the year — and the count's own guard makes every day but
-- the 1st a no-op. A missed 1st counts on the 2nd instead of never.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sterncut-subscriptions', '5 0 * * *',
      'select public.run_subscription_billing()');
  else
    raise notice 'pg_cron not installed - subscription invoices will not be issued until it is, '
      'or until ops runs admin_run_billing() by hand.';
  end if;
end $$;

-- ops' hand on the same run
create or replace function public.admin_run_billing()
returns int
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Billing is ops only'; end if;
  return public.run_subscription_billing(now());
end $$;
revoke execute on function public.admin_run_billing() from public, anon;
grant execute on function public.admin_run_billing() to authenticated;

-- Starting to charge a shop is a decision, so it is an act with a name on it.
-- p_salon null = every live shop that has no subscription yet. The first bill is
-- the 1st on or after p_from (default: next month), at today's list price.
create or replace function public.admin_start_billing(p_salon uuid default null, p_from date default null)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  ps public.platform_settings%rowtype;
  v_from date;
  n int;
begin
  if not public.is_admin() then raise exception 'Billing is ops only'; end if;
  select * into ps from public.platform_settings limit 1;
  v_from := coalesce(p_from, (date_trunc('month', public.casa_day()) + interval '1 month')::date);
  v_from := case when extract(day from v_from) = 1 then v_from
                 else (date_trunc('month', v_from) + interval '1 month')::date end;

  insert into public.subscriptions
    (salon_id, cycle, unit_price_cents, chair_cap, sms_included, sms_unit_price_cents,
     started_on, created_by)
  select s.id, 'monthly', ps.sub_monthly_cents, ps.sub_chair_cap, ps.sub_sms_included,
         ps.sub_sms_unit_cents, v_from, auth.uid()
    from public.salons s
   where s.status = 'live' and (p_salon is null or s.id = p_salon)
     and not exists (select 1 from public.subscriptions x where x.salon_id = s.id);
  get diagnostics n = row_count;

  insert into public.settings_changes (changed_by, before, after, note)
  values (auth.uid(), json_build_object('billing', 'off'),
          json_build_object('billing', 'monthly', 'from', v_from, 'salon', p_salon, 'shops', n,
                            'unit_cents', ps.sub_monthly_cents, 'cap', ps.sub_chair_cap),
          'Started billing ' || n || ' shop(s) from ' || v_from);
  return n;
end $$;
revoke execute on function public.admin_start_billing(uuid, date) from public, anon;
grant execute on function public.admin_start_billing(uuid, date) to authenticated;

-- ---- 8 · netting, inside the week ------------------------------------------
-- 0087's guard, with the new column frozen at release like the other four.
create or replace function public.settlement_line_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_state public.settlement_state;
begin
  if tg_op = 'DELETE' then
    if (select state from public.settlement_runs where id = old.run_id) <> 'draft' then
      raise exception 'A released settlement line cannot be deleted - it is a document somebody is holding';
    end if;
    return old;
  end if;

  select state into v_state from public.settlement_runs where id = new.run_id;
  if v_state <> 'draft'
     and (new.run_id <> old.run_id or new.salon_id <> old.salon_id
          or new.direction <> old.direction or new.amount_cents <> old.amount_cents
          or new.hold_cents <> old.hold_cents or new.earned_cents <> old.earned_cents
          or new.carried_cents <> old.carried_cents
          or new.subscription_cents <> old.subscription_cents) then
    raise exception 'The money on a released statement never changes - carry a correction onto the next week';
  end if;
  return new;
end $$;

-- What of a shop's open invoices can come off this week's deposits, oldest
-- first. `p_earned` is the week's deposits net of refunds; nothing is taken past
-- it, so a collection never exceeds our float and a pay-out never flips.
create or replace function public.subscription_netting(p_salon uuid, p_to timestamptz, p_earned int)
returns table (invoice_id uuid, take_cents int, label text, ref text, occurred_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_left int := greatest(coalesce(p_earned, 0), 0); r record; v_take int;
begin
  for r in select i.id, i.kind, i.period_start, i.seats_billed, i.created_at,
                  st.balance_cents - st.pending_cents as open_cents
             from public.subscription_invoices i
             join public.subscription_invoice_state st on st.id = i.id
            where i.salon_id = p_salon and st.status = 'open'
              and i.created_at < p_to
              and st.balance_cents - st.pending_cents > 0
            order by i.period_start, i.created_at
  loop
    exit when v_left <= 0;
    v_take := least(r.open_cents, v_left);
    v_left := v_left - v_take;
    invoice_id := r.id;
    take_cents := v_take;
    label := 'Subscription - '
             || case r.kind when 'year' then 'the year from ' || to_char(r.period_start, 'FMDD FMMonth YYYY')
                            when 'year_extra' then 'chairs added, ' || to_char(r.period_start, 'FMMonth YYYY')
                            else to_char(r.period_start, 'FMMonth YYYY') end
             || ' - ' || r.seats_billed || case when r.seats_billed = 1 then ' chair' else ' chairs' end;
    -- a period, not an invoice number: numbering is finance's (README §8.2)
    ref := 'SUB ' || to_char(r.period_start, 'YYYY-MM');
    occurred_at := r.created_at;
    return next;
  end loop;
end $$;
revoke all on function public.subscription_netting(uuid, timestamptz, int) from public, anon, authenticated;

-- 0088's cut, unchanged apart from the subscription: computed before the line is
-- written, because §2.4 means the header has to contain it.
create or replace function public.admin_cut_run(p_at timestamptz default now())
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_to timestamptz;
  v_from timestamptz;
  v_run uuid;
  s record;
  v_line uuid;
  v_hold int; v_earned int; v_carried int; v_amount int; v_remainder int; v_sub int;
  v_lines int := 0; v_excluded int := 0;
  v_net int;
begin
  if not public.is_admin() then raise exception 'Settlement runs are ops only'; end if;

  v_to := public.settlement_cut(coalesce(p_at, now()));
  if exists (select 1 from public.settlement_runs where covers_to = v_to) then
    raise exception 'Week % has already been cut', public.settlement_week_label(v_to);
  end if;

  v_from := coalesce((select max(covers_to) from public.settlement_runs), v_to - interval '7 days');

  insert into public.settlement_runs (covers_from, covers_to, created_by)
  values (v_from, v_to, auth.uid()) returning id into v_run;

  for s in select sa.id, sa.name, sa.status,
                  coalesce(sa.reviewed_at, sa.created_at) as live_since
             from public.salons sa
            where sa.status in ('live', 'suspended')
            order by sa.name
  loop
    v_net := public.salon_net_cents(s.id);

    if s.status = 'suspended' and v_net < 0 then
      insert into public.settlement_exclusions (run_id, salon_id, reason, amount_cents, told_by)
      values (v_run, s.id, 'suspended', -v_net, auth.uid());
      v_excluded := v_excluded + 1;
      continue;
    end if;
    if s.live_since > v_from then
      insert into public.settlement_exclusions (run_id, salon_id, reason)
      values (v_run, s.id, 'went_live_midweek');
      v_excluded := v_excluded + 1;
      continue;
    end if;

    select coalesce(sum(x.amount_cents) filter (where x.kind = 'float_movement'), 0),
           -coalesce(sum(x.amount_cents) filter (where x.kind in ('deposit_earned', 'refund')), 0),
           coalesce(sum(x.amount_cents) filter (where x.kind = 'carried'), 0)
      into v_hold, v_earned, v_carried
      from public.settlement_items_for(s.id, v_from, v_to) x;

    select coalesce(sum(c.amount_cents), 0) into v_remainder
      from public.settlement_carry_for(s.id, v_to) c;
    v_carried := v_carried + v_remainder;

    -- the month's bill, off the deposits this week earned
    select coalesce(sum(n.take_cents), 0) into v_sub
      from public.subscription_netting(s.id, v_to, v_earned) n;

    v_amount := v_hold - v_earned + v_carried + v_sub;

    insert into public.settlement_lines
      (run_id, salon_id, direction, amount_cents, hold_cents, earned_cents, carried_cents,
       subscription_cents)
    values (v_run, s.id,
            -- cast: a CASE of bare literals is text, and text never casts to the enum.
            -- The shipped cut (0084, 0088) had exactly that and failed on every run.
            (case when v_amount > 0 then 'collect' when v_amount < 0 then 'pay_out'
                  else 'nil' end)::public.settlement_direction,
            v_amount, v_hold, v_earned, v_carried, v_sub)
    returning id into v_line;
    v_lines := v_lines + 1;

    insert into public.statement_items
      (line_id, kind, label, booking_ref, occurred_at, amount_cents, source_week)
    select v_line, x.kind, x.label, x.booking_ref, x.occurred_at, x.amount_cents, x.source_week
      from public.settlement_items_for(s.id, v_from, v_to) x;

    insert into public.statement_items
      (line_id, kind, label, booking_ref, occurred_at, amount_cents, source_week, source_line)
    select v_line, 'carried', c.label, c.booking_ref, c.occurred_at,
           c.amount_cents, c.source_week, c.source_line
      from public.settlement_carry_for(s.id, v_to) c;

    insert into public.statement_items
      (line_id, kind, label, booking_ref, occurred_at, amount_cents, invoice_id)
    select v_line, 'subscription', n.label, n.ref, n.occurred_at, n.take_cents, n.invoice_id
      from public.subscription_netting(s.id, v_to, v_earned) n;
  end loop;

  return json_build_object(
    'run', v_run, 'week', public.settlement_week_label(v_to),
    'covers_from', v_from, 'covers_to', v_to,
    'lines', v_lines, 'excluded', v_excluded);
end $$;
grant execute on function public.admin_cut_run(timestamptz) to authenticated;

-- 0097's release, plus the one act this rail needs: the statement goes out and
-- the invoice is paid by the line on it, in the same transaction.
create or replace function public.admin_release_run(p_run uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  r record; v_bad record; rc record;
  v_collect int; v_pay int; v_shops int; v_unchecked int := 0; v_sub int := 0;
begin
  if not public.is_admin() then raise exception 'Settlement runs are ops only'; end if;

  select * into r from public.settlement_runs where id = p_run;
  if r.id is null then raise exception 'No such run'; end if;
  if r.state <> 'draft' then
    raise exception 'Week % was already released', public.settlement_week_label(r.covers_to);
  end if;

  select * into v_bad from public.settlement_run_imbalance(p_run) limit 1;
  if v_bad.salon is not null then
    raise exception '% says % DH but its lines add to % DH - fix that before releasing',
      v_bad.salon, round(v_bad.line_cents / 100.0), round(v_bad.items_cents / 100.0);
  end if;

  select coalesce(sum(amount_cents) filter (where direction = 'collect'), 0),
         coalesce(-sum(amount_cents) filter (where direction = 'pay_out'), 0),
         count(*)
    into v_collect, v_pay, v_shops
    from public.settlement_lines where run_id = p_run;

  update public.settlement_runs
     set state = 'released', released_at = now(), released_by = auth.uid()
   where id = p_run;

  update public.settlement_lines
     set visit = 'open'
   where run_id = p_run and direction in ('collect', 'pay_out') and visit = 'pending';

  -- OSB-03: the invoice is paid by the statement that carries it
  insert into public.subscription_applications (invoice_id, line_id, method, amount_cents, applied_by)
  select si.invoice_id, si.line_id, 'netted', si.amount_cents, auth.uid()
    from public.statement_items si
    join public.settlement_lines l on l.id = si.line_id
   where l.run_id = p_run and si.kind = 'subscription' and si.invoice_id is not null;
  get diagnostics v_sub = row_count;

  for rc in select x.id from public.settlement_receipts x
              join public.settlement_lines l on l.id = x.line_id
             where l.run_id = p_run and x.verification = 'queued'
  loop
    perform public.escalate_unchecked(rc.id, 'Week '
      || public.settlement_week_label(r.covers_to) || ' was released with it still unchecked.');
    v_unchecked := v_unchecked + 1;
  end loop;

  insert into public.settings_changes (changed_by, before, after, note)
  values (auth.uid(),
          json_build_object('run', p_run, 'week', public.settlement_week_label(r.covers_to),
                            'state', 'draft'),
          json_build_object('run', p_run, 'week', public.settlement_week_label(r.covers_to),
                            'state', 'released', 'shops', v_shops,
                            'collect_cents', v_collect, 'pay_cents', v_pay,
                            'unchecked', v_unchecked, 'subscriptions', v_sub),
          'Released ' || v_shops || ' statements'
          || case when v_unchecked > 0
                  then ' - ' || v_unchecked || ' still unchecked' else '' end);

  return json_build_object('run', p_run, 'week', public.settlement_week_label(r.covers_to),
                           'shops', v_shops, 'collect_cents', v_collect, 'pay_cents', v_pay,
                           'unchecked', v_unchecked, 'subscriptions', v_sub);
end $$;
grant execute on function public.admin_release_run(uuid) to authenticated;

-- What we owe the shop, less what its own bill already took out of it. Without
-- this term a netted invoice would stay "owed" forever and the pay-out check in
-- admin_settle_float would let us hand the same 220 DH over a second time.
create or replace function public.salon_owed_cents(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select (
    coalesce((select sum(h.amount_cents) from public.deposit_holds h
               where h.salon_id = p_salon and h.state = 'to_shop'), 0)
    - coalesce((select sum(w.amount_cents)
                  from public.wallet_transactions w
                  join public.deposit_holds h on h.booking_id = w.booking_id
                 where w.salon_id = p_salon and w.kind = 'deposit_refund'
                   and h.state = 'to_shop'), 0)
    + coalesce((select sum(f.amount_cents) from public.float_settlements f
                 where f.salon_id = p_salon and f.amount_cents < 0), 0)
    - coalesce((select sum(a.amount_cents)
                  from public.subscription_applications a
                  join public.settlement_lines l on l.id = a.line_id
                 where l.salon_id = p_salon and a.method = 'netted'), 0)
  )::int;
$$;

-- 0086's builder, with the fourth section. `subtotal_cents` is still "this
-- week's movement" — the bill is this week's, so it sits above the carried line.
create or replace function public.statement_json(p_line uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'line', l.id,
    'salon', s.name,
    'salon_id', s.id,
    'week', public.settlement_week_label(r.covers_to),
    'ref', public.settlement_week_label(r.covers_to) || '-' || lpad((
             select z.rn::text from (
               select l2.id, row_number() over (order by s2.name) as rn
                 from public.settlement_lines l2
                 join public.salons s2 on s2.id = l2.salon_id
                where l2.run_id = l.run_id) z
              where z.id = l.id), 3, '0'),
    'covers_from', r.covers_from,
    'covers_to', r.covers_to,
    'run_state', r.state,
    'released_at', r.released_at,
    'direction', l.direction,
    'total_cents', abs(l.amount_cents),
    'signed_cents', l.amount_cents,
    'hold_cents', l.hold_cents,
    'earned_cents', l.earned_cents,
    'carried_cents', l.carried_cents,
    'subscription_cents', l.subscription_cents,
    'subtotal_cents', l.hold_cents - l.earned_cents + l.subscription_cents,
    'visit', l.visit,
    'collected_cents', l.collected_cents,
    'open_cents', abs(l.amount_cents) - coalesce(l.collected_cents, 0),
    'settled_at', l.settled_at,
    'receipt_ref', l.receipt_ref,
    'agent', (select full_name from public.profiles where id = l.agent_id),
    'float_lines', coalesce((
      select json_agg(json_build_object('label', i.label, 'ref', i.booking_ref,
                        'at', i.occurred_at, 'cents', i.amount_cents)
             order by i.occurred_at)
        from public.statement_items i
       where i.line_id = l.id and i.kind = 'float_movement'), '[]'::json),
    'earned_lines', coalesce((
      select json_agg(json_build_object('label', i.label, 'ref', i.booking_ref,
                        'at', i.occurred_at, 'cents', i.amount_cents, 'kind', i.kind)
             order by i.kind, i.occurred_at)
        from public.statement_items i
       where i.line_id = l.id and i.kind in ('deposit_earned', 'refund')), '[]'::json),
    -- the month's bill, each with the period and chair count it was issued for
    'subscription_lines', coalesce((
      select json_agg(json_build_object('label', i.label, 'ref', i.booking_ref,
                        'at', i.occurred_at, 'cents', i.amount_cents,
                        'invoice', inv.id, 'invoice_kind', inv.kind,
                        'period_start', inv.period_start, 'seats', inv.seats_billed,
                        'invoice_cents', inv.total_cents)
             order by i.occurred_at)
        from public.statement_items i
        join public.subscription_invoices inv on inv.id = i.invoice_id
       where i.line_id = l.id and i.kind = 'subscription'), '[]'::json),
    'carried_lines', coalesce((
      select json_agg(json_build_object('label', i.label, 'ref', i.booking_ref,
                        'at', i.occurred_at, 'cents', i.amount_cents,
                        'source_week', public.settlement_week_label(i.source_week))
             order by i.occurred_at)
        from public.statement_items i
       where i.line_id = l.id and i.kind = 'carried'), '[]'::json),
    'oldest_at', public.salon_oldest_uncollected_at(l.salon_id),
    'age_days', public.salon_float_age_days(l.salon_id),
    'hold_limit_days', (select float_hold_days from public.platform_settings),
    'last_week', (
      select json_build_object('week', public.settlement_week_label(r2.covers_to),
               'direction', l2.direction, 'total_cents', abs(l2.amount_cents))
        from public.settlement_lines l2
        join public.settlement_runs r2 on r2.id = l2.run_id
       where l2.salon_id = l.salon_id and r2.covers_to < r.covers_to
       order by r2.covers_to desc limit 1)
  )
    from public.settlement_lines l
    join public.settlement_runs r on r.id = l.run_id
    join public.salons s on s.id = l.salon_id
   where l.id = p_line;
$$;
revoke all on function public.statement_json(uuid) from authenticated, anon;

-- 0098's admin_run, with the bill on every line so FIN-14's table still adds up
-- across: hold − earned + carried + bill = one number.
create or replace function public.admin_run(p_run uuid default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare r record;
begin
  if not public.is_admin() then raise exception 'Settlement runs are ops only'; end if;
  select * into r from public.settlement_runs
   where (p_run is null or id = p_run) order by covers_to desc limit 1;
  if r.id is null then return 'null'::json; end if;

  return json_build_object(
    'id', r.id,
    'week', public.settlement_week_label(r.covers_to),
    'state', r.state,
    'covers_from', r.covers_from, 'covers_to', r.covers_to,
    'released_at', r.released_at,
    'released_by', (select full_name from public.profiles where id = r.released_by),

    'collect_cents', coalesce((select sum(amount_cents)::int from public.settlement_lines
                                where run_id = r.id and direction = 'collect'), 0),
    'collect_shops', (select count(*)::int from public.settlement_lines
                       where run_id = r.id and direction = 'collect'),
    'pay_cents', coalesce((select -sum(amount_cents)::int from public.settlement_lines
                            where run_id = r.id and direction = 'pay_out'), 0),
    'pay_shops', (select count(*)::int from public.settlement_lines
                   where run_id = r.id and direction = 'pay_out'),
    'shops', (select count(*)::int from public.settlement_lines where run_id = r.id),
    'planned', (select count(*)::int from public.settlement_visits v
                 join public.settlement_lines l on l.id = v.line_id
                where l.run_id = r.id and v.state <> 'closed'),
    -- AGT-20, on the run itself so the console cannot forget to ask for it
    'proof', public.admin_run_proof(r.id),

    'lines', coalesce((
      select json_agg(json_build_object(
               'id', l.id, 'salon_id', l.salon_id, 'salon', s.name,
               -- the same numbering statement_json prints. 0093/0098 had a bare
               -- row_number() here, inside json_agg — "aggregate function calls
               -- cannot contain window function calls" — hidden only because no
               -- week had ever been cut (the cut failed too; see admin_cut_run).
               'ref', public.settlement_week_label(r.covers_to) || '-'
                      || lpad((select z.rn::text from (
                                 select l2.id, row_number() over (order by s2.name) as rn
                                   from public.settlement_lines l2
                                   join public.salons s2 on s2.id = l2.salon_id
                                  where l2.run_id = l.run_id) z
                                where z.id = l.id), 3, '0'),
               'hold_cents', l.hold_cents, 'earned_cents', l.earned_cents,
               'carried_cents', l.carried_cents, 'amount_cents', l.amount_cents,
               'subscription_cents', l.subscription_cents,
               'direction', l.direction, 'visit', l.visit,
               'collected_cents', l.collected_cents, 'settled_at', l.settled_at,
               'receipt_ref', l.receipt_ref,
               'agent', (select full_name from public.profiles where id = l.agent_id),
               'age_days', public.salon_float_age_days(l.salon_id),
               'on_round', (select coalesce(p2.full_name, 'an agent')
                              from public.settlement_visits v
                              left join public.profiles p2 on p2.id = v.agent_id
                             where v.line_id = l.id and v.state <> 'closed' limit 1),
               'receipts', coalesce((
                 select json_agg(json_build_object(
                          'ref', rc.ref, 'cents', rc.amount_cents,
                          'at', rc.recorded_at, 'verified_by', rc.verified_by,
                          'verification', rc.verification,
                          'incident', rc.incident_ref,
                          -- §8's four words, derived once
                          'state', public.receipt_state(rc.verification, rc.incident_ref,
                                                        rc.duty_notified_at, rc.code_captured_at),
                          'by', coalesce(p3.full_name, 'an agent'))
                        order by rc.recorded_at)
                   from public.settlement_receipts rc
                   left join public.profiles p3 on p3.id = rc.agent_id
                  where rc.line_id = l.id), '[]'::json))
             order by s.name)
        from public.settlement_lines l
        join public.salons s on s.id = l.salon_id
       where l.run_id = r.id), '[]'::json),

    'exclusions', coalesce((
      select json_agg(json_build_object(
               'salon', s.name, 'salon_id', x.salon_id, 'reason', x.reason,
               'amount_cents', x.amount_cents, 'unlocks_on', x.unlocks_on,
               'sentence', public.exclusion_sentence(
                 x.reason, s.name, x.amount_cents, x.unlocks_on,
                 (select full_name from public.profiles where id = x.told_by)))
             order by s.name)
        from public.settlement_exclusions x
        join public.salons s on s.id = x.salon_id
       where x.run_id = r.id), '[]'::json),

    'imbalance', coalesce((
      select json_agg(json_build_object('salon', salon, 'line_cents', line_cents,
                                        'items_cents', items_cents))
        from public.settlement_run_imbalance(r.id)), '[]'::json)
  );
end $$;
grant execute on function public.admin_run(uuid) to authenticated;

-- ---- 9 · the owner's side ----------------------------------------------------
-- One read for OSB-01, -02, -03 and -05. Every number on those screens is a
-- field here or arithmetic on two of them.
create or replace function public.my_subscription()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_salon uuid; v_name text;
  sub public.subscriptions%rowtype;
  ps public.platform_settings%rowtype;
  v_today date := public.casa_day();
  v_month date := date_trunc('month', public.casa_day())::date;
  v_next date := (date_trunc('month', public.casa_day()) + interval '1 month')::date;
  v_cap int;
  v_from timestamptz; v_to timestamptz;
  v_hold int; v_earned int; v_open int;
begin
  select s.id, s.name into v_salon, v_name from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then return json_build_object('salon', null); end if;
  select * into sub from public.subscriptions where salon_id = v_salon;
  select * into ps from public.platform_settings limit 1;
  v_cap := coalesce(sub.chair_cap, ps.sub_chair_cap);

  -- OSB-03's worked example is this week, so far: the same window the Friday cut
  -- will read, stopped at now
  v_to := public.settlement_cut(now()) + interval '7 days';
  v_from := greatest(coalesce((select max(covers_to) from public.settlement_runs),
                              public.settlement_cut(now())), public.settlement_cut(now()));
  select coalesce(sum(x.amount_cents) filter (where x.kind = 'float_movement'), 0),
         -coalesce(sum(x.amount_cents) filter (where x.kind in ('deposit_earned', 'refund')), 0)
    into v_hold, v_earned
    from public.settlement_items_for(v_salon, v_from, now()) x;
  select coalesce(sum(st.balance_cents - st.pending_cents), 0) into v_open
    from public.subscription_invoice_state st
   where st.salon_id = v_salon and st.status = 'open';

  return json_build_object(
    'salon', v_name, 'salon_id', v_salon,
    'today', v_today, 'month', v_month, 'next_count', v_next,
    'subscription', case when sub.salon_id is null then null else json_build_object(
      'cycle', sub.cycle, 'unit_price_cents', sub.unit_price_cents, 'chair_cap', sub.chair_cap,
      'sms_included', sub.sms_included, 'sms_unit_price_cents', sub.sms_unit_price_cents,
      'started_on', sub.started_on, 'renews_on', sub.renews_on,
      'term_seats', case when sub.cycle = 'yearly'
                         then public.term_paid_seats(v_salon, sub.started_on) end,
      'months_left', case when sub.cycle = 'yearly'
                          then public.whole_months(v_next, sub.renews_on) end) end,
    'list', json_build_object('monthly_cents', ps.sub_monthly_cents,
                              'yearly_cents', ps.sub_yearly_cents,
                              'cap', ps.sub_chair_cap, 'sms_included', ps.sub_sms_included,
                              'sms_unit_cents', ps.sub_sms_unit_cents),
    'census', coalesce((
      select json_agg(json_build_object(
               'barber_id', c.barber_id, 'name', c.name, 'billable', c.billable,
               'reason', c.reason, 'is_owner', c.is_owner, 'setting_up', c.setting_up,
               'me', c.barber_id = auth.uid())
             order by c.sort, c.name)
        from public.seat_census(v_salon, v_cap) c), '[]'::json),
    'sms', json_build_object('month', v_month,
             'used', public.salon_sms_sent(v_salon, v_month, v_next),
             'included', coalesce(sub.sms_included, ps.sub_sms_included),
             'unit_cents', coalesce(sub.sms_unit_price_cents, ps.sub_sms_unit_cents)),
    -- OSB-03's amber panel: a shop that takes no deposits has no Friday to net
    'collection', case when public.shop_deposit_pct(v_salon) = 0 then 'agent_cash' else 'float_net' end,
    'credit_cents', public.subscription_credit_cents(v_salon),
    'friday', json_build_object(
      'cut_at', v_to, 'since', v_from,
      'deposits_cents', v_earned, 'float_cents', v_hold,
      'open_cents', v_open,
      'nets_cents', least(v_open, greatest(v_earned, 0))),
    'invoices', coalesce((
      select json_agg(j order by (j->>'period_start') desc, (j->>'created_at') desc)
        from (select json_build_object(
                       'id', i.id, 'kind', i.kind, 'cycle', i.cycle,
                       'period_start', i.period_start, 'period_end', i.period_end,
                       'seats_billed', i.seats_billed, 'seats_counted', i.seats_counted,
                       'unit_price_cents', i.unit_price_cents, 'months', i.months,
                       'sms_used', i.sms_used, 'sms_included', i.sms_included,
                       'sms_charged_cents', i.sms_charged_cents,
                       'credit_cents', i.credit_cents, 'total_cents', i.total_cents,
                       'paid_cents', st.paid_cents, 'balance_cents', st.balance_cents,
                       'status', st.status, 'closed_reason', i.closed_reason,
                       'created_at', i.created_at) as j
                from public.subscription_invoices i
                join public.subscription_invoice_state st on st.id = i.id
               where i.salon_id = v_salon
               order by i.period_start desc, i.created_at desc
               limit 13) q), '[]'::json),
    'credits', coalesce((
      select json_agg(json_build_object('cents', c.amount_cents, 'reason', c.reason,
                                        'at', c.created_at) order by c.created_at desc)
        from public.subscription_credits c where c.salon_id = v_salon), '[]'::json)
  );
end $$;
revoke execute on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;

-- OSB-04: one invoice, walked back to its parts — the chairs by name, the SMS,
-- the credit, what cut it, and the Friday that paid it.
create or replace function public.my_invoice(p_invoice uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare i public.subscription_invoices%rowtype;
begin
  select * into i from public.subscription_invoices where id = p_invoice;
  if i.id is null or not exists (select 1 from public.salons s
                                  where s.id = i.salon_id and s.owner_id = auth.uid()) then
    raise exception 'Not your invoice';
  end if;
  return (
    select json_build_object(
      'id', i.id, 'salon', (select name from public.salons where id = i.salon_id),
      'kind', i.kind, 'cycle', i.cycle,
      'period_start', i.period_start, 'period_end', i.period_end, 'counted_at', i.counted_at,
      'seats_counted', i.seats_counted, 'seats_billed', i.seats_billed,
      'unit_price_cents', i.unit_price_cents, 'months', i.months,
      'sms_month', i.sms_month, 'sms_used', i.sms_used, 'sms_included', i.sms_included,
      'sms_unit_price_cents', i.sms_unit_price_cents, 'sms_charged_cents', i.sms_charged_cents,
      'credit_cents', i.credit_cents, 'total_cents', i.total_cents,
      'paid_cents', st.paid_cents, 'balance_cents', st.balance_cents, 'status', st.status,
      'closed_reason', i.closed_reason, 'closed_at', i.closed_at,
      -- OSB-04's "1,03 DH per booking": the cuts done in the invoice's own period
      'bookings', public.salon_booked_between(i.salon_id, i.period_start, i.period_end + 1),
      'yearly_unit_cents', (select sub_yearly_cents from public.platform_settings),
      'seats', coalesce((
        select json_agg(json_build_object('name', z.name_snapshot, 'billable', z.billable,
                                          'reason', z.reason) order by z.sort, z.name_snapshot)
          from public.subscription_seats z where z.invoice_id = i.id), '[]'::json),
      'payments', coalesce((
        select json_agg(json_build_object(
                 'method', a.method, 'cents', a.amount_cents, 'at', a.applied_at,
                 'week', public.settlement_week_label(r.covers_to),
                 'direction', l.direction,
                 -- "you received 2 430 DH instead of 2 650 DH": the line, and the
                 -- line as it would have been without the bill on it
                 'line_cents', abs(l.amount_cents),
                 'without_cents', abs(l.amount_cents - l.subscription_cents))
               order by a.applied_at)
          from public.subscription_applications a
          left join public.settlement_lines l on l.id = a.line_id
          left join public.settlement_runs r on r.id = l.run_id
         where a.invoice_id = i.id), '[]'::json))
      from public.subscription_invoice_state st where st.id = i.id);
end $$;
revoke execute on function public.my_invoice(uuid) from public, anon;
grant execute on function public.my_invoice(uuid) to authenticated;

-- OSB-02. Monthly → yearly: this month's invoice is credited and the year is
-- issued today. Yearly → monthly: the unused whole months come back as credit,
-- never cash, and the monthly bill resumes on the next 1st.
create or replace function public.switch_subscription_cycle(p_cycle text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
  sub public.subscriptions%rowtype;
  ps public.platform_settings%rowtype;
  v_today date := public.casa_day();
  v_month date := date_trunc('month', public.casa_day())::date;
  v_next date := (date_trunc('month', public.casa_day()) + interval '1 month')::date;
  v_billed int; v_inv uuid; v_unused int; v_seats int; v_credit int := 0;
  m record;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the owner can change the plan'; end if;
  select * into sub from public.subscriptions where salon_id = v_salon for update;
  if sub.salon_id is null or sub.cancelled_at is not null then
    raise exception 'Your shop is not being billed yet - there is no plan to change';
  end if;
  if p_cycle = sub.cycle then raise exception 'You are already on that plan'; end if;
  -- a year that starts before the first bill would bill days nobody agreed to
  if sub.started_on > v_today then
    raise exception 'Your plan starts on % - you can choose yearly from then',
      to_char(sub.started_on, 'FMDD FMMonth YYYY');
  end if;
  select * into ps from public.platform_settings limit 1;

  if p_cycle = 'yearly' then
    select count(*) filter (where c.billable) into v_billed
      from public.seat_census(v_salon, sub.chair_cap) c;
    if v_billed = 0 then
      raise exception 'No chair on your page is taking bookings - there is nothing to pay for yet';
    end if;
    for m in select id from public.subscription_invoices
              where salon_id = v_salon and kind = 'month' and period_start = v_month
                and closed_reason is null
    loop
      v_credit := v_credit + public.close_invoice(m.id, 'switched_to_yearly', null);
    end loop;
    update public.subscriptions
       set cycle = 'yearly', unit_price_cents = ps.sub_yearly_cents,
           started_on = v_today, renews_on = (v_today + interval '12 months')::date
     where salon_id = v_salon;
    v_inv := public.issue_invoice(v_salon, 'year', v_today,
               ((v_today + interval '12 months')::date - 1), now(), 0, 12);
    return json_build_object('cycle', 'yearly', 'invoice', v_inv, 'credited_cents', v_credit);
  elsif p_cycle = 'monthly' then
    v_unused := public.whole_months(v_next, sub.renews_on);
    v_seats := public.term_paid_seats(v_salon, sub.started_on);
    v_credit := v_unused * v_seats * sub.unit_price_cents;
    if v_credit > 0 then
      insert into public.subscription_credits (salon_id, amount_cents, reason)
      values (v_salon, v_credit,
              'Unused months of your yearly plan - ' || v_unused || ' x ' || v_seats
              || case when v_seats = 1 then ' chair x ' else ' chairs x ' end
              || round(sub.unit_price_cents / 100.0) || ' DH');
    end if;
    update public.subscriptions
       set cycle = 'monthly', unit_price_cents = ps.sub_monthly_cents,
           started_on = v_next, renews_on = null
     where salon_id = v_salon;
    return json_build_object('cycle', 'monthly', 'starts_on', v_next, 'credited_cents', v_credit);
  else
    raise exception 'A plan is monthly or yearly';
  end if;
end $$;
revoke execute on function public.switch_subscription_cycle(text) from public, anon;
grant execute on function public.switch_subscription_cycle(text) to authenticated;

-- ---- 10 · who reads what (§7) ----------------------------------------------
-- The owner reads his shop's invoices and seats; a barber reads nothing — he
-- must never see that he is a 55 DH line. Only definer functions write.
alter table public.subscriptions enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.subscription_seats enable row level security;
alter table public.subscription_counts enable row level security;
alter table public.subscription_credits enable row level security;
alter table public.subscription_applications enable row level security;

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.is_admin() or exists (select 1 from public.salons s
                                       where s.id = subscriptions.salon_id and s.owner_id = auth.uid()));
drop policy if exists subscription_invoices_select on public.subscription_invoices;
create policy subscription_invoices_select on public.subscription_invoices for select to authenticated
  using (public.is_admin() or exists (select 1 from public.salons s
                                       where s.id = subscription_invoices.salon_id and s.owner_id = auth.uid()));
drop policy if exists subscription_seats_select on public.subscription_seats;
create policy subscription_seats_select on public.subscription_seats for select to authenticated
  using (public.is_admin() or exists (select 1 from public.subscription_invoices i
                                       join public.salons s on s.id = i.salon_id
                                      where i.id = subscription_seats.invoice_id and s.owner_id = auth.uid()));
drop policy if exists subscription_counts_select on public.subscription_counts;
create policy subscription_counts_select on public.subscription_counts for select to authenticated
  using (public.is_admin() or exists (select 1 from public.salons s
                                       where s.id = subscription_counts.salon_id and s.owner_id = auth.uid()));
drop policy if exists subscription_credits_select on public.subscription_credits;
create policy subscription_credits_select on public.subscription_credits for select to authenticated
  using (public.is_admin() or exists (select 1 from public.salons s
                                       where s.id = subscription_credits.salon_id and s.owner_id = auth.uid()));
drop policy if exists subscription_applications_select on public.subscription_applications;
create policy subscription_applications_select on public.subscription_applications for select to authenticated
  using (public.is_admin() or exists (select 1 from public.subscription_invoices i
                                       join public.salons s on s.id = i.salon_id
                                      where i.id = subscription_applications.invoice_id and s.owner_id = auth.uid()));

revoke all on public.subscriptions, public.subscription_invoices, public.subscription_seats,
              public.subscription_counts, public.subscription_credits,
              public.subscription_applications from anon;
grant select on public.subscriptions, public.subscription_invoices, public.subscription_seats,
                public.subscription_counts, public.subscription_credits,
                public.subscription_applications to authenticated;

-- the helpers carry no authorisation of their own
revoke execute on function public.billing_append_only() from public, anon, authenticated;
revoke execute on function public.subscription_invoice_guard() from public, anon, authenticated;
revoke execute on function public.subscription_application_check() from public, anon, authenticated;
revoke execute on function public.casa_day(timestamptz) from public, anon;
revoke execute on function public.casa_start(date) from public, anon;
revoke execute on function public.whole_months(date, date) from public, anon;

-- ---- 11 · the arithmetic, as the designs print it ---------------------------
do $$
begin
  -- §0: 55 monthly, 40 yearly, capped at four
  assert least(4, 4) * 5500 = 22000, 'a four-chair shop is 220 DH a month';
  assert least(7, 4) * 5500 = 22000, 'and a seven-chair salon is the same 220 DH';
  assert least(7, 4) * 4000 * 12 = 192000, 'or 1 920 DH for the year';
  assert 22000 * 12 - 192000 = 72000, 'saving 720 DH';
  -- "−27 %": 40 ÷ 55 = 0,727…
  assert round((1 - 4000::numeric / 5500) * 100) = 27, 'the yearly is 27 % off';
  -- "trois mois offerts" rounds DOWN: 12 − 480/55 = 3,27 → 3, never 4
  assert floor(12 - (4000 * 12)::numeric / 5500) = 3, 'three months free, rounded down';
  -- OSB-03: 1 840 held − 220 = 1 620 received
  assert 184000 - least(22000, 184000) = 162000, 'the Friday nets the bill off the deposits';
  -- a quiet week nets what there is and carries the rest
  assert least(22000, 9000) = 9000 and 22000 - 9000 = 13000, 'a 90 DH week pays 90, 130 carries';
  -- OSB-04: 220 DH over 214 bookings is 1,03 DH; the yearly month 160 DH is 0,75
  assert round(22000::numeric / 214 / 100, 2) = 1.03, '1,03 DH a booking';
  assert round(16000::numeric / 214 / 100, 2) = 0.75, '0,75 DH on the yearly';

  -- whole months, rounded down, as OSB-02 and §4 pro-rate
  assert public.whole_months(date '2026-10-01', date '2027-09-18') = 11,
    'October to 18 September is eleven whole months';
  assert public.whole_months(date '2027-02-01', date '2027-09-18') = 7,
    'February to 18 September is seven';
  assert public.whole_months(date '2027-10-01', date '2027-09-18') = 0,
    'and a date past the term leaves nothing';

  -- a line still adds up with the bill on it (OSB-03 as a statement)
  assert 50000 - 184000 + 0 + 22000 = -112000, 'hold 500, earned 1 840, bill 220: pay 1 120';
  assert 300000 - 100000 + 0 + 22000 = 222000, 'hold 3 000, earned 1 000, bill 220: collect 2 220';
  assert 222000 <= 300000, 'and a collection never exceeds our float in the till';
end $$;
