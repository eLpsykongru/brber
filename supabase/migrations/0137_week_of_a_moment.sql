-- 0137_week_of_a_moment: a refund carried "from week 34" that was earned in week 35.
--
-- settlement_cut(t) is the most recent Friday 21:00 at or before t: the cut that has
-- already happened, which is what admin_cut_run needs. 0084, 0087 and 0128 also used it
-- as "the week t falls in". But a run is named after the cut that CLOSES its window —
-- the run covering Fri 21 Aug 21:00 → Fri 28 Aug 21:00 is week 35
-- (settlement_week_label(covers_to)) — so a deposit earned Thu 27 Aug was:
--   · carried onto a later statement as "from week 34" (FIN-17 draws "week 35");
--   · told on the corrections desk with week 34's release time and week 34's collection;
--   · listed as a correction while its own week was still a draft, and never listed when
--     the week before it had not been cut (a shop's first week).
-- The money was always right: amounts, and which statement a refund comes off, never
-- depended on this. Only the week it names, and what the desk shows, were one week early.
--
-- So: one function for "the cut that closes the week t falls in", and the three readers
-- re-emitted with it — their bodies are 0128's and 0087's exactly, nothing else changed.
-- Lines already written keep the week they were stamped with: statement_items are
-- append-only, and a released statement is never edited.
--
-- And 0087's hand carry — FIN-17's "cut the line onto week N" — could never have run: it
-- set the line's direction from a CASE of string literals, which Postgres types as text,
-- and refused: column "direction" is of type settlement_direction but expression is of
-- type text. The one cast is the only other change in this file.
--
-- admin_carry_correction is gated (0133), so its body lives in admin_carry_correction__direct:
-- replacing that keeps the wrapper, the gate and the revoked execute.

-- local arithmetic, so it holds across a change of offset (0081's cut is local too)
create or replace function public.settlement_week_end(p_at timestamptz)
returns timestamptz
language sql stable
as $$
  select ((public.settlement_cut(p_at) at time zone 'Africa/Casablanca') + interval '7 days')
         at time zone 'Africa/Casablanca';
$$;
grant execute on function public.settlement_week_end(timestamptz) to authenticated;

-- 0128's body. The refund's week, and a handover's week, are the run that contains them.
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
         'Carried from week ' || to_char(public.settlement_week_end(h.resolved_at)
                                         at time zone 'Africa/Casablanca', 'IW')
         || ' - refund after settlement',
         b.ref, w.created_at, w.amount_cents,
         public.settlement_week_end(h.resolved_at)
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
         t.ref, sf.opened_at, -sf.amount_cents, public.settlement_week_end(t.created_at)
    from public.barber_shortfalls sf
    join public.drawer_transfers t on t.id = sf.transfer_id
   where sf.salon_id = p_salon and sf.opened_at >= p_from and sf.opened_at < p_to

  union all

  -- paid back into the drawer: the shop holds it again, and hands it over
  select 'carried',
         'Handover ' || t.ref || ' shortfall paid back into the drawer by ' || public.person_name(sf.barber_id),
         t.ref, sf.closed_at, sf.amount_cents, public.settlement_week_end(t.created_at)
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
         w.ref, w.signed_at, w.amount_cents, public.settlement_week_end(t.created_at)
    from public.cash_writeoffs w
    join public.barber_shortfalls sf on sf.id = w.shortfall_id
    join public.drawer_transfers t on t.id = sf.transfer_id
   where w.salon_id = p_salon and w.bearer = 'salon'
     and w.signed_at >= p_from and w.signed_at < p_to;
$$;

-- 0087's body, with the same correction.
create or replace function public.admin_corrections(p_limit int default 20)
returns json
language sql stable security definer set search_path = ''
as $$
  with c as (
    select w.id, w.ref as refund_ref, w.amount_cents, w.created_at as refunded_at,
           b.ref as booking_ref, b.id as booking_id,
           s.id as salon_id, s.name as salon,
           h.resolved_at as cut_done_at,
           -- the week the earning belonged to, and the statement it went out on
           public.settlement_week_end(h.resolved_at) as source_week,
           (select sc.case_no from public.support_cases sc
             where sc.booking_id = b.id order by sc.created_at desc limit 1) as case_no,
           (select l.id from public.settlement_lines l
              join public.settlement_runs r on r.id = l.run_id
             where l.salon_id = s.id and r.covers_to = public.settlement_week_end(h.resolved_at)
             limit 1) as source_line,
           exists (select 1 from public.statement_items si
                    where si.kind = 'carried' and si.booking_ref = b.ref) as landed
      from public.wallet_transactions w
      join public.deposit_holds h on h.booking_id = w.booking_id
      join public.bookings b on b.id = w.booking_id
      join public.salons s on s.id = w.salon_id
     where w.kind = 'deposit_refund' and h.state = 'to_shop'
       -- only refunds whose earning belongs to a week that is already closed:
       -- a same-week refund nets out on its own statement and is not a correction
       and exists (select 1 from public.settlement_runs r
                    where r.covers_to = public.settlement_week_end(h.resolved_at)
                      and r.state <> 'draft')
  )
  select coalesce(json_agg(json_build_object(
           'booking_id', c.booking_id,
           'booking_ref', c.booking_ref,
           'refund_ref', c.refund_ref,
           'salon', c.salon, 'salon_id', c.salon_id,
           'amount_cents', c.amount_cents,
           'case_no', c.case_no,
           'source_week', public.settlement_week_label(c.source_week),
           'landed', c.landed,
           -- §2.8's own words for the line it creates, so the preview and the
           -- statement cannot drift apart
           'label', 'Carried from week '
                    || to_char(c.source_week at time zone 'Africa/Casablanca', 'IW')
                    || ' - refund after settlement',
           'timeline', json_build_array(
             json_build_object('at', c.cut_done_at, 'what',
               'Cut done. ' || round(c.amount_cents / 100.0) || ' DH of deposit released to ' || c.salon || '.'),
             json_build_object('at', (select r.released_at from public.settlement_runs r
                                       where r.covers_to = c.source_week), 'what',
               'Week ' || to_char(c.source_week at time zone 'Africa/Casablanca', 'IW')
               || ' closed and its statement released, that ' || round(c.amount_cents / 100.0)
               || ' DH inside it.'),
             json_build_object('at', (select l.settled_at from public.settlement_lines l
                                       where l.id = c.source_line), 'what',
               coalesce((select coalesce(p.full_name, 'An agent')
                           || case when l.direction = 'pay_out' then ' handed the shop ' else ' collected ' end
                           || round(abs(l.amount_cents) / 100.0) || ' DH. That week is now cash in someone''s hand.'
                           from public.settlement_lines l
                           left join public.profiles p on p.id = l.agent_id
                          where l.id = c.source_line and l.settled_at is not null),
                        'That week has not been visited yet.')),
             json_build_object('at', c.refunded_at, 'what',
               'The customer was refunded ' || round(c.amount_cents / 100.0) || ' DH'
               || coalesce(' on case ' || c.case_no, '')
               || '. The shop was paid for a cut the customer did not pay for.'))
         ) order by c.refunded_at desc), '[]'::json)
    from (select * from c order by refunded_at desc limit greatest(p_limit, 1)) c
   where public.is_admin();
$$;
grant execute on function public.admin_corrections(int) to authenticated;

-- 0087's body, into the gated function's __direct half — with the direction cast.
create or replace function public.admin_carry_correction__direct(p_booking uuid, p_run uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_amount int; v_ref text; v_salon uuid; v_source timestamptz; v_refunded timestamptz;
  v_line uuid; l record;
begin
  if not public.is_admin() then raise exception 'Corrections are ops only'; end if;
  if (select state from public.settlement_runs where id = p_run) is distinct from 'draft' then
    raise exception 'A correction can only be put on a week that has not gone out yet';
  end if;

  select w.amount_cents, b.ref, w.salon_id, public.settlement_week_end(h.resolved_at), w.created_at
    into v_amount, v_ref, v_salon, v_source, v_refunded
    from public.wallet_transactions w
    join public.deposit_holds h on h.booking_id = w.booking_id
    join public.bookings b on b.id = w.booking_id
   where w.booking_id = p_booking and w.kind = 'deposit_refund' and h.state = 'to_shop'
   order by w.created_at desc limit 1;
  if v_ref is null then
    raise exception 'That booking has no refund against an earning the shop kept';
  end if;

  if exists (select 1 from public.statement_items where kind = 'carried' and booking_ref = v_ref) then
    raise exception 'That correction is already on a statement';
  end if;

  select * into l from public.settlement_lines where run_id = p_run and salon_id = v_salon;
  if l.id is null then
    raise exception 'That shop has no line in this run - it was excluded, so there is nothing to carry onto';
  end if;

  insert into public.statement_items
    (line_id, kind, label, booking_ref, occurred_at, amount_cents, source_week)
  values (l.id, 'carried',
          'Carried from week '
          || to_char(v_source at time zone 'Africa/Casablanca', 'IW')
          || ' - refund after settlement',
          v_ref, v_refunded, v_amount, v_source);

  -- the line moves with it, which is only possible because the run is a draft.
  -- §2.4: the header is the sum of the lines, so it cannot stay behind.
  update public.settlement_lines
     set carried_cents = carried_cents + v_amount,
         amount_cents = amount_cents + v_amount,
         direction = case when amount_cents + v_amount > 0 then 'collect'
                          when amount_cents + v_amount < 0 then 'pay_out'
                          else 'nil' end::public.settlement_direction
   where id = l.id;

  return json_build_object('line', l.id, 'ref', v_ref, 'amount_cents', v_amount,
                           'source_week', public.settlement_week_label(v_source));
end $$;

do $$
declare
  v_mid timestamptz := '2026-08-27 18:20:00+01';   -- FIN-17: cut done Thu 27 Aug 18:20
  v_cut timestamptz := '2026-08-28 21:00:00+01';   -- the run that contains it closes here
begin
  assert public.settlement_week_end(v_mid) = v_cut, 'a moment inside a week belongs to the cut that closes it';
  assert public.settlement_week_label(public.settlement_week_end(v_mid)) = '2026-W35', 'and that is week 35, as FIN-17 reads';
  assert public.settlement_week_end(v_cut) = v_cut + interval '7 days', 'the cut instant opens the next window: windows are [from, to)';
  assert public.settlement_week_end(v_cut - interval '1 second') = v_cut, 'a second before the cut is still this week';
end $$;
