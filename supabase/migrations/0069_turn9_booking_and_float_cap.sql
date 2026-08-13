-- 0069_turn9_booking_and_float_cap: the reads and the one setter turn 9 needs.
--
-- Turn 9 ("Where the row actions were supposed to land") is about three tables
-- that have been decoration: Suspend, Message owner, Settle float and Set float
-- cap had nowhere to go, and Bookings was read-only.
--
-- Most of the verbs already had a backend and nobody had wired them:
--   · suspend/restore a shop  → admin_salon_decide(p_salon, 'suspend'|'restore')
--   · settle the float        → admin_settle_float(salon, amount, ...)
--   · hide a barber           → not a barber flag at all; 0066 derives
--                               `shop_hidden` from the salon, so it is the same
--                               salon verb above
-- Only two things were genuinely missing, and they are what this migration adds.
--
-- 9a's salon payload (admin_salon) is NOT here — it needs the team, the 30-day
-- booking counts, the unmet asks and the last collection, and it is worth its
-- own migration rather than a guess bolted onto this one.

-- ---- 9a · the float cap dial ------------------------------------------------
-- `salons.float_cap_cents` has existed since the float rail landed and nothing
-- could ever change it. The floor is the cash already sitting in the till:
-- 9a says in words that lowering the cap below what the shop is holding "would
-- stop top-ups tonight", so the DB refuses it rather than letting the desk
-- strand a till it cannot top up.
create or replace function public.admin_set_float_cap(p_salon uuid, p_cents int)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_held int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_cents is null or p_cents <= 0 then
    raise exception 'A float cap has to be a positive amount';
  end if;

  select public.salon_float_cents(p_salon) into v_held;
  if v_held is not null and p_cents < v_held then
    raise exception 'That cap is below the % DH already in the till', round(v_held / 100.0);
  end if;

  update public.salons set float_cap_cents = p_cents where id = p_salon;
  if not found then raise exception 'Salon not found'; end if;
end;
$$;
grant execute on function public.admin_set_float_cap(uuid, int) to authenticated;

-- ---- 9b · one booking, end to end -------------------------------------------
-- The Bookings table has been read-only since 1c. This is the row opened: who,
-- the money split, what happened in order, and what ops can still do about it.
-- The wallet figure is the same sum wallet_balance() uses, read for somebody
-- else — an admin cannot call that function on another user's behalf.
create or replace function public.admin_booking(p_booking uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  b record;
  v_refunded int;
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select bk.id, bk.status, bk.created_at, bk.starts_at, bk.notes,
         bk.price_cents, bk.deposit_cents, bk.discount_cents,
         bk.checked_in_at, bk.started_at, bk.completed_at,
         bk.cancelled_at, bk.cancel_reason, bk.cancelled_by,
         bk.customer_id, bk.barber_id,
         sv.name as service_name, sv.duration_min as service_min,
         cp.full_name as customer_name,
         bp.full_name as barber_name,
         sa.id as salon_id, sa.name as salon_name,
         cn.code as coupon_code
    into b
  from public.bookings bk
  join public.services sv on sv.id = bk.service_id
  left join public.profiles cp on cp.id = bk.customer_id
  left join public.profiles bp on bp.id = bk.barber_id
  left join public.barbers bb on bb.id = bk.barber_id
  left join public.salons sa on sa.id = bb.salon_id
  left join public.coupons cn on cn.id = bk.coupon_id
  where bk.id = p_booking;
  if not found then raise exception 'Booking not found'; end if;

  select coalesce(sum(w.amount_cents), 0)::int into v_refunded
  from public.wallet_transactions w
  where w.booking_id = b.id and w.kind = 'deposit_refund';

  select json_build_object(
    'id', b.id,
    'ref', '#' || upper(left(replace(b.id::text, '-', ''), 8)),
    'status', b.status,

    'customer', json_build_object(
      'id', b.customer_id,
      'name', coalesce(b.customer_name, 'Customer'),
      'visits', (select count(*) from public.bookings x
                  where x.customer_id = b.customer_id and x.status = 'completed'),
      'wallet_cents', (select coalesce(sum(w.amount_cents), 0)::int
                         from public.wallet_transactions w where w.user_id = b.customer_id),
      'marks', (select count(*) from public.customer_marks m
                 where m.customer_id = b.customer_id and m.cleared_at is null)),

    'barber', json_build_object(
      'id', b.barber_id,
      'name', coalesce(b.barber_name, 'Barber'),
      'salon', b.salon_name, 'salon_id', b.salon_id,
      'rating', (select round(avg(r.rating)::numeric, 2) from public.reviews r
                  where r.barber_id = b.barber_id and r.state = 'public')),

    -- 9b prints the split and then says Sterncut took no commission: the cash
    -- at the shop is simply what the deposit and any coupon did not cover.
    'money', json_build_object(
      'service', b.service_name, 'duration_min', b.service_min,
      'price_cents', b.price_cents,
      'deposit_cents', b.deposit_cents,
      'deposit_pct', case when b.price_cents > 0
                          then round(b.deposit_cents * 100.0 / b.price_cents)::int else 0 end,
      'discount_cents', coalesce(b.discount_cents, 0),
      'coupon', b.coupon_code,
      'cash_cents', greatest(0, b.price_cents - coalesce(b.discount_cents, 0) - b.deposit_cents)),

    'timeline', (
      select coalesce(json_agg(t.e order by t.at), '[]'::json) from (
        select b.created_at as at, json_build_object(
          'at', b.created_at, 'what', 'Booked',
          'detail', 'deposit ' || round(b.deposit_cents / 100.0) || ' DH taken') as e
        union all
        select b.created_at, json_build_object(
          'at', b.created_at, 'what', 'Note from the customer', 'detail', b.notes)
          where nullif(btrim(coalesce(b.notes, '')), '') is not null
        union all
        select b.checked_in_at, json_build_object(
          'at', b.checked_in_at, 'what', 'Checked in',
          'detail', case when b.checked_in_at <= b.starts_at
                         then round(extract(epoch from (b.starts_at - b.checked_in_at)) / 60)::int || ' min early'
                         else round(extract(epoch from (b.checked_in_at - b.starts_at)) / 60)::int || ' min late' end)
          where b.checked_in_at is not null
        union all
        select b.started_at, json_build_object(
          'at', b.started_at, 'what', 'In the chair', 'detail', null)
          where b.started_at is not null
        union all
        select b.completed_at, json_build_object(
          'at', b.completed_at, 'what', 'Done',
          'detail', round(greatest(0, b.price_cents - coalesce(b.discount_cents, 0) - b.deposit_cents) / 100.0)
                    || ' DH cash collected')
          where b.completed_at is not null
        union all
        select b.cancelled_at, json_build_object(
          'at', b.cancelled_at, 'what', 'Cancelled',
          'detail', coalesce(b.cancel_reason, 'no reason given'))
          where b.cancelled_at is not null
      ) t(at, e)),

    'case', (select json_build_object('id', c.id, 'case_no', c.case_no, 'status', c.status)
               from public.support_cases c where c.booking_id = b.id
               order by c.created_at desc limit 1),

    'review', (select json_build_object(
                 'id', r.id,
                 'ref', 'RV-' || upper(left(replace(r.id::text, '-', ''), 4)),
                 'rating', r.rating, 'state', r.state)
               from public.reviews r where r.booking_id = b.id),

    -- what a refund could still put back: the deposit, less anything already returned
    'refundable_cents', greatest(0, b.deposit_cents - v_refunded),
    'refunded_cents', v_refunded
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_booking(uuid) to authenticated;
