-- 0124_unpaid: OSB-05, and the three things we never do.
-- `design_handoff_billing_rail/` — ADDENDUM §5 (four short Fridays) and §6.
--
-- §6's ladder is `open → day 15 search_hidden → day 30 bookings_closed`, on the
-- invoice, reversible the moment the balance is 0. §5 and OSB-03 promise
-- something the ladder alone would break: "four Fridays short and we call you
-- BEFORE anything changes on your page". Day 15 comes after two Fridays, not
-- four. Both can only be true one way, so that is how it is built:
--
--   THE LADDER DOES NOT MOVE UNTIL A PERSON HAS CALLED. Ops records the call on
--   the invoice; from then on day 15 hides the shop from search and day 30
--   closes new appointments. Without a call, nothing changes on the page, ever.
--   A bad month is a conversation, not a suspension (OSB-05).
--
-- The dates are counted from the day the invoice was issued: issued 1 October,
-- off search from 15 October, bookings close 31 October — OSB-05's drawn dates.
--
-- The three promises OSB-05 makes in writing, and where the code keeps them:
--   1 · never cancel a client's booking over an owner's bill — the only
--       enforcement is a BEFORE INSERT refusal of NEW appointments; nothing here
--       updates or deletes a booking, and the queue and the barber's own
--       walk-ins still go in.
--   2 · never withhold deposits that are already the shop's — nothing here
--       touches a settlement line. The bill only ever comes off the Friday
--       number by its own amount (0123); an unpaid bill holds nothing back.
--   3 · never delete a shop, its history or its ratings — nothing here deletes;
--       invoices reference the salon ON DELETE RESTRICT.

alter table public.subscription_invoices
  add column if not exists called_at timestamptz,
  add column if not exists called_by uuid references public.profiles (id),
  add column if not exists call_note text,
  add column if not exists cash_requested_at timestamptz;

