-- 0043_admin_reads: everything the admin desk READS. One function per screen of
-- "Admin Dashboard.dc.html", each returning json the console renders as-is.
--
-- Why RPCs and not admin SELECT policies: every screen is an aggregate over
-- tables that are RLS-scoped to their owner. Opening all of them to is_admin()
-- would export the whole marketplace to any admin session and still leave the
-- console doing joins in JavaScript. These are read-only, admin-gated, and
-- return exactly what one screen draws.
--
-- Money is cents everywhere; the console formats. "City" is not a column — the
-- console takes the last comma-chunk of the address, so a shop can be moved
-- between cities without a migration.

-- ---- 1a · Overview ---------------------------------------------------------
create or replace function public.admin_overview()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_day  timestamptz := date_trunc('day', now());
  v_from timestamptz := v_day - interval '6 days';   -- the 7 bars, today included
  v_prev timestamptz := v_from - interval '7 days';  -- the week before, for the deltas
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    'now', now(),
    'kpi', (
      select json_build_object(
        'booked_cents',      coalesce(sum(price_cents) filter (where starts_at >= v_from), 0),
        'booked_prev_cents', coalesce(sum(price_cents) filter (where starts_at <  v_from), 0),
        'bookings',          count(*) filter (where starts_at >= v_from),
        'bookings_prev',     count(*) filter (where starts_at <  v_from),
        'kept',              count(*) filter (where starts_at >= v_from and completed_at is not null),
        'no_shows',          count(*) filter (where starts_at >= v_from and status = 'no_show'),
        'no_shows_prev',     count(*) filter (where starts_at <  v_from and status = 'no_show'),
        'avg_basket_cents',  coalesce(avg(price_cents) filter (where starts_at >= v_from), 0)::int,
        'with_deposit',      count(*) filter (where starts_at >= v_from and deposit_cents > 0)
      )
      from public.bookings
      where starts_at >= v_prev and starts_at < v_day + interval '1 day'
        and status <> 'cancelled'
    ),
    'float_cents',  (select coalesce(sum(public.salon_float_cents(s.id)), 0)::int from public.salons s),
    'agent_salons', (select count(distinct w.salon_id) from public.wallet_transactions w
                      where w.kind = 'cash_topup'),
    'new_customers', (select count(*) from public.profiles
                       where role = 'customer' and created_at >= v_from),
    'repeat_pct', (
      select case when count(*) = 0 then 0
                  else (100.0 * count(*) filter (where n > 1) / count(*))::int end
      from (select customer_id, count(*) as n from public.bookings
             where starts_at >= v_from and status <> 'cancelled'
             group by customer_id) q
    ),
    -- the 7 bars: appointments vs walk-ins, by booked value
    'days', (
      select coalesce(json_agg(x.d order by x.dt), '[]'::json)
      from (
        select g.d::date as dt,
               json_build_object(
                 'date', g.d::date,
                 'appt_cents',   coalesce(sum(b.price_cents) filter (where b.walk_in_name is null), 0),
                 'walkin_cents', coalesce(sum(b.price_cents) filter (where b.walk_in_name is not null), 0)
               ) as d
        from generate_series(v_from, v_day, interval '1 day') g(d)
        left join public.bookings b
               on b.starts_at >= g.d and b.starts_at < g.d + interval '1 day'
              and b.status <> 'cancelled'
        group by g.d
      ) x
    ),
    'live', json_build_object(
      'shops_open', (select count(*) from public.salons s
                      where s.status = 'live' and s.accepting_bookings),
      'in_queue',   (select count(*) from public.bookings b
                      where b.status = 'confirmed' and b.completed_at is null
                        and b.starts_at >= v_day and b.starts_at < v_day + interval '1 day'),
      -- honest about what it measures: minutes until your slot, not how late the
      -- barber is running. Lateness needs started_at vs starts_at history first.
      'median_wait_min', (
        select coalesce(percentile_cont(0.5) within group (
                 order by extract(epoch from (b.starts_at - now())) / 60), 0)::int
        from public.bookings b
        where b.status = 'confirmed' and b.started_at is null
          and b.starts_at >= now() and b.starts_at < v_day + interval '1 day')
    ),
    -- "Needs a human": counts + the age of the oldest one, so the card can say "2h"
    'needs', json_build_object(
      'flagged',        (select count(*) from public.reviews where state = 'held'),
      'flagged_since',  (select min(coalesce(flagged_at, created_at)) from public.reviews where state = 'held'),
      'cases',          (select count(*) from public.support_cases where status = 'open'),
      'cases_since',    (select min(created_at) from public.support_cases where status = 'open'),
      'pending',        (select count(*) from public.salons where status = 'pending'),
      'pending_since',  (select min(submitted_at) from public.salons where status = 'pending'),
      'pending_where',  (select string_agg(s.address, ' · ') from public.salons s where s.status = 'pending'),
      'mismatch',       (select json_build_object('name', s.name, 'cents', public.salon_float_cents(s.id))
                          from public.salons s
                         where public.salon_float_cents(s.id) < 0
                         order by public.salon_float_cents(s.id)
                         limit 1)
    ),
    'top_salons', (
      select coalesce(json_agg(json_build_object(
               'name', k.name, 'address', k.address, 'bookings', k.bookings,
               'value_cents', k.value_cents, 'no_shows', k.no_shows, 'rating', k.rating
             ) order by k.value_cents desc), '[]'::json)
      from (
        select s.name, s.address, st.bookings, st.value_cents, st.no_shows, rv.rating
        from public.salons s
        cross join lateral (
          select count(b.id)::int as bookings,
                 coalesce(sum(b.price_cents), 0)::int as value_cents,
                 count(*) filter (where b.status = 'no_show')::int as no_shows
          from public.bookings b
          join public.barbers ba on ba.id = b.barber_id
          where ba.salon_id = s.id and b.starts_at >= v_from and b.status <> 'cancelled'
        ) st
        cross join lateral (
          select round(avg(r.rating)::numeric, 1) as rating
          from public.reviews r
          join public.barbers ba on ba.id = r.barber_id
          where ba.salon_id = s.id and r.state <> 'removed'
        ) rv
        where s.status = 'live'
        order by st.value_cents desc
        limit 5
      ) k
    )
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_overview() to authenticated;

