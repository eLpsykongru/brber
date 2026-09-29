-- 0136_person_files: the barber's file (BRB-03/15) and the customer's (CUS-03)
-- for the staff site. Bookings, wallets, cases and a barber's flags are private to
-- their owners by RLS, and no admin read gathered one person's record, so ⌘K and
-- the salon page had links to /barbers/<id> and /customers/<id> with nothing
-- behind them. Two definer reads, admin-only, read-only — no gate needed.
--
-- A cancellation "by the barber" is one where cancelled_by is the barber; late
-- means inside two hours of the slot, the same line the customer rule uses.

create or replace function public.admin_barber(p_barber uuid)
returns json language plpgsql stable security definer set search_path = '' as $$
declare j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select json_build_object(
    'id', b.id, 'name', coalesce(p.full_name, 'Barber'), 'phone', p.phone, 'joined', b.created_at,
    'status', b.status, 'accepting', b.accepting_bookings, 'paused_at', b.paused_at,
    'licence_expires_at', b.licence_expires_at, 'id_document', b.id_document_path is not null,
    'pay_model', b.pay_model, 'commission_pct', b.commission_pct, 'chair', b.chair_label,
    'suspended_at', p.suspended_at, 'suspended_reason', p.suspended_reason,
    'salon', (select json_build_object('id', s.id, 'slug', s.slug, 'name', s.name, 'status', s.status,
                                       'district', s.district, 'is_owner', s.owner_id = b.id)
                from public.salons s where s.id = b.salon_id),
    'rating', (select round(avg(r.rating), 2) from public.reviews r where r.barber_id = b.id and r.state <> 'removed'),
    'reviews_n', (select count(*) from public.reviews r where r.barber_id = b.id and r.state <> 'removed'),
    'last30', (select json_build_object(
        'bookings', count(*),
        'done', count(*) filter (where x.completed_at is not null),
        'no_shows', count(*) filter (where x.status = 'no_show'),
        'cancels', count(*) filter (where x.status = 'cancelled' and x.cancelled_by = b.id),
        'late_cancels', count(*) filter (where x.status = 'cancelled' and x.cancelled_by = b.id
                                          and x.cancelled_at > x.starts_at - interval '2 hours'),
        'booked_cents', coalesce(sum(x.price_cents) filter (where x.status in ('confirmed', 'completed')), 0))
      from public.bookings x where x.barber_id = b.id and x.starts_at > now() - interval '30 days' and x.starts_at <= now()),
    'week_ahead', (select count(*) from public.bookings x where x.barber_id = b.id and x.status = 'confirmed'
                     and x.starts_at > now() and x.starts_at < now() + interval '7 days'),
    'cancellations', coalesce((select json_agg(c order by c.starts_at desc) from (
        select x.id, x.ref, x.starts_at, x.cancelled_at, x.cancel_reason, x.deposit_cents,
               x.cancelled_at > x.starts_at - interval '2 hours' as late,
               coalesce(x.walk_in_name, cp.full_name, 'Customer') as customer
          from public.bookings x left join public.profiles cp on cp.id = x.customer_id
         where x.barber_id = b.id and x.status = 'cancelled' and x.cancelled_by = b.id
         order by x.starts_at desc limit 20) c), '[]'),
    'reviews', coalesce((select json_agg(r order by r.created_at desc) from (
        select r.id, r.rating, r.comment, r.created_at, r.state, r.reply,
               coalesce(cp.full_name, 'Customer') as customer
          from public.reviews r left join public.profiles cp on cp.id = r.customer_id
         where r.barber_id = b.id
         order by r.created_at desc limit 10) r), '[]'))
    into j
    from public.barbers b join public.profiles p on p.id = b.id
   where b.id = p_barber;
  if j is null then raise exception using errcode = 'P0002', message = 'not_found'; end if;
  return j;
end $$;
grant execute on function public.admin_barber(uuid) to authenticated;

create or replace function public.admin_customer(p_customer uuid)
returns json language plpgsql stable security definer set search_path = '' as $$
declare j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select json_build_object(
    'id', p.id, 'name', coalesce(p.full_name, 'Customer'), 'phone', p.phone, 'role', p.role,
    'joined', p.created_at, 'deleted_at', p.deleted_at,
    'suspended_at', p.suspended_at, 'suspended_reason', p.suspended_reason,
    'wallet_cents', (select coalesce(sum(w.amount_cents), 0) from public.wallet_transactions w where w.user_id = p.id),
    'wallet', coalesce((select json_agg(w order by w.created_at desc) from (
        select w.kind, w.amount_cents, w.created_at, w.ref from public.wallet_transactions w
         where w.user_id = p.id order by w.created_at desc limit 12) w), '[]'),
    'counts', (select json_build_object(
        'bookings', count(*),
        'done', count(*) filter (where x.completed_at is not null),
        'no_shows', count(*) filter (where x.status = 'no_show'),
        'cancelled_by_them', count(*) filter (where x.status = 'cancelled' and x.cancelled_by = p.id))
      from public.bookings x where x.customer_id = p.id),
    'bookings', coalesce((select json_agg(x order by x.starts_at desc) from (
        select x.id, x.ref, x.starts_at, x.status, x.price_cents, x.deposit_cents, x.completed_at,
               coalesce(bp.full_name, 'Barber') as barber, s.name as salon, s.slug as salon_slug
          from public.bookings x
          left join public.profiles bp on bp.id = x.barber_id
          left join public.barbers bb on bb.id = x.barber_id
          left join public.salons s on s.id = bb.salon_id
         where x.customer_id = p.id
         order by x.starts_at desc limit 15) x), '[]'),
    'marks', coalesce((select json_agg(m order by m.created_at desc) from (
        select m.kind, m.minutes, m.created_at from public.customer_marks m
         where m.customer_id = p.id and m.cleared_at is null order by m.created_at desc limit 10) m), '[]'),
    'flags', coalesce((select json_agg(f order by f.updated_at desc) from (
        select f.barber_id, coalesce(bp.full_name, 'Barber') as barber, f.reason, f.require_full_payment, f.blocked, f.updated_at
          from public.client_flags f left join public.profiles bp on bp.id = f.barber_id
         where f.customer_id = p.id) f), '[]'),
    'cases', coalesce((select json_agg(c order by c.created_at desc) from (
        select c.id, c.case_no, c.reason, c.status, c.created_at, c.refund_cents
          from public.support_cases c where c.user_id = p.id order by c.created_at desc limit 10) c), '[]'))
    into j
    from public.profiles p where p.id = p_customer;
  if j is null then raise exception using errcode = 'P0002', message = 'not_found'; end if;
  return j;
end $$;
grant execute on function public.admin_customer(uuid) to authenticated;
