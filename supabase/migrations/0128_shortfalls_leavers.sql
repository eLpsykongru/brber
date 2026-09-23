-- 0128_shortfalls_leavers: where a missing sum lives, how it leaves, and a barber
-- who leaves a shop that still owes him. `design_handoff_billing_rail/`
-- ADDENDUM §10 (2026-09-23) and README §3b — FIN-18b, FIN-19, BAC-10b, BAC-11.
--
-- ---- a shortfall sits on the barber, not the shop ------------------------------
--
-- 0127 recorded a handover gap as cash the outgoing agent owed the SHOP's drawer,
-- which left the shop answerable to Sterncut for it on Friday. §10 decides the
-- other way: the gap is a debt from the barber who handed over, to Sterncut, and
-- "nobody at the shop owes it" unless a write-off says the shop bears it. So:
--
--   · recording what the call agreed opens a `barber_shortfalls` row. From that
--     moment the shop owes Sterncut that much less — `salon_owed_cents` credits
--     it, and the shop's next Friday statement carries it as its own line;
--   · he pays it back by handing it to the shop's current cash agent, who records
--     it (`agent_take_shortfall`). The cash is in the drawer again, the credit
--     goes, the next statement carries it back, and the collection agent takes it
--     on Friday with the shop's code — "collected like any float, with a code";
--   · or it is written off (`cash_writeoffs`, append-only, a note of 20 characters
--     at least, signed by the session's finance signer). bearer 'sterncut': the
--     credit stays, the loss is ours. bearer 'salon': a debit line on the shop's
--     next Friday statement, and inside the shop it comes out of the owner's share
--     of the drawer (the cash it pays is the cash that went missing). Never an
--     individual barber — that is what the shortfall already was. A reversal is a
--     new row with the opposite sign.
--
-- The drawer identity from 0127 still holds with no special case:
--     drawer = salon_net_cents + Σ what the chairs are owed
-- — the credit lowers the first term by exactly what went missing.
--
-- ---- leaving ends membership, never the balance -----------------------------
--
-- A barber's due was already keyed on (barber, shop) and never on membership
-- (0127 `drawer_due_cents`). What changes: the owner may remove a barber the
-- drawer still owes (0127 refused), the day he left is written down
-- (`salon_departures`, by trigger, whatever path moved him), his payout code is
-- per shop, and he can see and collect from a shop he no longer works in —
-- `my_account` answers him with `old_shops` even when he has no shop at all.
-- "They won't pay — tell us" is a support case against that shop.
--
-- Still open (finance, README §8.1): the write-off ceiling / FIN-19 alert
-- threshold. Not invented here — FIN-19 prints last month's total beside this
-- month's instead.

-- ---- 1 · who may sign ---------------------------------------------------------
insert into public.admin_capabilities (key, label, blurb, sort) values
  ('finance_signer', 'Finance signer',
   'Write off a cash shortfall (FIN-18b). Every write-off is logged against the signer.', 7)
on conflict (key) do nothing;

-- ---- 2 · the tables -----------------------------------------------------------
create table if not exists public.barber_shortfalls (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete restrict,
  barber_id uuid not null,
  transfer_id uuid not null unique references public.drawer_transfers (id) on delete restrict,
  amount_cents int not null check (amount_cents > 0),
  opened_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'paid', 'written_off')),
  closed_at timestamptz,
  closed_by uuid,
  constraint shortfall_closed check ((status = 'open') = (closed_at is null))
);
create index if not exists barber_shortfalls_barber_idx on public.barber_shortfalls (barber_id, status);
create index if not exists barber_shortfalls_salon_idx on public.barber_shortfalls (salon_id);
alter table public.barber_shortfalls enable row level security;
revoke all on public.barber_shortfalls from anon, authenticated;

-- what it is never changes; only whether it is still open. open → paid,
-- open → written_off, and back to open only when a write-off is reversed.
create or replace function public.shortfall_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'a shortfall is never deleted'; end if;
  if new.salon_id <> old.salon_id or new.barber_id <> old.barber_id or new.transfer_id <> old.transfer_id
     or new.amount_cents <> old.amount_cents or new.opened_at <> old.opened_at then
    raise exception 'a shortfall''s amount and people are fixed once opened';
  end if;
  if new.status <> old.status and not (
       (old.status = 'open' and new.status in ('paid', 'written_off'))
    or (old.status = 'written_off' and new.status = 'open')) then
    raise exception 'a shortfall cannot go from % to %', old.status, new.status;
  end if;
  return new;
end $$;
drop trigger if exists barber_shortfalls_guard on public.barber_shortfalls;
create trigger barber_shortfalls_guard before update or delete on public.barber_shortfalls
  for each row execute function public.shortfall_guard();

create sequence if not exists public.cash_writeoff_ref_seq start 900;
create table if not exists public.cash_writeoffs (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('WO-' || lpad(nextval('public.cash_writeoff_ref_seq')::text, 4, '0')),
  shortfall_id uuid not null references public.barber_shortfalls (id) on delete restrict,
  salon_id uuid not null references public.salons (id) on delete restrict,
  amount_cents int not null check (amount_cents <> 0),
  bearer text not null check (bearer in ('sterncut', 'salon')),
  note text not null check (length(btrim(note)) >= 20),
  signed_by uuid not null references public.profiles (id),
  signed_at timestamptz not null default now(),
  reverses_id uuid unique references public.cash_writeoffs (id),
  -- a write-off is positive; its reversal is the same amount, negative
  constraint writeoff_sign check ((reverses_id is null) = (amount_cents > 0))
);
create index if not exists cash_writeoffs_signed_idx on public.cash_writeoffs (signed_at);
alter table public.cash_writeoffs enable row level security;
revoke all on public.cash_writeoffs from anon, authenticated;

create or replace function public.writeoffs_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'cash_writeoffs is append-only — reverse a write-off with a new row';
end $$;
drop trigger if exists cash_writeoffs_no_edit on public.cash_writeoffs;
create trigger cash_writeoffs_no_edit before update or delete on public.cash_writeoffs
  for each row execute function public.writeoffs_append_only();

-- the day a barber stopped being in a shop, whatever moved him
create table if not exists public.salon_departures (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  barber_id uuid not null,
  left_at timestamptz not null default now()
);
create index if not exists salon_departures_idx on public.salon_departures (barber_id, salon_id);
alter table public.salon_departures enable row level security;
revoke all on public.salon_departures from anon, authenticated;

create or replace function public.note_departure()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.salon_departures (salon_id, barber_id) values (old.salon_id, old.id);
  return new;
end $$;
drop trigger if exists barbers_note_departure on public.barbers;
create trigger barbers_note_departure after update of salon_id on public.barbers
  for each row when (old.salon_id is not null and old.salon_id is distinct from new.salon_id)
  execute function public.note_departure();

-- "They won't pay — tell us": a case against a shop, not a booking
alter table public.support_cases add column if not exists salon_id uuid references public.salons (id) on delete set null;
alter table public.support_cases drop constraint if exists support_cases_reason_check;
alter table public.support_cases add constraint support_cases_reason_check
  check (reason in ('no_show', 'wrong_amount', 'wrong_service', 'hygiene', 'other',
                    'booking', 'money', 'client', 'app', 'review', 'unpaid_leaver'));

