-- 0140_customer_list: CUS-02 — every customer, and the few who need something from us.
--
-- The Customers page could only list customers a barber had flagged (0056's
-- admin_flagged_customers), so on a network where nobody is flagged it was empty. CUS-02
-- draws the whole city with "who needs something" on top: All · Owed something ·
-- Pay-up-front flag · Lapsed 60 days · Wallet over 200 DH, a search by phone, name or
-- booking ID, and four numbers. Nothing read that whole list; this does, in one call.
--
-- "Owed something" is derived, never typed — the things that are ours to put right:
--   · an open support case (with the amount in dispute, when there is one);
--   · an upcoming booking at a shop that has since been suspended;
--   · being cancelled on twice in 30 days by the same barber.
-- Phones are masked in the list (the customer's file shows the number). A search with six
-- or more digits is a phone lookup and is written to staff_lookups exactly as ⌘K's
-- admin_find does, so the list is not a quieter way to look someone up.
-- Read-only apart from that log line; admin only; not gated (it changes nothing).
-- Its windows are durations (60 days, 6 weeks), so there is no local-time arithmetic here.

create or replace function public.admin_customers(
  p_view text default null, p_q text default null, p_limit int default 100)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_q, ''));
  v_digits text := regexp_replace(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '^(00212|212|0)', '');
  v_ref text := upper(regexp_replace(btrim(coalesce(p_q, '')), '^#', ''));
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  with c as (
    select p.id, coalesce(nullif(btrim(p.full_name), ''), 'Customer') as name, p.phone,
           p.suspended_at is not null as suspended
      from public.profiles p
     where p.role = 'customer' and p.deleted_at is null
  ),
  bk as (
    select b.customer_id as id,
           count(*) filter (where b.completed_at is not null)::int as visits,
           max(b.starts_at) filter (where b.starts_at <= now()) as last_seen,
           bool_or(b.starts_at > now() - interval '60 days') as recent
      from public.bookings b
     where b.customer_id is not null
     group by b.customer_id
  ),
  w as (select t.user_id as id, sum(t.amount_cents)::int as wallet
          from public.wallet_transactions t group by t.user_id),
  fl as (select f.customer_id as id, count(*)::int as barbers,
                bool_or(f.require_full_payment) as full_payment, bool_or(f.blocked) as blocked
           from public.client_flags f group by f.customer_id),
  mk as (select m.customer_id as id, count(*)::int as marks
           from public.customer_marks m where m.cleared_at is null group by m.customer_id),
  owed as (
    select x.id, json_agg(x.item order by x.at) as items, coalesce(sum(x.cents), 0)::int as cents
      from (
        select sc.user_id as id, sc.created_at as at, coalesce(sc.amount_cents, 0) as cents,
               json_build_object('kind', 'case', 'reason', sc.reason, 'ref', sc.case_no,
                                 'cents', sc.amount_cents) as item
          from public.support_cases sc
         where sc.status = 'open'
        union all
        select b.customer_id, b.starts_at, 0,
               json_build_object('kind', 'suspended_shop', 'shop', s.name, 'at', b.starts_at)
          from public.bookings b
          join public.barbers ba on ba.id = b.barber_id
          join public.salons s on s.id = ba.salon_id
         where b.customer_id is not null and b.starts_at > now()
           and b.status in ('pending', 'confirmed') and s.status = 'suspended'
        union all
        select b.customer_id, max(b.cancelled_at), 0,
               json_build_object('kind', 'cancelled_twice', 'n', count(*),
                                 'barber', max(coalesce(bp.full_name, 'their barber')))
          from public.bookings b
          left join public.profiles bp on bp.id = b.barber_id
         where b.customer_id is not null and b.status = 'cancelled'
           and b.cancelled_by = b.barber_id and b.cancelled_at > now() - interval '30 days'
         group by b.customer_id, b.barber_id
        having count(*) >= 2
      ) x
     group by x.id
  ),
  a as (
    select c.id, c.name, c.phone, c.suspended,
           coalesce(bk.visits, 0) as visits, bk.last_seen, bk.id is not null as booked,
           coalesce(bk.recent, false) as recent, coalesce(w.wallet, 0) as wallet,
           fl.barbers as flag_barbers, coalesce(fl.full_payment, false) as full_payment,
           coalesce(fl.blocked, false) as blocked, coalesce(mk.marks, 0) as marks,
           o.items as owed, coalesce(o.cents, 0) as owed_cents
      from c
      left join bk on bk.id = c.id left join w on w.id = c.id left join fl on fl.id = c.id
      left join mk on mk.id = c.id left join owed o on o.id = c.id
  ),
  -- with no view asked for: the people we owe, unless there are none
  v as (select coalesce(nullif(p_view, ''),
                        case when exists (select 1 from a where a.owed is not null) then 'owed' else 'all' end) as view),
  byref as (
    select distinct b.customer_id as id from public.bookings b
     where length(v_ref) >= 4
       and (upper(coalesce(b.ref, '')) = v_ref or upper(left(replace(b.id::text, '-', ''), 8)) = v_ref)
  ),
  m as (
    select a.* from a, v
     where case v.view
             when 'owed' then a.owed is not null
             when 'flagged' then a.flag_barbers is not null
             when 'lapsed' then a.booked and not a.recent
             when 'wallet' then a.wallet > 20000
             else true end
       and (v_q = ''
            or (length(v_digits) >= 6
                and regexp_replace(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), '^(00212|212|0)', '')
                    like '%' || v_digits || '%')
            or (length(v_digits) < 6 and lower(a.name) like '%' || lower(v_q) || '%')
            or a.id in (select id from byref))
  )
  select json_build_object(
    'view', (select view from v),
    'counts', json_build_object(
      'all', (select count(*) from a),
      'owed', (select count(*) from a where a.owed is not null),
      'flagged', (select count(*) from a where a.flag_barbers is not null),
      'lapsed', (select count(*) from a where a.booked and not a.recent),
      'wallet', (select count(*) from a where a.wallet > 20000)),
    'kpi', json_build_object(
      'owed_cents', (select coalesce(sum(a.owed_cents), 0) from a),
      'owed_people', (select count(*) from a where a.owed is not null),
      'wallet_cents', (select coalesce(sum(greatest(a.wallet, 0)), 0) from a),
      -- a visit with six weeks behind it: did they book again inside them?
      'again_n', (select count(*) from public.bookings b
                   where b.customer_id is not null
                     and b.completed_at between now() - interval '90 days' and now() - interval '42 days'),
      'again_pct', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (
                       where exists (select 1 from public.bookings n
                                      where n.customer_id = b.customer_id and n.id <> b.id
                                        and n.status <> 'cancelled' and n.starts_at > b.completed_at
                                        and n.starts_at <= b.completed_at + interval '42 days')) / count(*))::int end
                      from public.bookings b
                     where b.customer_id is not null
                       and b.completed_at between now() - interval '90 days' and now() - interval '42 days'),
      -- cancelled on by the barber, two weeks ago or more: did they ever book again?
      'left_n', (select count(*) from public.bookings b
                  where b.customer_id is not null and b.status = 'cancelled' and b.cancelled_by = b.barber_id
                    and b.cancelled_at between now() - interval '90 days' and now() - interval '14 days'),
      'left_pct', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (
                      where not exists (select 1 from public.bookings n
                                         where n.customer_id = b.customer_id and n.created_at > b.cancelled_at)) / count(*))::int end
                     from public.bookings b
                    where b.customer_id is not null and b.status = 'cancelled' and b.cancelled_by = b.barber_id
                      and b.cancelled_at between now() - interval '90 days' and now() - interval '14 days')),
    'total', (select count(*) from m),
    'rows', (select coalesce(json_agg(json_build_object(
               'id', r.id, 'name', r.name,
               -- masked from the digits, however the number was typed: +212 661••• 567
               'phone', case when length(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g')) < 8 then r.phone
                             when regexp_replace(r.phone, '\D', '', 'g') like '212%'
                               then '+212 ' || substr(regexp_replace(r.phone, '\D', '', 'g'), 4, 3)
                                    || '••• ' || right(regexp_replace(r.phone, '\D', '', 'g'), 3)
                             else left(regexp_replace(r.phone, '\D', '', 'g'), 3)
                                  || '••• ' || right(regexp_replace(r.phone, '\D', '', 'g'), 3) end,
               'visits', r.visits, 'last_seen', r.last_seen, 'wallet_cents', r.wallet,
               'suspended', r.suspended, 'flag_barbers', r.flag_barbers,
               'full_payment', r.full_payment, 'blocked', r.blocked, 'marks', r.marks,
               'owed', r.owed, 'owed_cents', r.owed_cents) order by r.k), '[]'::json)
               from (select m.*, row_number() over (order by (m.owed is not null) desc, m.last_seen desc nulls last, m.name) as k
                       from m order by k limit v_limit) r)
  ) into j;

  -- a phone looked up here is logged like one looked up in ⌘K
  if length(v_digits) >= 6 then
    insert into public.staff_lookups (staff_id, phone, found) values (auth.uid(), v_digits, (j ->> 'total')::int);
  end if;
  return j;
end;
$$;
revoke all on function public.admin_customers(text, text, int) from public, anon;
grant execute on function public.admin_customers(text, text, int) to authenticated;