-- ---- where an invoice is on the ladder -------------------------------------
-- Every Friday since it was issued that it is still open was a short one.
create or replace function public.invoice_short_fridays(p_invoice uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int
    from public.subscription_invoices i
    join public.subscription_invoice_state st on st.id = i.id
    join public.settlement_runs r on r.state <> 'draft' and r.covers_to > i.created_at
   where i.id = p_invoice and st.status = 'open';
$$;
revoke all on function public.invoice_short_fridays(uuid) from public, anon, authenticated;

create or replace function public.invoice_rung(p_invoice uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
           when st.status <> 'open' then st.status
           when i.called_at is null then 'open'
           when public.casa_day() >= public.casa_day(i.created_at) + 30 then 'bookings_closed'
           when public.casa_day() >= public.casa_day(i.created_at) + 14 then 'search_hidden'
           else 'open' end
    from public.subscription_invoices i
    join public.subscription_invoice_state st on st.id = i.id
   where i.id = p_invoice;
$$;
revoke all on function public.invoice_rung(uuid) from public, anon, authenticated;

-- the shop's worst open invoice
create or replace function public.salon_billing_state(p_salon uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select r from (select public.invoice_rung(i.id) as r
                     from public.subscription_invoices i
                    where i.salon_id = p_salon and i.closed_reason is null) x
     where r in ('search_hidden', 'bookings_closed')
     order by (r = 'bookings_closed') desc limit 1), 'ok');
$$;
revoke all on function public.salon_billing_state(uuid) from public, anon, authenticated;

-- ---- day 15: out of Explore and search, nowhere else -----------------------
-- A computed field PostgREST can filter on: `.eq('in_search', true)`. Explore
-- and Discover ask it; the shop's own link, QR and preview do not, so returning
-- clients keep working (§6).
create or replace function public.in_search(s public.salons)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.salon_billing_state(s.id) not in ('search_hidden', 'bookings_closed');
$$;
revoke execute on function public.in_search(public.salons) from public, anon;
grant execute on function public.in_search(public.salons) to authenticated;

-- ---- day 30: no NEW appointments -------------------------------------------
-- BEFORE triggers run in name order: after fill_booking, the shop floor and the
-- suspended-customer check, before the queue join clears its mark — so a queue
-- join is still recognisable here and still goes in. So does anything the
-- barber enters himself.
create or replace function public.refuse_unpaid_appointment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid;
begin
  if new.customer_id = new.barber_id then return new; end if;
  if current_setting('sterncut.queue_join', true)
     = new.customer_id::text || ':' || new.barber_id::text then
    return new;
  end if;
  select salon_id into v_salon from public.barbers where id = new.barber_id;
  if v_salon is not null and public.salon_billing_state(v_salon) = 'bookings_closed' then
    raise exception 'This shop is not taking new appointments in the app right now. You can still walk in and join the queue.';
  end if;
  return new;
end $$;
revoke execute on function public.refuse_unpaid_appointment() from public, anon, authenticated;

drop trigger if exists before_booking_unpaid on public.bookings;
create trigger before_booking_unpaid
  before insert on public.bookings
  for each row execute function public.refuse_unpaid_appointment();

-- ---- the owner's side: OSB-05 ----------------------------------------------
create or replace function public.my_unpaid()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_salon uuid; i record;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then return null; end if;

  select inv.*, st.balance_cents, st.paid_cents
    into i
    from public.subscription_invoices inv
    join public.subscription_invoice_state st on st.id = inv.id
   where inv.salon_id = v_salon and st.status = 'open'
     -- an invoice that has not met a Friday yet is not unpaid, it is new
     and public.invoice_short_fridays(inv.id) > 0
   order by inv.period_start limit 1;
  if i.id is null then return null; end if;

  return json_build_object(
    'invoice', i.id, 'kind', i.kind, 'period_start', i.period_start,
    'total_cents', i.total_cents, 'balance_cents', i.balance_cents, 'paid_cents', i.paid_cents,
    'issued_on', public.casa_day(i.created_at),
    'days', public.casa_day() - public.casa_day(i.created_at),
    'short_fridays', public.invoice_short_fridays(i.id),
    'hidden_on', public.casa_day(i.created_at) + 14,
    'closed_on', public.casa_day(i.created_at) + 30,
    'called', i.called_at is not null,
    'rung', public.invoice_rung(i.id),
    'cash_requested_at', i.cash_requested_at,
    'others', (select count(*) from public.subscription_invoices x
                join public.subscription_invoice_state s2 on s2.id = x.id
               where x.salon_id = v_salon and s2.status = 'open' and x.id <> i.id));
end $$;
revoke execute on function public.my_unpaid() from public, anon;
grant execute on function public.my_unpaid() to authenticated;

-- "PAY 220 DH IN CASH TO THE AGENT" — the owner asks; ops sends someone and
-- records it with admin_record_subscription_cash. Asking moves no money.
create or replace function public.request_subscription_collection()
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid; v_inv uuid; v_cents int;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the owner can ask'; end if;
  select inv.id, st.balance_cents into v_inv, v_cents
    from public.subscription_invoices inv
    join public.subscription_invoice_state st on st.id = inv.id
   where inv.salon_id = v_salon and st.status = 'open'
   order by inv.period_start limit 1;
  if v_inv is null then raise exception 'Nothing is owed'; end if;
  update public.subscription_invoices set cash_requested_at = coalesce(cash_requested_at, now())
   where id = v_inv;
  return json_build_object('invoice', v_inv, 'balance_cents', v_cents);
end $$;
revoke execute on function public.request_subscription_collection() from public, anon;
grant execute on function public.request_subscription_collection() to authenticated;

-- ---- ops -------------------------------------------------------------------
-- §5: "four consecutive short settlements → ops task, human call". The call is
-- recorded with what was said, and it is what lets the ladder move.
create or replace function public.admin_log_billing_call(p_invoice uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Ops only'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Write down what was said on the call'; end if;
  update public.subscription_invoices
     set called_at = now(), called_by = auth.uid(), call_note = btrim(p_note)
   where id = p_invoice and closed_reason is null;
  if not found then raise exception 'No open invoice with that id'; end if;
end $$;
revoke execute on function public.admin_log_billing_call(uuid, text) from public, anon;
grant execute on function public.admin_log_billing_call(uuid, text) to authenticated;

-- §5's agent_cash path: a shop with no Friday to net against pays the agent,
-- and ops marks it applied. Refused while a draft statement already carries the
-- invoice, or the same money would be counted on Friday as well.
create or replace function public.admin_record_subscription_cash(p_invoice uuid, p_cents int, p_note text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare st record;
begin
  if not public.is_admin() then raise exception 'Ops only'; end if;
  select * into st from public.subscription_invoice_state where id = p_invoice;
  if st.id is null or st.status <> 'open' then raise exception 'That invoice is not open'; end if;
  if st.pending_cents > 0 then
    raise exception 'This week''s draft statement already nets % DH of it - release the week first',
      round(st.pending_cents / 100.0);
  end if;
  if p_cents is null or p_cents <= 0 or p_cents > st.balance_cents then
    raise exception 'Between 1 and % DH', round(st.balance_cents / 100.0);
  end if;
  insert into public.subscription_applications (invoice_id, method, amount_cents, applied_by, note)
  values (p_invoice, 'cash', p_cents, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''));
  return json_build_object('invoice', p_invoice, 'balance_cents', st.balance_cents - p_cents);
end $$;
revoke execute on function public.admin_record_subscription_cash(uuid, int, text) from public, anon;
grant execute on function public.admin_record_subscription_cash(uuid, int, text) to authenticated;

create or replace function public.admin_write_off_invoice(p_invoice uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Ops only'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'A write-off needs a reason'; end if;
  if (select status from public.subscription_invoice_state where id = p_invoice) is distinct from 'open' then
    raise exception 'That invoice is not open';
  end if;
  perform public.close_invoice(p_invoice, 'written_off', p_note);
end $$;
revoke execute on function public.admin_write_off_invoice(uuid, text) from public, anon;
grant execute on function public.admin_write_off_invoice(uuid, text) to authenticated;

-- README §8.5: the ops ledger is not drawn. This is the read it will sit on.
create or replace function public.admin_subscription_ledger()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'invoice', i.id, 'salon', s.name, 'salon_id', s.id,
           'kind', i.kind, 'period_start', i.period_start,
           'total_cents', i.total_cents, 'balance_cents', st.balance_cents,
           'days', public.casa_day() - public.casa_day(i.created_at),
           'short_fridays', public.invoice_short_fridays(i.id),
           'needs_call', public.invoice_short_fridays(i.id) >= 4 and i.called_at is null,
           'called_at', i.called_at, 'call_note', i.call_note,
           'rung', public.invoice_rung(i.id),
           'cash_requested_at', i.cash_requested_at,
           'no_deposits', public.shop_deposit_pct(s.id) = 0)
         order by i.period_start, s.name), '[]'::json)
    from public.subscription_invoices i
    join public.subscription_invoice_state st on st.id = i.id
    join public.salons s on s.id = i.salon_id
   where st.status = 'open' and public.is_admin();
$$;
revoke execute on function public.admin_subscription_ledger() from public, anon;
grant execute on function public.admin_subscription_ledger() to authenticated;

do $$
begin
  -- OSB-05's drawn dates, from an invoice issued on 1 October
  assert date '2026-10-01' + 14 = date '2026-10-15', 'off search on 15 October';
  assert date '2026-10-01' + 30 = date '2026-10-31', 'bookings close on 31 October';
  assert date '2026-10-12' - date '2026-10-01' = 11, 'UNPAID · 11 DAYS on the 12th';
end $$;