-- a barber can be owed by two shops at once: one live code per (barber, shop)
alter table public.payout_codes drop constraint if exists payout_codes_pkey;
alter table public.payout_codes add constraint payout_codes_pkey primary key (barber_id, salon_id);

-- ---- 3 · words for people -----------------------------------------------------
-- The write-off messages go out in the barber's own language (§10: "FR/AR in
-- prod"). profiles.language (0039) holds fr/ary/ar/en/es; Darija reads the
-- Arabic, as it does in the app (lib/i18n.ts toLang).
create or replace function public.lang_of(p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case when l = 'ary' or l like 'ar%' then 'ar' when l like 'en%' then 'en' else 'fr' end
    from (select lower(coalesce((select p.language from public.profiles p where p.id = p_user), 'fr')) as l) x;
$$;

-- No-break spaces: a plain one splits "3 240" into two runs that an Arabic
-- line then prints backwards, as "240 3".
create or replace function public.dh_text(p_cents int)
returns text
language sql immutable set search_path = ''
as $$
  select replace(to_char(round(abs(coalesce(p_cents, 0)) / 100.0), 'FM999,999,990'), ',', chr(160)) || chr(160) || 'DH';
$$;

create or replace function public.day_month(p_at timestamptz, p_lang text)
returns text
language sql stable set search_path = ''
as $$
  select extract(day from x)::int || ' ' || case p_lang
      when 'fr' then (array['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'])[m]
      when 'ar' then (array['يناير','فبراير','مارس','أبريل','ماي','يونيو','يوليوز','غشت','شتنبر','أكتوبر','نونبر','دجنبر'])[m]
      else (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[m] end
    from (select p_at at time zone 'Africa/Casablanca' as x,
                 extract(month from p_at at time zone 'Africa/Casablanca')::int as m) d;
$$;

-- FIN-18b: "the exact message each barber will receive, rendered from the
-- template before sending". The preview and the sender both call this — there
-- is no second copy of these sentences to drift. p_ref is null in a preview:
-- the reference is only minted when the write-off is signed.
create or replace function public.writeoff_texts(
  p_barber uuid, p_holder uuid, p_owner uuid, p_salon_name text, p_gap int, p_agreed int,
  p_handover_at timestamptz, p_bearer text, p_ref text, p_with_incoming boolean)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_out jsonb := '[]'::jsonb; l text; g text := public.dh_text(p_gap); holder text := public.person_name(p_holder);
begin
  -- the man the gap was on — unless the shop bears it and he IS the shop
  if not (p_bearer = 'salon' and p_owner = p_barber) then
    l := public.lang_of(p_barber);
    v_out := v_out || jsonb_build_object('user', p_barber, 'role', 'outgoing', 'name', public.person_name(p_barber), 'lang', l,
      'title', case l when 'fr' then 'Écart annulé' when 'ar' then 'تم إلغاء الفارق' else 'Written off' end,
      'body', case l
        when 'fr' then 'Sterncut a annulé l''écart de ' || g || ' de votre remise de caisse du '
                       || public.day_month(p_handover_at, l) || '. Vous ne le devez pas.'
                       || case when p_holder <> p_barber then ' ' || holder || ' tient désormais la caisse du salon.' else '' end
                       || coalesce(' Réf. ' || p_ref, '')
        when 'ar' then 'ألغت Sterncut فارق ' || g || ' من تسليم الصندوق يوم '
                       || public.day_month(p_handover_at, l) || '. لست مديناً به.'
                       || case when p_holder <> p_barber then ' ' || holder || ' يحمل صندوق الصالون الآن.' else '' end
                       || coalesce(' المرجع ' || p_ref, '')
        else 'Sterncut has written off the ' || g || ' gap from your drawer handover on '
             || public.day_month(p_handover_at, l) || '. You don''t owe it.'
             || case when p_holder <> p_barber then ' ' || holder || ' now holds the shop''s cash.' else '' end
             || coalesce(' Ref ' || p_ref, '') end);
  end if;

  if p_with_incoming then
    l := public.lang_of(p_holder);
    v_out := v_out || jsonb_build_object('user', p_holder, 'role', 'incoming', 'name', holder, 'lang', l,
      'title', case l when 'fr' then 'Remise close' when 'ar' then 'اكتمل التسليم' else 'Handover closed' end,
      'body', case l
        when 'fr' then 'La remise est close. Vous tenez la caisse du salon à partir de maintenant : ' || public.dh_text(p_agreed) || '.'
        when 'ar' then 'اكتمل التسليم. أنت من يحمل صندوق الصالون من الآن: ' || public.dh_text(p_agreed) || '.'
        else 'The handover is closed. You hold the shop''s cash from now: ' || public.dh_text(p_agreed) || '.' end);
  end if;

  if p_bearer = 'salon' then
    l := public.lang_of(p_owner);
    v_out := v_out || jsonb_build_object('user', p_owner, 'role', 'owner', 'name', public.person_name(p_owner), 'lang', l,
      'title', case l when 'fr' then 'Écart à la charge du salon' when 'ar' then 'فارق على حساب الصالون'
                      else 'Written off — the shop bears it' end,
      'body', case l
        when 'fr' then 'Sterncut a annulé l''écart de ' || g || ' de la remise de caisse du '
                       || public.day_month(p_handover_at, l) || ', à la charge de ' || p_salon_name
                       || ' : il est ajouté à votre prochain règlement du vendredi.' || coalesce(' Réf. ' || p_ref, '')
        when 'ar' then 'ألغت Sterncut فارق ' || g || ' من تسليم الصندوق يوم '
                       || public.day_month(p_handover_at, l) || '، ويتحمله ' || p_salon_name
                       || ': سيُضاف إلى تسويتك القادمة يوم الجمعة.' || coalesce(' المرجع ' || p_ref, '')
        else 'Sterncut has written off the ' || g || ' gap from the drawer handover on '
             || public.day_month(p_handover_at, l) || ', and ' || p_salon_name
             || ' bears it: it is added to your next Friday settlement.' || coalesce(' Ref ' || p_ref, '') end);
  end if;
  return v_out::json;
end $$;

create or replace function public.send_texts(p_texts json, p_cents int)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, amount_cents)
  select (x->>'user')::uuid, 'shop_status'::public.notif_kind, x->>'title', x->>'body', p_cents
    from json_array_elements(p_texts) x
   where x->>'user' is not null;
$$;

-- ---- 4 · the shop is not answerable for a barber's shortfall ---------------------
-- 0123's body, plus the two §10 terms: a shortfall credits the shop until it is
-- paid back into the drawer; a write-off the shop bears takes the credit back.
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
    + coalesce((select sum(sf.amount_cents) from public.barber_shortfalls sf
                 where sf.salon_id = p_salon and sf.status <> 'paid'), 0)
    - coalesce((select sum(w.amount_cents) from public.cash_writeoffs w
                 where w.salon_id = p_salon and w.bearer = 'salon'), 0)
  )::int;
$$;

-- 0087's body, plus the three lines a shortfall puts on the shop's Friday
-- statement — each in the week it happened, like everything else here. They
-- ride as 'carried' so the run folds them in without a new column: a sum from
-- outside the week's own movements, carried onto this statement. Their source
-- week is the handover's (a carried line must name one — 0081).
create or replace function public.settlement_items_for(
  p_salon uuid, p_from timestamptz, p_to timestamptz)