-- ---- 1b · Salons -----------------------------------------------------------
create or replace function public.admin_salons()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_from timestamptz := date_trunc('day', now()) - interval '6 days';
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    'counts', (
      select json_build_object(
        'all',       count(*),
        'live',      count(*) filter (where status = 'live'),
        'pending',   count(*) filter (where status = 'pending'),
        'suspended', count(*) filter (where status = 'suspended')
      ) from public.salons
    ),
    'rows', (
      select coalesce(json_agg(json_build_object(
               'id', k.id, 'name', k.name, 'address', k.address, 'status', k.status,
               'open', k.open, 'owner', k.owner, 'chairs', k.chairs,
               'bookings', k.bookings, 'float_cents', k.float_cents, 'rating', k.rating
             ) order by k.rank, k.name), '[]'::json)
      from (
        select s.id, s.name, s.address, s.status,
               (s.status = 'live' and s.accepting_bookings) as open,
               coalesce(p.full_name, 'Owner') as owner,
               case s.status when 'pending' then 0 when 'suspended' then 1 else 2 end as rank,
               (select count(*) from public.chairs c where c.salon_id = s.id) as chairs,
               st.bookings, public.salon_float_cents(s.id) as float_cents, rv.rating
        from public.salons s
        left join public.profiles p on p.id = s.owner_id
        cross join lateral (
          select count(b.id)::int as bookings
          from public.bookings b
          join public.barbers ba on ba.id = b.barber_id
          where ba.salon_id = s.id and b.starts_at >= v_from and b.status <> 'cancelled'
        ) st
        cross join lateral (
          select round(avg(r.rating)::numeric, 1) as rating
          from public.reviews r
          join public.barbers ba on ba.id = r.barber_id
          where ba.salon_id = s.id and r.state <> 'removed'
        ) rv
      ) k
    )
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_salons() to authenticated;

