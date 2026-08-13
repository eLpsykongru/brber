-- 0070_turn9_salon_page: 9a's read — the salon page the four verbs live on.
--
-- 9a is the page Suspend, Message owner, Settle float and Set float cap were
-- always meant to fire from, and the turn's point is that none of them should
-- fire blind: each one gets the ledger it needs *before* it runs. So this read
-- carries not just the shop but the consequences —
--   · suspending  → how many bookings die, how much deposit comes back, how
--                   many customers get told
--   · the cap     → what is already in the till, which is the floor 0069 enforces
--   · settling    → what the last collection took and what has come in since
--
-- `flagged` and `why` are lifted verbatim from 0066's admin_barbers so a barber
-- who is flagged on the Barbers table is flagged the same way on his shop's page.
-- Two shapes of the same fact that disagree are worse than one that is rough.
--
-- Note licence_expires_at lives on `barbers`, not `salons` (0054) — a shop is
-- overdue when its earliest barber licence is.

create or replace function public.admin_salon(p_salon uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  s record;
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select sa.id, sa.name, sa.address, sa.status, sa.lat, sa.lng,
         sa.created_at, sa.reviewed_at, sa.review_note, sa.owner_id,
         sa.float_cap_cents,
         op.full_name as owner_name
    into s
  from public.salons sa
  left join public.profiles op on op.id = sa.owner_id
  where sa.id = p_salon;
  if not found then raise exception 'Salon not found'; end if;

  with team as (
    select ba.id, coalesce(p.full_name, 'Barber') as name,
           (ba.id = s.owner_id) as is_owner,
           ba.licence_expires_at,
           (select round(avg(r.rating), 2) from public.reviews r
             where r.barber_id = ba.id and r.state <> 'removed') as rating,
           (select count(*)::int from public.bookings x
             where x.barber_id = ba.id and x.created_at > now() - interval '30 days') as booked30,
           (select count(*)::int from public.bookings x
             where x.barber_id = ba.id and x.status = 'cancelled' and x.cancelled_by = ba.id
               and x.created_at > now() - interval '30 days') as cancels30,
           (select count(*)::int from public.bookings x
             where x.barber_id = ba.id and x.starts_at > now() - interval '7 days'
               and x.status <> 'cancelled') as week_bookings,
           (select max(x.starts_at) from public.bookings x where x.barber_id = ba.id) as last_booking,
           ba.created_at as joined_at
      from public.barbers ba
      join public.profiles p on p.id = ba.id
     where ba.salon_id = p_salon and ba.status = 'approved'
  ), scored as (
    select t.*,
           case when t.cancels30 > 0 then round(t.cancels30 * 100.0 / nullif(t.booked30, 0)) end as cancel_pct,
           floor(extract(epoch from (now() - coalesce(t.last_booking, t.joined_at))) / 86400)::int as idle_days
      from team t
  ),
  -- a request for a day that never turned into a booking with that barber
  asks as (
    select count(*)::int as n
      from public.waitlist_requests w
      join public.barbers ba on ba.id = w.barber_id
     where ba.salon_id = p_salon
       and w.created_at > now() - interval '30 days'
       and not exists (select 1 from public.bookings x
                        where x.customer_id = w.customer_id and x.barber_id = w.barber_id
                          and x.starts_at::date = w.day and x.status <> 'cancelled')
  ),
  -- the same count for every shop, so the page can say where this one stands
  ranked as (
    select count(*)::int + 1 as pos from (
      select ba.salon_id, count(*) as n
        from public.waitlist_requests w
        join public.barbers ba on ba.id = w.barber_id
       where w.created_at > now() - interval '30 days'
         and not exists (select 1 from public.bookings x
                          where x.customer_id = w.customer_id and x.barber_id = w.barber_id
                            and x.starts_at::date = w.day and x.status <> 'cancelled')
       group by ba.salon_id
    ) q where q.n > (select n from asks)
  ),
  -- what "SUSPEND FOR REAL" actually destroys: 9a prints these three before it fires
  doomed as (
    select count(*)::int as bookings,
           count(*) filter (where b.deposit_cents > 0)::int as deposits_n,
           coalesce(sum(b.deposit_cents) filter (where b.deposit_cents > 0), 0)::int as deposits_cents,
           count(distinct b.customer_id)::int as customers
      from public.bookings b
      join public.barbers ba on ba.id = b.barber_id
     where ba.salon_id = p_salon
       and b.status in ('pending', 'confirmed')
       and b.starts_at >= now()
  )
  select json_build_object(
    'id', s.id, 'name', s.name, 'address', s.address, 'status', s.status,
    'placed', (s.lat is not null and s.lng is not null),
    'owner', json_build_object('id', s.owner_id, 'name', coalesce(s.owner_name, 'Owner')),
    'live_since', s.created_at,
    'hidden_since', case when s.status = 'suspended' then s.reviewed_at end,
    'review_note', s.review_note,

    'licence_expires_at', (select min(licence_expires_at) from scored),
    'licence_overdue_days', (select case when min(licence_expires_at) < current_date
                                    then current_date - min(licence_expires_at) end from scored),

    'rating', (select round(avg(r.rating), 2) from public.reviews r
                join public.barbers ba on ba.id = r.barber_id
               where ba.salon_id = p_salon and r.state <> 'removed'),
    'reviews_n', (select count(*)::int from public.reviews r
                   join public.barbers ba on ba.id = r.barber_id
                  where ba.salon_id = p_salon and r.state <> 'removed'),

    'barbers_n', (select count(*)::int from scored),
    'flagged_n', (select count(*)::int from scored
                   where cancel_pct >= 15 or idle_days > 14),

    'bookings_30d', (select count(*)::int from public.bookings b
                      join public.barbers ba on ba.id = b.barber_id
                     where ba.salon_id = p_salon and b.created_at > now() - interval '30 days'
                       and b.status <> 'cancelled'),
    'revenue_30d_cents', (select coalesce(sum(b.price_cents - coalesce(b.discount_cents, 0)), 0)::int
                            from public.bookings b
                            join public.barbers ba on ba.id = b.barber_id
                           where ba.salon_id = p_salon and b.created_at > now() - interval '30 days'
                             and b.status = 'completed'),

    'float_cents', public.salon_float_cents(p_salon),
    'cap_cents', s.float_cap_cents,
    'owed_cents', public.salon_owed_cents(p_salon),
    'gap_cents', public.salon_gap_cents(p_salon),

    'unmet_asks', (select n from asks),
    'asks_rank', (select pos from ranked),

    -- the obligation the shop is already carrying, which is usually why it is hidden
    'task', (select json_build_object(
               'id', t.id, 'ref', t.ref, 'kind', t.kind, 'title', t.title,
               'due_at', t.due_at, 'status', t.status, 'because', t.issued_because)
               from public.shop_tasks t
              where t.salon_id = p_salon and t.status in ('open', 'sent')
              order by t.due_at nulls last, t.created_at limit 1),

    'team', (select coalesce(json_agg(json_build_object(
               'id', x.id, 'name', x.name, 'owner', x.is_owner,
               'rating', x.rating, 'cancel_pct', x.cancel_pct, 'cancels', x.cancels30,
               'week_bookings', x.week_bookings,
               'flagged', (x.cancel_pct >= 15 or x.idle_days > 14),
               'why', case
                 when x.cancel_pct >= 15 then 'Cancelled ' || x.cancels30 || ' bookings in 30 days'
                 when x.idle_days > 14 then 'Nothing booked in ' || x.idle_days || ' days'
                 else 'Nothing flagged' end)
               order by (case when x.cancel_pct >= 15 then 0 when x.idle_days > 14 then 1 else 2 end),
                        x.name), '[]'::json)
             from scored x),

    'suspend_preview', (select json_build_object(
             'bookings', d.bookings, 'deposits_n', d.deposits_n,
             'deposits_cents', d.deposits_cents, 'customers', d.customers) from doomed d),

    'last_settlement', (select json_build_object(
             'amount_cents', f.amount_cents, 'at', f.created_at, 'note', f.note,
             'by', coalesce(sp.full_name, 'Ops'), 'mine', f.settled_by = auth.uid())
             from public.float_settlements f
             left join public.profiles sp on sp.id = f.settled_by
            where f.salon_id = p_salon
            order by f.created_at desc limit 1),
    -- what has landed in the till since that collection — 9a uses it to say
    -- "not worth a trip" instead of sending somebody across the city for 260 DH
    'since_settled_cents', (select coalesce(sum(w.amount_cents), 0)::int
                              from public.wallet_transactions w
                             where w.salon_id = p_salon and w.kind = 'cash_topup'
                               and w.created_at > coalesce(
                                     (select max(f.created_at) from public.float_settlements f
                                       where f.salon_id = p_salon), '-infinity'::timestamptz))
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_salon(uuid) to authenticated;