returns table (kind public.statement_kind, label text, booking_ref text,
               occurred_at timestamptz, amount_cents int, source_week timestamptz)
language sql stable security definer set search_path = ''
as $$
  select 'float_movement'::public.statement_kind,
         'Cash top-up taken by ' || coalesce(split_part(p.full_name, ' ', 1), 'a barber'),
         w.ref, w.created_at, w.amount_cents, null::timestamptz
    from public.wallet_transactions w
    left join public.profiles p on p.id = w.created_by
   where w.salon_id = p_salon and w.kind = 'cash_topup'
     and w.created_at >= p_from and w.created_at < p_to

  union all

  select 'deposit_earned', count(*) || ' cuts marked done in the window',
         'STC-' || min(substring(b.ref from 5)::bigint)
         || ' - ' || max(substring(b.ref from 5)::bigint), max(h.resolved_at),
         -sum(h.amount_cents)::int, null
    from public.deposit_holds h
    join public.bookings b on b.id = h.booking_id
   where h.salon_id = p_salon and h.state = 'to_shop'
     and h.resolved_at >= p_from and h.resolved_at < p_to
  having count(*) > 0

  union all

  select 'refund', 'Refund - deposit returned to the customer',
         b.ref, w.created_at, w.amount_cents, null
    from public.wallet_transactions w
    join public.deposit_holds h on h.booking_id = w.booking_id
    join public.bookings b on b.id = w.booking_id
   where w.salon_id = p_salon and w.kind = 'deposit_refund'
     and w.created_at >= p_from and w.created_at < p_to
     and h.state = 'to_shop'
     and h.resolved_at >= p_from and h.resolved_at < p_to

  union all

  select 'carried',
         'Carried from week ' || to_char(public.settlement_cut(h.resolved_at)
                                         at time zone 'Africa/Casablanca', 'IW')
         || ' - refund after settlement',
         b.ref, w.created_at, w.amount_cents,
         public.settlement_cut(h.resolved_at)
    from public.wallet_transactions w
    join public.deposit_holds h on h.booking_id = w.booking_id
    join public.bookings b on b.id = w.booking_id
   where w.salon_id = p_salon and w.kind = 'deposit_refund'
     and w.created_at >= p_from and w.created_at < p_to
     and h.state = 'to_shop'
     and h.resolved_at < p_from
     -- ops may already have placed it by hand (FIN-17)
     and not exists (select 1 from public.statement_items si
                      where si.kind = 'carried' and si.booking_ref = b.ref)

  union all

  -- §10: the gap is on the barber now, so the shop hands over that much less
  select 'carried',
         'Handover ' || t.ref || ' came up short - ' || public.person_name(sf.barber_id) || ' owes it, not the shop',
         t.ref, sf.opened_at, -sf.amount_cents, public.settlement_cut(t.created_at)
    from public.barber_shortfalls sf
    join public.drawer_transfers t on t.id = sf.transfer_id
   where sf.salon_id = p_salon and sf.opened_at >= p_from and sf.opened_at < p_to

  union all

  -- paid back into the drawer: the shop holds it again, and hands it over
  select 'carried',
         'Handover ' || t.ref || ' shortfall paid back into the drawer by ' || public.person_name(sf.barber_id),
         t.ref, sf.closed_at, sf.amount_cents, public.settlement_cut(t.created_at)
    from public.barber_shortfalls sf
    join public.drawer_transfers t on t.id = sf.transfer_id
   where sf.salon_id = p_salon and sf.status = 'paid'
     and sf.closed_at >= p_from and sf.closed_at < p_to

  union all

  -- written off, the shop bears it: a debit line (a reversal is the opposite line)
  select 'carried',
         case when w.reverses_id is null
              then 'Write-off ' || w.ref || ' - the shop bears the handover ' || t.ref || ' shortfall'
              else 'Write-off ' || w.ref || ' - reversal, the shop no longer bears it' end,
         w.ref, w.signed_at, w.amount_cents, public.settlement_cut(t.created_at)
    from public.cash_writeoffs w
    join public.barber_shortfalls sf on sf.id = w.shortfall_id
    join public.drawer_transfers t on t.id = sf.transfer_id
   where w.salon_id = p_salon and w.bearer = 'salon'
     and w.signed_at >= p_from and w.signed_at < p_to;
$$;