-- ---- 1c · Bookings ---------------------------------------------------------
-- `state` is computed here because the rule is the 0018 lifecycle, not the
-- status column: a booking in the chair and one already paid for both read
-- 'confirmed' in the table.
create or replace function public.admin_bookings(p_scope text default 'today', p_limit int default 60)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_day timestamptz := date_trunc('day', now());
  v_from timestamptz := case when p_scope = 'today' then v_day else v_day - interval '30 days' end;
  v_to   timestamptz := case when p_scope = 'today' then v_day + interval '1 day'
                             else v_day + interval '30 days' end;
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    'counts', (
      select json_build_object(
        'today',     count(*),
        'pending',   count(*) filter (where status = 'pending'),
        'completed', count(*) filter (where completed_at is not null),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'no_show',   count(*) filter (where status = 'no_show'),
        'deposit_cents', coalesce(sum(deposit_cents) filter (where status <> 'cancelled'), 0)
      )
      from public.bookings where starts_at >= v_day and starts_at < v_day + interval '1 day'
    ),
    'rows', (
      select coalesce(json_agg(json_build_object(
               'id', b.id,
               'ref', '#' || upper(left(replace(b.id::text, '-', ''), 8)),
               'customer', coalesce(nullif(b.walk_in_name, ''), p.full_name, 'Customer'),
               'walk_in', b.walk_in_name is not null,
               'salon', coalesce(s.name, 'No shop'),
               'barber', coalesce(bp.full_name, 'Barber'),
               'service', coalesce(sv.name, '—'),
               'starts_at', b.starts_at,
               'price_cents', b.price_cents,
               'deposit_cents', b.deposit_cents,
               'state', case
                 when b.status = 'no_show' then 'no_show'
                 when b.status = 'cancelled' then 'cancelled'
                 when b.status = 'pending' then 'pending'
                 when b.completed_at is not null then 'completed'
                 when b.started_at is not null then 'in_chair'
                 when b.checked_in_at is not null then 'checked_in'
                 when b.walk_in_name is not null then 'queued'
                 else 'confirmed' end,
               'disputed', exists (select 1 from public.support_cases c
                                    where c.booking_id = b.id and c.status = 'open')
             ) order by b.starts_at), '[]'::json)
      from (
        select * from public.bookings
        where starts_at >= v_from and starts_at < v_to
        order by starts_at limit greatest(1, least(p_limit, 200))
      ) b
      left join public.profiles p  on p.id = b.customer_id
      left join public.profiles bp on bp.id = b.barber_id
      left join public.barbers  ba on ba.id = b.barber_id
      left join public.salons   s  on s.id = ba.salon_id
      left join public.services sv on sv.id = b.service_id
    )
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_bookings(text, int) to authenticated;

-- ---- 1d · Wallets & float --------------------------------------------------
create or replace function public.admin_wallets()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    -- what we owe customers: only positive balances are a liability
    'wallets', (
      select json_build_object(
        'liability_cents', coalesce(sum(greatest(bal, 0)), 0)::int,
        'count', count(*) filter (where bal <> 0)
      )
      from (select user_id, sum(amount_cents) as bal
              from public.wallet_transactions group by user_id) w
    ),
    'agent_cash_cents', (select coalesce(sum(greatest(public.salon_float_cents(s.id), 0)), 0)::int
                           from public.salons s),
    -- a negative float means we collected more than the drawer ever took in
    'unreconciled_cents', (select coalesce(sum(least(public.salon_float_cents(s.id), 0)), 0)::int
                             from public.salons s),
    'last_settlement', (select max(created_at) from public.float_settlements),
    'shops', (
      select coalesce(json_agg(json_build_object(
               'id', k.id, 'name', k.name, 'topups', k.topups,
               'float_cents', k.float_cents,
               'state', case when k.float_cents < 0 then 'mismatch'
                             when k.float_cents > 0 then 'awaiting'
                             else 'balanced' end,
               'last_topup', k.last_topup
             ) order by k.float_cents desc), '[]'::json)
      from (
        select s.id, s.name,
               (select count(*) from public.wallet_transactions w
                 where w.salon_id = s.id and w.kind = 'cash_topup') as topups,
               (select max(w.created_at) from public.wallet_transactions w
                 where w.salon_id = s.id and w.kind = 'cash_topup') as last_topup,
               public.salon_float_cents(s.id) as float_cents
        from public.salons s
      ) k
      where k.topups > 0 or k.float_cents <> 0
    ),
    'ledger', (
      select coalesce(json_agg(json_build_object(
               'kind', l.kind, 'amount_cents', l.amount_cents, 'at', l.created_at,
               'who', l.who, 'where', l.where_, 'ref', l.ref
             ) order by l.created_at desc), '[]'::json)
      from (
        select w.kind, w.amount_cents, w.created_at,
               coalesce(p.full_name, 'Customer') as who,
               coalesce(s.name, '—') as where_,
               case when w.booking_id is null then null
                    else '#' || upper(left(replace(w.booking_id::text, '-', ''), 8)) end as ref
        from public.wallet_transactions w
        left join public.profiles p on p.id = w.user_id
        left join public.salons  s on s.id = w.salon_id
        union all
        select 'settlement', -f.amount_cents, f.created_at,
               coalesce(p.full_name, 'Sterncut'), s.name, null
        from public.float_settlements f
        join public.salons s on s.id = f.salon_id
        left join public.profiles p on p.id = f.settled_by
        order by 3 desc
        limit 12
      ) l
    )
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_wallets() to authenticated;

