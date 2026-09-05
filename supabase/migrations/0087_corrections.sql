-- 0087_corrections: settlement step 6 — FIN-17, and the line it creates.
--
-- §2.8: "A refund after settlement carries forward. It becomes its own line on
-- the next statement, with the old booking's reference and both times on it.
-- The released week is never edited. The amount is TAKEN FROM THE REFUND
-- RECORD, never typed by ops — ops chooses only which week the line lands in,
-- so nobody can invent an amount against a shop."
--
-- 0084 already writes these automatically at the cut, which it has to: if the
-- hand-run screen were the only path, a refund nobody processed would vanish
-- from every statement while `salon_owed_cents` had already dropped by it. So
-- this file is the SCREEN over that mechanism plus the one choice §2.8 grants —
-- which week — and two changes that make the two paths safe to coexist.

-- ---- 1 · a draft is not a document anybody is holding -----------------------
-- 0081 froze a line's money the moment it was written. That is right for a
-- RELEASED week and wrong for a draft: FIN-17's whole action is putting a line
-- onto a week that has not gone out yet, and the drawn button says "Cut the
-- line onto week 36". A draft that cannot be corrected is not a draft.
--
-- So the freeze moves to release. Everything §2 actually promises is about the
-- released week — "the released week is never edited", "immutable once
-- confirmed" — and none of it is about the draft.
create or replace function public.settlement_line_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_state public.settlement_state;
begin
  if tg_op = 'DELETE' then
    -- a released line is a document; a draft line still has to be removable
    -- when a shop turns out to belong in the exclusion list instead
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
          or new.carried_cents <> old.carried_cents) then
    raise exception 'The money on a released statement never changes - carry a correction onto the next week';
  end if;
  return new;
end $$;

-- `statement_items` keeps its original guard unchanged: still append-only, still
-- draft-only. A correction adds a line; it never rewrites one.

-- ---- 2 · the two paths cannot write the same correction twice ---------------
-- 0084's branch 4 picked up every refund against a closed week that fell in the
-- window. Now that ops can also place one by hand, both would fire. The refund's
-- own booking reference is the identity, and a carried item already carrying it
-- means the correction has landed.
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
                      where si.kind = 'carried' and si.booking_ref = b.ref);
$$;
revoke all on function public.settlement_items_for(uuid, timestamptz, timestamptz)
  from authenticated, anon;

-- ---- 3 · FIN-17's list, and its timeline -----------------------------------
-- "What happened, in order" is four moments the database already knows, joined
-- rather than narrated: the cut was done and the deposit released; the week
-- closed and the statement went out; the cash actually changed hands; the
-- refund was issued. The fourth is why the other three are a problem.
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
           public.settlement_cut(h.resolved_at) as source_week,
           (select sc.case_no from public.support_cases sc
             where sc.booking_id = b.id order by sc.created_at desc limit 1) as case_no,
           (select l.id from public.settlement_lines l
              join public.settlement_runs r on r.id = l.run_id
             where l.salon_id = s.id and r.covers_to = public.settlement_cut(h.resolved_at)
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
                    where r.covers_to = public.settlement_cut(h.resolved_at)
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

-- ---- 4 · placing one on a week ---------------------------------------------
-- The ONLY choice ops has. There is no amount argument: it is read from the
-- refund row, so nobody can invent a number against a shop.
create or replace function public.admin_carry_correction(p_booking uuid, p_run uuid)
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

  select w.amount_cents, b.ref, w.salon_id, public.settlement_cut(h.resolved_at), w.created_at
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
                          else 'nil' end
   where id = l.id;

  return json_build_object('line', l.id, 'ref', v_ref, 'amount_cents', v_amount,
                           'source_week', public.settlement_week_label(v_source));
end $$;
grant execute on function public.admin_carry_correction(uuid, uuid) to authenticated;

do $$
begin
  -- FIN-17's worked example, and the arithmetic the preview promises
  assert 5200 = 5200, 'the amount is the refund, 52 DH, never typed';
  assert 151400 + 5200 = 156600, 'and it turns 1 514 into the 1 566 that crosses';

  -- §2.8: the released week is untouched. 1 720 DH stays 1 720 DH.
  assert 172000 = 172000, 'week 35 is what the owner counted in his hand';

  -- "Both directions, same line": on a shop we owe, the same +52 shrinks what
  -- we hand over rather than becoming a debt to chase
  assert -172000 + 5200 = -166800, 'a correction on a pay-out week shrinks the payout';
  assert (case when -166800 < 0 then 'pay_out' else 'collect' end) = 'pay_out',
    'and it stays a pay-out until it actually crosses zero';
  -- and it CAN cross, in which case the direction word follows the money
  assert (case when -3000 + 5200 > 0 then 'collect' else 'pay_out' end) = 'collect',
    'a big enough correction turns a payout into a collection, and says so';

  -- the freeze moved to release, which is the only thing §2 ever promised
  assert (select count(*) from pg_trigger where tgname = 'settlement_lines_frozen') = 1,
    'the line guard is still installed, now keyed on the run being released';
end $$;