-- ---- 5 · FIN-18: recording what the call agreed ----------------------------------
-- The part of 0127's resolve that moves money, shared by "Record & name agent"
-- and by "Write off & send", which completes the transfer the same way.
create or replace function public.resolve_drawer_transfer(p_id uuid, p_agreed_cents int, p_note text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare t record; v_gap int; v_sf uuid;
begin
  select * into t from public.drawer_transfers where id = p_id for update;
  if t.id is null or t.state <> 'mismatch' then raise exception 'That handover is not open'; end if;

  -- on the footing of the two counts: what the drawer held when it was counted.
  -- (0127 measured against the books as they stand now, which is wrong the moment
  -- the outgoing agent pays a chair during the dispute — the call agrees a figure
  -- for the count, not for today.) A payout since then takes the same sum off the
  -- books and off the cash, so after this the books hold exactly what is there.
  v_gap := t.declared_cents - p_agreed_cents;
  if v_gap > 0 then
    -- §10: on the barber who handed over, owed to Sterncut — not the shop's
    insert into public.barber_shortfalls (salon_id, barber_id, transfer_id, amount_cents)
    values (t.salon_id, t.from_id, t.id, v_gap)
    returning id into v_sf;
  elsif v_gap < 0 then
    -- more in the drawer than the books say: the extra is his, and the drawer owes it back
    insert into public.drawer_entries (salon_id, barber_id, agent_id, kind, amount_cents, proof, transfer_id, created_by)
    values (t.salon_id, t.from_id, null, 'handover_gap', v_gap, 'ops_record', t.id, auth.uid());
  end if;

  update public.drawer_transfers
     set state = 'resolved', agreed_cents = p_agreed_cents, resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = btrim(p_note), closed_at = now()
   where id = t.id;
  update public.salons set cash_agent_id = t.to_id, cash_agent_since = now() where id = t.salon_id;

  return json_build_object('gap_cents', v_gap, 'shortfall', v_sf, 'salon', t.salon_id, 'from', t.from_id,
                           'to', t.to_id, 'agreed_cents', p_agreed_cents, 'handover_at', t.created_at, 'ref', t.ref);
end $$;

create or replace function public.admin_resolve_drawer_transfer(p_id uuid, p_agreed_cents int, p_note text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare r json; v_gap int; v_owner uuid; v_from uuid; v_to uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_agreed_cents is null or p_agreed_cents < 0 then raise exception 'Record the figure that was agreed'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Say what the call settled — it is logged against your name'; end if;

  r := public.resolve_drawer_transfer(p_id, p_agreed_cents, p_note);
  v_gap := (r->>'gap_cents')::int;
  v_from := (r->>'from')::uuid;
  v_to := (r->>'to')::uuid;
  select owner_id into v_owner from public.salons where id = (r->>'salon')::uuid;

  insert into public.notifications (user_id, kind, title, body, amount_cents)
  select distinct u, 'shop_status'::public.notif_kind, 'The drawer handover is settled',
         public.person_name(v_to) || ' now holds the shop''s cash, from ' || public.dh_text(p_agreed_cents) || '. '
         || case when v_gap > 0 then public.person_name(v_from) || ' owes Sterncut the other '
                                     || public.dh_text(v_gap) || ' (' || (r->>'ref')
                                     || ') - his to settle, not the shop''s.'
                 when v_gap < 0 then 'The drawer owes ' || public.person_name(v_from) || ' '
                                     || public.dh_text(v_gap) || '.'
                 else 'Nothing was missing.' end,
         p_agreed_cents
    from unnest(array[v_from, v_to, v_owner]) u;
  return json_build_object('state', 'resolved', 'gap_cents', v_gap, 'shortfall', r->>'shortfall');
end $$;

-- ---- 6 · FIN-18b: writing it off ----------------------------------------------------
create or replace function public.write_off_core(p_shortfall uuid, p_bearer text, p_note text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare sf record; w record;
begin
  if p_bearer is null or p_bearer not in ('sterncut', 'salon') then
    raise exception 'Say who loses it: Sterncut or the shop';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 20 then
    raise exception 'Write why, in at least 20 characters — it is logged against your name';
  end if;
  select * into sf from public.barber_shortfalls where id = p_shortfall for update;
  if sf.id is null then raise exception 'No such shortfall'; end if;
  if sf.status <> 'open' then raise exception 'That shortfall is already %', replace(sf.status, '_', ' '); end if;

  insert into public.cash_writeoffs (shortfall_id, salon_id, amount_cents, bearer, note, signed_by)
  values (sf.id, sf.salon_id, sf.amount_cents, p_bearer, btrim(p_note), auth.uid())
  returning * into w;
  update public.barber_shortfalls
     set status = 'written_off', closed_at = now(), closed_by = auth.uid()
   where id = sf.id;
  -- the shop bears it: it hands Sterncut the sum on Friday, but that cash is not in
  -- the drawer — it went missing. So it comes out of the owner's share of the
  -- drawer, which is what "the shop bears it" means inside the shop.
  if p_bearer = 'salon' then
    insert into public.drawer_entries (salon_id, barber_id, agent_id, kind, amount_cents, proof, transfer_id, created_by)
    select sf.salon_id, s.owner_id, null, 'handover_gap', sf.amount_cents, 'ops_record', sf.transfer_id, auth.uid()
      from public.salons s where s.id = sf.salon_id;
  end if;
  return json_build_object('id', w.id, 'ref', w.ref, 'amount_cents', w.amount_cents, 'bearer', w.bearer);
end $$;

create or replace function public.require_signer()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.admin_can('finance_signer') then
    raise exception 'Only a finance signer can write cash off';
  end if;
end $$;

-- from FIN-18 on an open mismatch: the incoming man's count stands, the gap is
-- opened on the man who handed over and written off in the same step
create or replace function public.admin_write_off_transfer(p_transfer uuid, p_bearer text, p_note text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare t record; s record; r json; w json; v_gap int;
begin
  perform public.require_signer();
  if p_bearer is null or p_bearer not in ('sterncut', 'salon') then
    raise exception 'Say who loses it: Sterncut or the shop';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 20 then
    raise exception 'Write why, in at least 20 characters — it is logged against your name';
  end if;
  select * into t from public.drawer_transfers where id = p_transfer;
  if t.id is null or t.state <> 'mismatch' then raise exception 'That handover is not open'; end if;
  v_gap := t.declared_cents - t.counted_cents;
  if v_gap <= 0 then raise exception 'At the counted figure nothing is missing — record it instead'; end if;

  r := public.resolve_drawer_transfer(p_transfer, t.counted_cents, p_note);
  w := public.write_off_core((r->>'shortfall')::uuid, p_bearer, p_note);
  select * into s from public.salons where id = t.salon_id;
  perform public.send_texts(public.writeoff_texts(t.from_id, t.to_id, s.owner_id, s.name, v_gap, t.counted_cents,
                                                  t.created_at, p_bearer, w->>'ref', true), v_gap);
  return json_build_object('state', 'resolved', 'ref', w->>'ref', 'gap_cents', v_gap, 'bearer', p_bearer);
end $$;

-- a shortfall already on a barber's account (the call was recorded earlier)
create or replace function public.admin_write_off_shortfall(p_shortfall uuid, p_bearer text, p_note text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare sf record; s record; t record; w json;
begin
  perform public.require_signer();
  w := public.write_off_core(p_shortfall, p_bearer, p_note);
  select * into sf from public.barber_shortfalls where id = p_shortfall;
  select * into s from public.salons where id = sf.salon_id;
  select * into t from public.drawer_transfers where id = sf.transfer_id;
  perform public.send_texts(public.writeoff_texts(sf.barber_id, public.till_of(sf.salon_id), s.owner_id, s.name,
                                                  sf.amount_cents, t.agreed_cents, t.created_at, p_bearer,
                                                  w->>'ref', false), sf.amount_cents);
  return w;
end $$;

-- "a mistaken write-off is reversed with a new line" — never an edit
create or replace function public.admin_reverse_writeoff(p_writeoff uuid, p_note text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare w record; sf record; t record; r record; l text;
begin
  perform public.require_signer();
  if length(btrim(coalesce(p_note, ''))) < 20 then
    raise exception 'Write why, in at least 20 characters — it is logged against your name';
  end if;
  select * into w from public.cash_writeoffs where id = p_writeoff;
  if w.id is null or w.reverses_id is not null then raise exception 'That is not a write-off that can be reversed'; end if;
  if exists (select 1 from public.cash_writeoffs x where x.reverses_id = w.id) then
    raise exception 'Write-off % is already reversed', w.ref;
  end if;
  insert into public.cash_writeoffs (shortfall_id, salon_id, amount_cents, bearer, note, signed_by, reverses_id)
  values (w.shortfall_id, w.salon_id, -w.amount_cents, w.bearer, btrim(p_note), auth.uid(), w.id)
  returning * into r;
  update public.barber_shortfalls set status = 'open', closed_at = null, closed_by = null
   where id = w.shortfall_id
  returning * into sf;
  if w.bearer = 'salon' then
    insert into public.drawer_entries (salon_id, barber_id, agent_id, kind, amount_cents, proof, transfer_id, created_by)
    select sf.salon_id, s.owner_id, null, 'handover_gap', -w.amount_cents, 'ops_record', sf.transfer_id, auth.uid()
      from public.salons s where s.id = sf.salon_id;
  end if;
  select * into t from public.drawer_transfers where id = sf.transfer_id;

  l := public.lang_of(sf.barber_id);
  insert into public.notifications (user_id, kind, title, body, amount_cents)
  values (sf.barber_id, 'shop_status',
    case l when 'fr' then 'Annulation reprise' when 'ar' then 'تم التراجع عن الإلغاء' else 'Write-off reversed' end,
    case l
      when 'fr' then 'L''annulation ' || w.ref || ' a été reprise. Les ' || public.dh_text(sf.amount_cents)
                     || ' de votre remise de caisse du ' || public.day_month(t.created_at, l) || ' sont de nouveau à votre compte.'
      when 'ar' then 'تم التراجع عن الإلغاء ' || w.ref || '. فارق ' || public.dh_text(sf.amount_cents)
                     || ' من تسليم الصندوق يوم ' || public.day_month(t.created_at, l) || ' عاد إلى حسابك.'
      else 'The write-off ' || w.ref || ' was reversed. The ' || public.dh_text(sf.amount_cents)
           || ' from your drawer handover on ' || public.day_month(t.created_at, l) || ' is on your account again.' end,
    sf.amount_cents);
  return json_build_object('ref', r.ref, 'reverses', w.ref);
end $$;

-- FIN-18b's box before anything is signed: the amount (fixed), the two figures,
-- and each message as it will be sent, in each man's language
create or replace function public.admin_writeoff_preview(p_transfer uuid, p_shortfall uuid, p_bearer text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare t record; sf record; s record; v_gap int; v_holder uuid; v_incoming boolean; v_sf uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_shortfall is not null then
    select * into sf from public.barber_shortfalls where id = p_shortfall;
    if sf.id is null then raise exception 'No such shortfall'; end if;
    select * into t from public.drawer_transfers where id = sf.transfer_id;
    v_sf := sf.id;
    v_gap := sf.amount_cents;
    v_holder := public.till_of(sf.salon_id);
    v_incoming := false;
  else
    select * into t from public.drawer_transfers where id = p_transfer;
    if t.id is null or t.state <> 'mismatch' then raise exception 'That handover is not open'; end if;
    v_gap := t.declared_cents - t.counted_cents;
    v_holder := t.to_id;
    v_incoming := true;
  end if;
  select * into s from public.salons where id = t.salon_id;

  return json_build_object(
    'transfer', t.id, 'ref', t.ref, 'shortfall', v_sf,
    'salon', s.name, 'from_name', public.person_name(t.from_id), 'to_name', public.person_name(t.to_id),
    'declared_cents', t.declared_cents, 'counted_cents', t.counted_cents, 'gap_cents', v_gap,
    'can_sign', public.admin_can('finance_signer'),
    'signer', public.person_name(auth.uid()),
    'messages', case when p_bearer in ('sterncut', 'salon') and v_gap > 0
                     then public.writeoff_texts(t.from_id, v_holder, s.owner_id, s.name, v_gap,
                                                coalesce(t.agreed_cents, t.counted_cents), t.created_at,
                                                p_bearer, null, v_incoming) end);
end $$;

-- a write-off, read-only (FIN-19's rows open it)
create or replace function public.admin_writeoff(p_id uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare w record; sf record; t record; s record; orig record;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into w from public.cash_writeoffs where id = p_id;
  if w.id is null then raise exception 'No such write-off'; end if;
  select * into sf from public.barber_shortfalls where id = w.shortfall_id;
  select * into t from public.drawer_transfers where id = sf.transfer_id;
  select * into s from public.salons where id = w.salon_id;
  select * into orig from public.cash_writeoffs where id = w.reverses_id;
  return json_build_object(
    'id', w.id, 'ref', w.ref, 'amount_cents', w.amount_cents, 'bearer', w.bearer, 'note', w.note,
    'signer', public.person_name(w.signed_by), 'signed_at', w.signed_at,
    'salon', s.name, 'barber', public.person_name(sf.barber_id),
    'transfer_ref', t.ref, 'declared_cents', t.declared_cents, 'counted_cents', t.counted_cents,
    'from_name', public.person_name(t.from_id), 'to_name', public.person_name(t.to_id),
    'reverses_ref', orig.ref,
    'reversed_by', (select json_build_object('ref', x.ref, 'signer', public.person_name(x.signed_by), 'at', x.signed_at)
                      from public.cash_writeoffs x where x.reverses_id = w.id),
    'messages', case when w.reverses_id is null then
                  public.writeoff_texts(sf.barber_id, t.to_id, s.owner_id, s.name, w.amount_cents,
                                        coalesce(t.agreed_cents, t.counted_cents), t.created_at, w.bearer, w.ref, false) end);
end $$;

-- FIN-19: the cash in the shops, and every write-off this month beside it
create or replace function public.admin_cash_in_shops(p_month date default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_from timestamptz; v_to timestamptz; v_prev timestamptz; v_month date;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  v_month := date_trunc('month', coalesce(p_month, (now() at time zone 'Africa/Casablanca')::date))::date;
  v_from := v_month::timestamp at time zone 'Africa/Casablanca';
  v_to := (v_month + interval '1 month')::timestamp at time zone 'Africa/Casablanca';
  v_prev := (v_month - interval '1 month')::timestamp at time zone 'Africa/Casablanca';

  return json_build_object(
    'month', v_month,
    'held_cents', (select coalesce(sum(greatest(public.salon_net_cents(s.id), 0)), 0)
                     from public.salons s where s.status in ('live', 'suspended')),
    'shops', (select coalesce(json_agg(x order by x.drawer_cents desc, x.name), '[]'::json) from (
                select s.id, s.name, public.person_name(public.till_of(s.id)) as agent,
                       public.drawer_cents(s.id) as drawer_cents,
                       (select coalesce(sum(d.due_cents), 0) from public.drawer_dues(s.id) d
                         where d.due_cents > 0) as owed_cents
                  from public.salons s where s.status in ('live', 'suspended')) x),
    'writeoffs', (select coalesce(json_agg(json_build_object(
                    'id', r.id, 'ref', r.ref, 'salon', r.salon, 'barber', r.barber, 'at', r.signed_at,
                    'signer', r.signer, 'bearer', r.bearer, 'amount_cents', r.amount_cents,
                    'reversal', r.reversal, 'running_cents', r.running)
                    order by r.signed_at, r.ref), '[]'::json)
                    from (select w.id, w.ref, s.name as salon, public.person_name(sf.barber_id) as barber,
                                 w.signed_at, public.person_name(w.signed_by) as signer, w.bearer, w.amount_cents,
                                 w.reverses_id is not null as reversal,
                                 sum(w.amount_cents) over (order by w.signed_at, w.ref) as running
                            from public.cash_writeoffs w
                            join public.barber_shortfalls sf on sf.id = w.shortfall_id
                            join public.salons s on s.id = w.salon_id
                           where w.signed_at >= v_from and w.signed_at < v_to) r),
    'month_cents', (select coalesce(sum(amount_cents), 0) from public.cash_writeoffs
                     where signed_at >= v_from and signed_at < v_to),
    'sterncut_cents', (select coalesce(sum(amount_cents), 0) from public.cash_writeoffs
                        where signed_at >= v_from and signed_at < v_to and bearer = 'sterncut'),
    'salon_cents', (select coalesce(sum(amount_cents), 0) from public.cash_writeoffs
                     where signed_at >= v_from and signed_at < v_to and bearer = 'salon'),
    'last_month_cents', (select coalesce(sum(amount_cents), 0) from public.cash_writeoffs
                          where signed_at >= v_prev and signed_at < v_from));
end $$;

-- 0127's FIN-18 reads, now carrying the shortfall and who may sign
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
             'shortfall_status', sf.status,
             'at', t.created_at, 'counted_at', t.counted_at, 'closed_at', t.closed_at,
             'count_requested_at', t.count_requested_at)
           order by (t.state = 'mismatch') desc, (sf.status = 'open') desc nulls last, t.created_at desc)
      from public.drawer_transfers t
      join public.salons s on s.id = t.salon_id
      left join public.barber_shortfalls sf on sf.transfer_id = t.id
     where t.state in ('pending', 'mismatch')
        or (t.state = 'resolved' and (t.resolved_at > now() - interval '30 days' or sf.status = 'open'))), '[]'::json);
end $$;

create or replace function public.admin_drawer_transfer(p_id uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare t record; s record; v_since timestamptz; sf record; w record;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into t from public.drawer_transfers where id = p_id;
  if t.id is null then raise exception 'No such transfer'; end if;
  select * into s from public.salons where id = t.salon_id;
  select * into sf from public.barber_shortfalls where transfer_id = t.id;
  select * into w from public.cash_writeoffs x
   where x.shortfall_id = sf.id and x.reverses_id is null
     and not exists (select 1 from public.cash_writeoffs y where y.reverses_id = x.id)
   order by x.signed_at desc limit 1;
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
    'books', json_build_object(
               'since', v_since,
               'topups', (select count(*) from public.wallet_transactions x
                           where x.salon_id = s.id and x.kind = 'cash_topup'
                             and (v_since is null or x.created_at > v_since)),
               'topups_cents', (select coalesce(sum(x.amount_cents), 0) from public.wallet_transactions x
                                 where x.salon_id = s.id and x.kind = 'cash_topup'
                                   and (v_since is null or x.created_at > v_since)),
               'topups_by_him', (select count(*) from public.wallet_transactions x
                                  where x.salon_id = s.id and x.kind = 'cash_topup' and x.created_by = t.from_id
                                    and (v_since is null or x.created_at > v_since)),
               'paid_out_cents', (select coalesce(sum(e.amount_cents), 0) from public.drawer_entries e
                                   where e.salon_id = s.id and e.kind = 'payout'
                                     and (v_since is null or e.created_at > v_since)),
               'sterncut_cents', public.salon_net_cents(s.id),
               'drawer_cents', public.drawer_cents(s.id)),
    'dues', (select coalesce(json_agg(json_build_object('name', public.person_name(d.barber_id),
               'cents', d.due_cents) order by d.due_cents desc), '[]'::json)
               from public.drawer_dues(s.id) d where d.due_cents <> 0),
    'shortfall', case when sf.id is null then null else json_build_object(
               'id', sf.id, 'cents', sf.amount_cents, 'status', sf.status, 'opened_at', sf.opened_at,
               'closed_at', sf.closed_at, 'barber', public.person_name(sf.barber_id),
               'writeoff', case when w.id is null then null else json_build_object(
                  'id', w.id, 'ref', w.ref, 'bearer', w.bearer, 'signer', public.person_name(w.signed_by),
                  'at', w.signed_at) end) end,
    'can_sign', public.admin_can('finance_signer'),
    'at', t.created_at, 'counted_at', t.counted_at, 'closed_at', t.closed_at,
    'count_requested_at', t.count_requested_at,
    'count_requested_by', case when t.count_requested_by is null then null else public.person_name(t.count_requested_by) end,
    'agreed_cents', t.agreed_cents, 'resolution_note', t.resolution_note,
    'resolved_by', case when t.resolved_by is null then null else public.person_name(t.resolved_by) end,
    'resolved_at', t.resolved_at);
end $$;

-- ---- 7 · the shop's side: paying a shortfall back, and who is owed ---------------------
-- He hands it to whoever holds the shop's drawer now; that man records it. The
-- cash is Sterncut's again, in the drawer, and goes on the Friday line.
create or replace function public.agent_take_shortfall(p_shortfall uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare sf record; t record;
begin
  select * into sf from public.barber_shortfalls where id = p_shortfall for update;
  if sf.id is null then raise exception 'No such shortfall'; end if;
  if public.till_of(sf.salon_id) is distinct from auth.uid() then
    raise exception 'Only the shop''s cash agent takes cash into the drawer';
  end if;
  if sf.barber_id = auth.uid() then
    raise exception 'Somebody else has to take it — you cannot record your own payment';
  end if;
  if sf.status <> 'open' then raise exception 'That shortfall is already %', replace(sf.status, '_', ' '); end if;
  if exists (select 1 from public.drawer_transfers x
              where x.salon_id = sf.salon_id and x.state in ('pending', 'mismatch')) then
    raise exception 'The drawer is changing hands — take it once the new agent has counted it';
  end if;
  update public.barber_shortfalls set status = 'paid', closed_at = now(), closed_by = auth.uid()
   where id = sf.id;
  select * into t from public.drawer_transfers where id = sf.transfer_id;
  insert into public.notifications (user_id, kind, title, body, amount_cents)
  values (sf.barber_id, 'shop_status', 'Shortfall paid back',
          public.person_name(auth.uid()) || ' took ' || public.dh_text(sf.amount_cents)
          || ' from you into the drawer for the ' || t.ref || ' shortfall. You owe nothing on it now.',
          sf.amount_cents);
  return json_build_object('ok', true, 'cents', sf.amount_cents);
end $$;

-- open shortfalls in a shop, for the owner's and the agent's screens
create or replace function public.shortfalls_in(p_salon uuid, p_except uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', sf.id, 'barber', sf.barber_id, 'name', public.person_name(sf.barber_id),
           'cents', sf.amount_cents, 'owes_cents', sf.amount_cents, 'at', sf.opened_at, 'ref', t.ref)
           order by sf.opened_at), '[]'::json)
    from public.barber_shortfalls sf
    join public.drawer_transfers t on t.id = sf.transfer_id
   where sf.salon_id = p_salon and sf.status = 'open'
     and (p_except is null or sf.barber_id <> p_except);
$$;

-- 0127's OBR-07/08 read; 'gaps' are the shop's open shortfalls now
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
    'gaps', public.shortfalls_in(s.id, null)
  );
end $$;

-- 0127's BAC-10, with BAC-10b: a man who has left stays in the list with the day
-- he left, and the shortfalls the agent can take back into the drawer
create or replace function public.my_drawer()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_salon uuid; v_net int; v_from timestamptz;
begin
  v_salon := public.my_till_salon();
  if v_salon is null then return json_build_object('salon', null); end if;
  v_net := public.salon_net_cents(v_salon);
  select payouts_from into v_from from public.salons where id = v_salon;
  return json_build_object(
    'salon', v_salon,
    'me', auth.uid(),
    'drawer_cents', public.drawer_cents(v_salon),
    'sterncut_cents', v_net,
    'to_pay_cents', (select coalesce(sum(d.due_cents), 0) from public.drawer_dues(v_salon) d
                      where d.due_cents > 0 and d.barber_id <> auth.uid()),
    'my_due_cents', public.drawer_due_cents(v_salon, auth.uid()),
    -- rule 4: a name, a chair, a figure, and a count of cuts — nothing behind it
    'chairs', (select coalesce(json_agg(json_build_object(
                 'barber', d.barber_id, 'name', public.person_name(d.barber_id),
                 'chair', (select b.chair_label from public.barbers b
                            where b.id = d.barber_id and b.salon_id = v_salon),
                 'left_at', case when not exists (select 1 from public.barbers b
                                                   where b.id = d.barber_id and b.salon_id = v_salon
                                                     and b.salon_status = 'approved')
                                 then (select max(x.left_at) from public.salon_departures x
                                        where x.salon_id = v_salon and x.barber_id = d.barber_id) end,
                 'wallet_cuts', (select count(*) from public.barber_ledger l
                                  where l.salon_id = v_salon and l.barber_id = d.barber_id
                                    and l.kind = 'wallet_cut' and l.cleared_at > v_from),
                 'deposits', (select count(*) from public.barber_ledger l
                               where l.salon_id = v_salon and l.barber_id = d.barber_id
                                 and l.kind = 'deposit' and l.cleared_at > v_from),
                 'due_cents', d.due_cents,
                 'last_paid', (select json_build_object('cents', e.amount_cents, 'at', e.created_at)
                                 from public.drawer_entries e
                                where e.salon_id = v_salon and e.barber_id = d.barber_id and e.kind = 'payout'
                                order by e.created_at desc limit 1))
                 order by d.due_cents desc, public.person_name(d.barber_id)), '[]'::json)
                 from public.drawer_dues(v_salon) d
                where d.barber_id <> auth.uid()
                  and (d.due_cents <> 0 or exists (
                        select 1 from public.drawer_entries e
                         where e.salon_id = v_salon and e.barber_id = d.barber_id
                           and e.created_at > now() - interval '7 days'))),
    'shortfalls', public.shortfalls_in(v_salon, auth.uid()),
    'transfer', (select json_build_object('ref', t.ref, 'state', t.state, 'to_name', public.person_name(t.to_id))
                   from public.drawer_transfers t
                  where t.salon_id = v_salon and t.state in ('pending', 'mismatch'))
  );
end $$;

-- 0127's payout, with the payee's code looked up for THIS shop
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
    select * into c from public.payout_codes where barber_id = p_barber and salon_id = v_salon for update;
    if c.code is null or c.issued_at < now() - interval '12 hours' then
      return json_build_object('ok', false, 'reason', 'no_code');
    end if;
    if c.code is distinct from p_code then
      if c.fails + 1 >= 5 then
        delete from public.payout_codes where barber_id = p_barber and salon_id = v_salon;
        insert into public.notifications (user_id, kind, title, body)
        values (p_barber, 'shop_status', 'Your payout code was typed wrong five times',
                'It no longer works. Open "You & Sterncut" for a new one, and only read it out once the cash is in your hand.');
        return json_build_object('ok', false, 'reason', 'spent');
      end if;
      update public.payout_codes set fails = fails + 1 where barber_id = p_barber and salon_id = v_salon;
      return json_build_object('ok', false, 'reason', 'code', 'left', 4 - c.fails);
    end if;
    delete from public.payout_codes where barber_id = p_barber and salon_id = v_salon;
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

-- BAC-09 and BAC-11: his four digits for a shop — his current one by default,
-- or one he has left that still owes him. Keyed on (barber, shop), not membership.
drop function if exists public.my_payout_code();
create or replace function public.my_payout_code(p_salon uuid default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := auth.uid(); v_salon uuid; v_due int; c record; v_till uuid;
begin
  if not exists (select 1 from public.barbers b where b.id = v_me) then
    return json_build_object('code', null);
  end if;
  v_salon := coalesce(p_salon, (select b.salon_id from public.barbers b
                                 where b.id = v_me and b.salon_status = 'approved'));
  if v_salon is null then return json_build_object('code', null); end if;
  v_till := public.till_of(v_salon);
  v_due := public.drawer_due_cents(v_salon, v_me);
  -- the agent pays himself from his own row; a code proves nothing there
  if v_due <= 0 or v_till = v_me then
    return json_build_object('code', null, 'due_cents', v_due);
  end if;

  select * into c from public.payout_codes where barber_id = v_me and salon_id = v_salon;
  if c.code is null or c.issued_at < now() - interval '12 hours' then
    insert into public.payout_codes (barber_id, salon_id, code, issued_at, fails)
    values (v_me, v_salon, lpad((floor(random() * 10000))::int::text, 4, '0'), now(), 0)
    on conflict (barber_id, salon_id) do update
      set code = excluded.code, issued_at = now(), fails = 0;
    select * into c from public.payout_codes where barber_id = v_me and salon_id = v_salon;
  end if;
  return json_build_object('code', c.code, 'due_cents', v_due,
                           'expires_at', c.issued_at + interval '12 hours',
                           'agent', public.person_name(v_till));
end $$;

-- ---- 8 · leaving -------------------------------------------------------------------
-- 0127's remove, without the refusal over what the drawer owes him: leaving ends
-- his membership, never his balance. The agent and a man mid-handover still
-- cannot be removed — the drawer's cash follows them, not the other way round.
create or replace function public.salon_remove_member(p_barber uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid; v_owner uuid;
begin
  select s.id, s.owner_id into v_salon, v_owner from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can remove staff'; end if;
  if p_barber = v_owner then raise exception 'The owner cannot be removed'; end if;
  if p_barber = public.till_of(v_salon) then
    raise exception 'He holds the shop''s cash. Hand the drawer to someone else first, in "Who holds the cash".';
  end if;
  if exists (select 1 from public.drawer_transfers t
              where t.salon_id = v_salon and t.state in ('pending', 'mismatch')
                and p_barber in (t.from_id, t.to_id)) then
    raise exception 'A handover of the drawer involving him is under way';
  end if;
  update public.barbers set
    salon_id = null, salon_status = 'pending', salon_role = 'barber',
    pay_model = 'rent', commission_pct = 55, rent_cents = 0, chair_label = null
  where id = p_barber and salon_id = v_salon;
  if not found then raise exception 'Not a member of your salon'; end if;
end;
$$;

-- every shop that still owes a barber, apart from the one he is in (BAC-11)
create or replace function public.old_shops_of(p_barber uuid, p_except uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'salon_id', s.id, 'salon', s.name, 'cents', x.due,
           'wallet_cuts', (select count(*) from public.barber_ledger l
                            where l.salon_id = s.id and l.barber_id = p_barber
                              and l.kind = 'wallet_cut' and l.cleared_at > s.payouts_from),
           'deposits', (select count(*) from public.barber_ledger l
                         where l.salon_id = s.id and l.barber_id = p_barber
                           and l.kind = 'deposit' and l.cleared_at > s.payouts_from),
           'left_at', (select max(d.left_at) from public.salon_departures d
                        where d.salon_id = s.id and d.barber_id = p_barber),
           -- resolved at read time: whoever holds that drawer today
           'agent', json_build_object(
              'name', public.person_name(public.till_of(s.id)),
              'phone', (select p.phone from public.profiles p where p.id = public.till_of(s.id)),
              'area', s.district,
              'is_me', public.till_of(s.id) = p_barber))
           order by x.due desc), '[]'::json)
    from (select m.salon_id, public.drawer_due_cents(m.salon_id, p_barber) as due
            from (select distinct l.salon_id from public.barber_ledger l
                   where l.barber_id = p_barber and l.direction = 'held_for_him'
                  union
                  select e.salon_id from public.drawer_entries e where e.barber_id = p_barber) m
           where m.salon_id is distinct from p_except) x
    join public.salons s on s.id = x.salon_id
   where x.due > 0;
$$;

create or replace function public.my_shortfalls(p_barber uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', sf.id, 'salon', s.name, 'cents', sf.amount_cents, 'at', sf.opened_at, 'ref', t.ref,
           'handover_at', t.created_at, 'agent', public.person_name(public.till_of(s.id)))
           order by sf.opened_at), '[]'::json)
    from public.barber_shortfalls sf
    join public.drawer_transfers t on t.id = sf.transfer_id
    join public.salons s on s.id = sf.salon_id
   where sf.barber_id = p_barber and sf.status = 'open';
$$;

-- "They won't pay — tell us": a support case against the shop, never a payout by us
create or replace function public.report_unpaid_leaver(p_salon uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_due int; c record; v_left timestamptz; v_name text;
begin
  v_due := public.drawer_due_cents(p_salon, auth.uid());
  if coalesce(v_due, 0) <= 0 then raise exception 'That shop owes you nothing right now'; end if;
  if exists (select 1 from public.barbers b where b.id = auth.uid() and b.salon_id = p_salon
               and b.salon_status = 'approved') then
    raise exception 'You still work there — ask the shop''s cash agent';
  end if;
  select * into c from public.support_cases
   where user_id = auth.uid() and salon_id = p_salon and reason = 'unpaid_leaver' and status = 'open'
   order by created_at desc limit 1;
  if c.id is not null then
    return json_build_object('case_no', c.case_no, 'existing', true);
  end if;
  select max(d.left_at) into v_left from public.salon_departures d
   where d.salon_id = p_salon and d.barber_id = auth.uid();
  select name into v_name from public.salons where id = p_salon;

  insert into public.support_cases (user_id, reason, salon_id, amount_cents, detail)
  values (auth.uid(), 'unpaid_leaver', p_salon, v_due,
          'I left ' || v_name || coalesce(' on ' || public.day_month(v_left, 'en'), '')
          || '. The shop still owes me ' || public.dh_text(v_due) || ' and its cash agent, '
          || public.person_name(public.till_of(p_salon)) || ', has not paid it.')
  returning * into c;
  insert into public.support_messages (case_id, sender_id, body) values (c.id, auth.uid(), c.detail);
  return json_build_object('case_no', c.case_no, 'existing', false);
end $$;

-- 0127's my_account: the same account, plus the shops he left that still owe him,
-- and any shortfall on him. With no shop he is answered too (BAC-11), not turned away.
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
  if me.id is null then
    if not exists (select 1 from public.barbers b where b.id = auth.uid()) then
      return json_build_object('salon', null);
    end if;
    return json_build_object('salon', null,
      'me', public.person_name(auth.uid()),
      'old_shops', public.old_shops_of(auth.uid(), null),
      'shortfalls', public.my_shortfalls(auth.uid()));
  end if;

  v_since := public.barber_account_since(me.salon_id);
  v_till := coalesce(me.cash_agent_id, me.owner_id) = me.id;
  v_owner := me.owner_id = me.id;

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
    'bill_cents', v_bill,
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
    'handover', public.my_drawer_transfer(),
    -- "if he later joins another shop … this card moves into it as a separate row"
    'old_shops', public.old_shops_of(me.id, me.salon_id),
    'shortfalls', public.my_shortfalls(me.id)
  );
end $$;

-- ---- 9 · what 0127 may already have written --------------------------------------------
-- 0127 put a positive handover gap on the outgoing agent's drawer due. Moved to
-- where §10 says it lives: reversed on the drawer, opened as a shortfall. The
-- drawer's figure does not move — his due rises by exactly what the credit takes off.
do $$
declare r record;
begin
  for r in select e.transfer_id, e.salon_id, e.barber_id, sum(e.amount_cents)::int as g
             from public.drawer_entries e
            where e.kind = 'handover_gap'
            group by e.transfer_id, e.salon_id, e.barber_id
           having sum(e.amount_cents) > 0
              and not exists (select 1 from public.barber_shortfalls sf where sf.transfer_id = e.transfer_id)
  loop
    insert into public.drawer_entries (salon_id, barber_id, agent_id, kind, amount_cents, proof, transfer_id)
    values (r.salon_id, r.barber_id, null, 'handover_gap', -r.g, 'ops_record', r.transfer_id);
    insert into public.barber_shortfalls (salon_id, barber_id, transfer_id, amount_cents)
    values (r.salon_id, r.barber_id, r.transfer_id, r.g);
  end loop;
end $$;

-- ---- 10 · grants ------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.lang_of(uuid)', 'public.dh_text(int)', 'public.day_month(timestamptz, text)',
    'public.writeoff_texts(uuid, uuid, uuid, text, int, int, timestamptz, text, text, boolean)',
    'public.send_texts(json, int)', 'public.resolve_drawer_transfer(uuid, int, text)',
    'public.write_off_core(uuid, text, text)', 'public.require_signer()',
    'public.shortfalls_in(uuid, uuid)', 'public.old_shops_of(uuid, uuid)', 'public.my_shortfalls(uuid)',
    'public.note_departure()', 'public.shortfall_guard()', 'public.writeoffs_append_only()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.admin_write_off_transfer(uuid, text, text)', 'public.admin_write_off_shortfall(uuid, text, text)',
    'public.admin_reverse_writeoff(uuid, text)', 'public.admin_writeoff_preview(uuid, uuid, text)',
    'public.admin_writeoff(uuid)', 'public.admin_cash_in_shops(date)',
    'public.admin_resolve_drawer_transfer(uuid, int, text)', 'public.admin_drawer_transfers()',
    'public.admin_drawer_transfer(uuid)', 'public.agent_take_shortfall(uuid)', 'public.cash_agent_state()',
    'public.my_drawer()', 'public.agent_pay(uuid, int, text, text)', 'public.my_payout_code(uuid)',
    'public.salon_remove_member(uuid)', 'public.report_unpaid_leaver(uuid)', 'public.my_account()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---- checked at apply time ----------------------------------------------------------------
do $$
declare v_salon uuid;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    assert not exists (
      select 1 from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public'
         and p.proname in (
           'lang_of', 'dh_text', 'day_month', 'writeoff_texts', 'send_texts', 'resolve_drawer_transfer',
           'write_off_core', 'require_signer', 'shortfalls_in', 'old_shops_of', 'my_shortfalls',
           'admin_write_off_transfer', 'admin_write_off_shortfall', 'admin_reverse_writeoff',
           'admin_writeoff_preview', 'admin_writeoff', 'admin_cash_in_shops', 'admin_resolve_drawer_transfer',
           'admin_drawer_transfers', 'admin_drawer_transfer', 'agent_take_shortfall', 'cash_agent_state',
           'my_drawer', 'agent_pay', 'my_payout_code', 'salon_remove_member', 'report_unpaid_leaver', 'my_account')
         and (p.proacl is null or exists (
               select 1 from aclexplode(p.proacl) a
                where a.privilege_type = 'EXECUTE'
                  and (a.grantee = 0 or a.grantee = 'anon'::regrole)))),
      'every shortfall and leaver function needs a signed-in caller';
  end if;
  assert public.dh_text(324000) = '3' || chr(160) || '240' || chr(160) || 'DH', 'thousands are spaced: ' || public.dh_text(324000);
  assert public.day_month(timestamptz '2026-09-17 19:04+01', 'fr') = '17 sept.', 'French months';
  -- the identity the drawer rests on still holds, with every shortfall counted
  for v_salon in select id from public.salons loop
    assert public.drawer_cents(v_salon) = public.salon_net_cents(v_salon)
      + coalesce((select sum(d.due_cents) from public.drawer_dues(v_salon) d), 0), 'drawer arithmetic';
  end loop;
end $$;