-- ---- 1e · Support ----------------------------------------------------------
create or replace function public.admin_support(p_status text default 'open')
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    'counts', (
      select json_build_object(
        'open',     count(*) filter (where status = 'open'),
        'resolved', count(*) filter (where status = 'resolved')
      ) from public.support_cases
    ),
    'rows', (
      select coalesce(json_agg(json_build_object(
               'id', c.id, 'case_no', c.case_no, 'reason', c.reason,
               'detail', c.detail, 'amount_cents', c.amount_cents,
               'status', c.status, 'created_at', c.created_at,
               'customer', coalesce(p.full_name, 'Customer'),
               'salon', coalesce(s.name, '—')
             ) order by c.created_at), '[]'::json)
      from public.support_cases c
      left join public.profiles p on p.id = c.user_id
      left join public.bookings b on b.id = c.booking_id
      left join public.barbers ba on ba.id = b.barber_id
      left join public.salons  s on s.id = ba.salon_id
      where c.status = coalesce(nullif(p_status, ''), 'open')
    )
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_support(text) to authenticated;

-- One case, with the two panels 1e puts beside the thread: the booking it is
-- about, and who is arguing about it.
create or replace function public.admin_support_case(p_case uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    'case', json_build_object(
      'id', c.id, 'case_no', c.case_no, 'reason', c.reason, 'detail', c.detail,
      'amount_cents', c.amount_cents, 'status', c.status, 'refund_cents', c.refund_cents,
      'created_at', c.created_at, 'resolved_at', c.resolved_at),
    'messages', (
      select coalesce(json_agg(json_build_object(
               'body', m.body, 'at', m.created_at,
               'author', coalesce(m.author_name, p2.full_name, 'Customer'),
               'from_us', m.sender_id is distinct from c.user_id
             ) order by m.created_at), '[]'::json)
      from public.support_messages m
      left join public.profiles p2 on p2.id = m.sender_id
      where m.case_id = c.id),
    'booking', case when b.id is null then null else json_build_object(
      'ref', '#' || upper(left(replace(b.id::text, '-', ''), 8)),
      'service', coalesce(sv.name, '—'),
      'price_cents', b.price_cents, 'deposit_cents', b.deposit_cents,
      'starts_at', b.starts_at, 'status', b.status,
      'cancelled_by', case when b.cancelled_by is null then null
                           when b.cancelled_by = b.barber_id then 'salon' else 'customer' end,
      'cancel_reason', b.cancel_reason,
      -- the evidence line 1e leans on: did the deposit ever come back?
      'refunded_cents', coalesce((select sum(w.amount_cents) from public.wallet_transactions w
                                   where w.booking_id = b.id and w.kind = 'deposit_refund'), 0)
      ) end,
    'customer', json_build_object(
      'name', coalesce(p.full_name, 'Customer'),
      'bookings', (select count(*) from public.bookings x where x.customer_id = c.user_id),
      'wallet_cents', (select coalesce(sum(w.amount_cents), 0)::int
                         from public.wallet_transactions w where w.user_id = c.user_id)),
    'salon', case when s.id is null then null else json_build_object(
      'name', s.name, 'status', s.status,
      'open_cases', (select count(*) from public.support_cases c2
                     join public.bookings b2 on b2.id = c2.booking_id
                     join public.barbers ba2 on ba2.id = b2.barber_id
                     where ba2.salon_id = s.id and c2.status = 'open')
      ) end
  ) into j
  from public.support_cases c
  left join public.profiles p  on p.id = c.user_id
  left join public.bookings b  on b.id = c.booking_id
  left join public.services sv on sv.id = b.service_id
  left join public.barbers ba  on ba.id = b.barber_id
  left join public.salons  s   on s.id = ba.salon_id
  where c.id = p_case;

  if j is null then raise exception 'Case not found'; end if;
  return j;
end;
$$;
grant execute on function public.admin_support_case(uuid) to authenticated;

-- ---- 2b · Reviews ----------------------------------------------------------
create or replace function public.admin_reviews(p_filter text default 'all')
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_month timestamptz := date_trunc('month', now());
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    'stats', (
      select json_build_object(
        'month',      count(*) filter (where created_at >= v_month),
        'prev_month', count(*) filter (where created_at >= v_month - interval '1 month'
                                         and created_at < v_month),
        'average',    round((avg(rating) filter (where state <> 'removed'))::numeric, 2),
        'barbers',    (select count(*) from public.barbers where status = 'approved'),
        'held',       count(*) filter (where state = 'held'),
        'held_since', min(coalesce(flagged_at, created_at)) filter (where state = 'held'),
        'removed',    count(*) filter (where state = 'removed'),
        'dist', (
          select json_agg(d order by d->>'stars' desc)
          from (select json_build_object(
                  'stars', g,
                  'pct', case when (select count(*) from public.reviews
                                     where created_at >= v_month and state <> 'removed') = 0 then 0
                              else (100.0 * (select count(*) from public.reviews
                                              where rating = g and created_at >= v_month
                                                and state <> 'removed')
                                    / (select count(*) from public.reviews
                                        where created_at >= v_month and state <> 'removed'))::int end
                ) as d from generate_series(1, 5) g) q
        )
      ) from public.reviews
    ),
    'rows', (
      select coalesce(json_agg(json_build_object(
               'id', r.id, 'rating', r.rating, 'comment', r.comment, 'state', r.state,
               'created_at', r.created_at, 'flagged_at', r.flagged_at,
               'moderated_at', r.moderated_at, 'removal_reason', r.removal_reason,
               'barber', coalesce(bp.full_name, 'Barber'),
               'customer', coalesce(nullif(b.walk_in_name, ''), p.full_name, 'Customer'),
               -- 2b's VISIT column: a review can only exist on a booking, so the
               -- question is which kind of proof that booking carries
               'visit', case when b.id is null then 'none'
                             when b.walk_in_name is not null then 'qr'
                             when b.completed_at is not null or b.checked_in_at is not null then 'verified'
                             else 'booked' end
             ) order by r.created_at desc), '[]'::json)
      from public.reviews r
      left join public.bookings b  on b.id = r.booking_id
      left join public.profiles p  on p.id = r.customer_id
      left join public.profiles bp on bp.id = r.barber_id
      where case coalesce(nullif(p_filter, ''), 'all')
              when 'held'    then r.state = 'held'
              when 'removed' then r.state = 'removed'
              when 'low'     then r.rating <= 2
              else true end
    )
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_reviews(text) to authenticated;

-- ---- 2a · one flagged review, with the evidence beside it ------------------
create or replace function public.admin_review(p_review uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    'review', json_build_object(
      'id', r.id, 'rating', r.rating, 'comment', r.comment, 'state', r.state,
      'created_at', r.created_at, 'flagged_at', r.flagged_at,
      'reply', r.reply, 'replied_at', r.replied_at,
      'removal_reason', r.removal_reason, 'moderated_at', r.moderated_at,
      'ref', 'RV-' || upper(left(replace(r.id::text, '-', ''), 4))),
    'customer', json_build_object(
      'name', coalesce(p.full_name, 'Customer'),
      'reviews', (select count(*) from public.reviews x where x.customer_id = r.customer_id),
      'bookings', (select count(*) from public.bookings x where x.customer_id = r.customer_id)),
    'barber', json_build_object(
      'name', coalesce(bp.full_name, 'Barber'),
      'salon', coalesce(s.name, '—'),
      -- the two numbers 2a puts side by side: what he shows now, and after
      'rating_now', (select round(avg(x.rating)::numeric, 2) from public.reviews x
                      where x.barber_id = r.barber_id and x.state <> 'removed'),
      'rating_without', (select round(avg(x.rating)::numeric, 2) from public.reviews x
                          where x.barber_id = r.barber_id and x.state <> 'removed' and x.id <> r.id),
      'count', (select count(*) from public.reviews x
                 where x.barber_id = r.barber_id and x.state <> 'removed')),
    -- did the visit happen? the desk leads with this, so it is all one object
    'visit', case when b.id is null then null else json_build_object(
      'ref', '#' || upper(left(replace(b.id::text, '-', ''), 8)),
      'service', coalesce(sv.name, '—'),
      'starts_at', b.starts_at, 'checked_in_at', b.checked_in_at,
      'started_at', b.started_at, 'completed_at', b.completed_at,
      'price_cents', b.price_cents, 'deposit_cents', b.deposit_cents,
      'status', b.status,
      'late_min', case when b.checked_in_at is null then null
                       else greatest(0, (extract(epoch from (b.checked_in_at - b.starts_at)) / 60)::int) end
      ) end,
    'case', (
      select json_build_object('case_no', c.case_no, 'status', c.status, 'created_at', c.created_at)
      from public.support_cases c where c.booking_id = b.id order by c.created_at desc limit 1),
    'log', (
      select coalesce(json_agg(json_build_object(
               'action', a.action, 'reason', a.reason, 'note', a.note, 'at', a.created_at,
               'admin', coalesce(ap.full_name, 'Admin')) order by a.created_at desc), '[]'::json)
      from public.review_actions a
      left join public.profiles ap on ap.id = a.admin_id
      where a.review_id = r.id)
  ) into j
  from public.reviews r
  left join public.bookings b  on b.id = r.booking_id
  left join public.services sv on sv.id = b.service_id
  left join public.profiles p  on p.id = r.customer_id
  left join public.profiles bp on bp.id = r.barber_id
  left join public.barbers ba  on ba.id = r.barber_id
  left join public.salons  s   on s.id = ba.salon_id
  where r.id = p_review;

  if j is null then raise exception 'Review not found'; end if;
  return j;
end;
$$;
grant execute on function public.admin_review(uuid) to authenticated;

-- ---- 1f · the approval queue, and one application --------------------------
-- The checklist is derived, never stored: five things that are either on the
-- record or not. The map-pin item is the one admin_salon_decide() enforces.
create or replace function public.admin_approvals(p_salon uuid default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_id uuid;
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select coalesce(p_salon, (select id from public.salons
                             where status = 'pending' order by submitted_at limit 1))
    into v_id;

  select json_build_object(
    'queue', (
      select coalesce(json_agg(json_build_object(
               'id', s.id, 'name', s.name, 'address', s.address,
               'owner', coalesce(p.full_name, 'Owner'), 'submitted_at', s.submitted_at,
               'ref', 'AP-' || upper(left(replace(s.id::text, '-', ''), 4)),
               'done', (case when b.id_document_path is not null then 1 else 0 end
                      + case when p.phone is not null then 1 else 0 end
                      + case when exists (select 1 from public.services sv
                                           where sv.barber_id = s.owner_id) then 1 else 0 end
                      + case when exists (select 1 from public.availability av
                                           where av.barber_id = s.owner_id) then 1 else 0 end
                      + case when s.lat is not null and s.lng is not null then 1 else 0 end)
             ) order by s.submitted_at), '[]'::json)
      from public.salons s
      left join public.profiles p on p.id = s.owner_id
      left join public.barbers  b on b.id = s.owner_id
      where s.status = 'pending'
    ),
    'last30', json_build_object(
      'approved', (select count(*) from public.salons
                    where status = 'live' and reviewed_at >= now() - interval '30 days'),
      'rejected', (select count(*) from public.salons
                    where status = 'rejected' and reviewed_at >= now() - interval '30 days'),
      'median_days', (select round((percentile_cont(0.5) within group (
                        order by extract(epoch from (reviewed_at - submitted_at)) / 86400))::numeric, 1)
                        from public.salons
                       where reviewed_at >= now() - interval '30 days' and submitted_at is not null)
    ),
    'detail', (
      select json_build_object(
        'id', s.id, 'name', s.name, 'address', s.address, 'status', s.status,
        'submitted_at', s.submitted_at, 'lat', s.lat, 'lng', s.lng,
        'owner', json_build_object(
          'id', s.owner_id, 'name', coalesce(p.full_name, 'Owner'), 'phone', p.phone,
          'joined', p.created_at, 'id_document', b.id_document_path is not null,
          'barber_status', b.status,
          'rating', (select round(avg(r.rating)::numeric, 1) from public.reviews r
                      where r.barber_id = s.owner_id and r.state <> 'removed'),
          'cuts', (select count(*) from public.bookings x
                    where x.barber_id = s.owner_id and x.completed_at is not null)),
        'chairs', (select count(*) from public.chairs c where c.salon_id = s.id),
        'services', (
          select coalesce(json_agg(json_build_object('name', sv.name, 'price_cents', sv.price_cents)
                          order by sv.price_cents), '[]'::json)
          from public.services sv where sv.barber_id = s.owner_id),
        'hours', (
          select json_build_object('days', count(*),
                   'from', min(av.start_min), 'to', max(av.end_min))
          from public.availability av where av.barber_id = s.owner_id),
        'checklist', json_build_array(
          json_build_object('key', 'identity', 'ok', b.id_document_path is not null,
            'label', 'Identity verified'),
          json_build_object('key', 'phone', 'ok', p.phone is not null,
            'label', 'Phone on file'),
          json_build_object('key', 'services', 'ok',
            exists (select 1 from public.services sv where sv.barber_id = s.owner_id),
            'label', 'Services & prices set'),
          json_build_object('key', 'hours', 'ok',
            exists (select 1 from public.availability av where av.barber_id = s.owner_id),
            'label', 'Opening hours declared'),
          json_build_object('key', 'pin', 'ok', s.lat is not null and s.lng is not null,
            'label', 'Map pin confirmed')),
        'risk', json_build_object(
          'phone_seen', exists (select 1 from public.profiles p2
                                 where p2.id <> s.owner_id and p.phone is not null
                                   and right(regexp_replace(p2.phone, '\D', '', 'g'), 9)
                                     = right(regexp_replace(p.phone, '\D', '', 'g'), 9)),
          'address_seen', exists (select 1 from public.salons s2
                                   where s2.id <> s.id and s2.address is not null
                                     and lower(btrim(s2.address)) = lower(btrim(coalesce(s.address, '')))),
          'owner_banned', b.status = 'rejected',
          -- straight-line km to the closest shop already live, the same haversine
          -- the app uses for distances
          'nearest_km', (
            select round(min(6371 * acos(least(1,
                     cos(radians(s.lat)) * cos(radians(s2.lat))
                       * cos(radians(s2.lng) - radians(s.lng))
                     + sin(radians(s.lat)) * sin(radians(s2.lat)))))::numeric, 1)
            from public.salons s2
            where s2.id <> s.id and s2.status = 'live'
              and s2.lat is not null and s2.lng is not null
              and s.lat is not null and s.lng is not null))
      )
      from public.salons s
      left join public.profiles p on p.id = s.owner_id
      left join public.barbers  b on b.id = s.owner_id
      where s.id = v_id
    )
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_approvals(uuid) to authenticated;
