-- 0068_appeal_desk_review_body: the appeal desk has never opened.
--
-- 0057's `admin_appeal_desk` builds its 'detail' object with `r.body`, but the
-- reviews table has carried the column as `comment` since 0001 — nothing ever
-- renamed it. Postgres resolves column references when it plans the statement,
-- so the function creates cleanly and then fails on every single call with
-- `column r.body does not exist`. Turn 3a's screen has been dead since it
-- shipped; the console just toasted the error for 3.8 seconds and moved on.
--
-- Only the source column changes. The JSON key stays 'body' because that is
-- what the console reads.

create or replace function public.admin_appeal_desk(p_appeal uuid default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select coalesce(p_appeal, (select a.id from public.review_appeals a
                              where a.decided_at is null
                              order by a.created_at limit 1))
    into v_id;

  select json_build_object(
    'queue', (
      select coalesce(json_agg(json_build_object(
               'id', a.id,
               'ref', 'RV-' || upper(left(replace(a.review_id::text, '-', ''), 4)),
               'customer', coalesce(p.full_name, 'Customer'),
               'created_at', a.created_at,
               'days_left', 3 - floor(extract(epoch from (now() - a.created_at)) / 86400)::int,
               'removed_by', coalesce(rp.full_name, 'Ops'),
               'mine', r.moderated_by = v_me
             ) order by a.created_at), '[]'::json)
      from public.review_appeals a
      left join public.reviews r on r.id = a.review_id
      left join public.profiles p on p.id = a.customer_id
      left join public.profiles rp on rp.id = r.moderated_by
      where a.decided_at is null
    ),
    'this_month', (
      select json_build_object(
        'total', count(*)::int,
        'upheld', count(*) filter (where upheld)::int,
        'overturn_pct', case when count(*) = 0 then 0
                        else round(100.0 * count(*) filter (where upheld) / count(*))::int end)
      from public.review_appeals
      where decided_at >= date_trunc('month', now())
    ),
    'detail', (
      select json_build_object(
        'id', a.id,
        'ref', 'RV-' || upper(left(replace(a.review_id::text, '-', ''), 4)),
        'customer', coalesce(p.full_name, 'Customer'),
        'customer_id', a.customer_id,
        'appealed_at', a.created_at,
        'reason', a.reason, 'note', a.note,
        'rating', r.rating, 'body', r.comment,
        'barber', coalesce(bp.full_name, 'Barber'),
        'barber_id', r.barber_id,
        'salon', s.name, 'salon_id', s.id,
        'removed_by', coalesce(rp.full_name, 'Ops'),
        'removed_at', r.moderated_at,
        'removal_reason', r.removal_reason,
        'is_own_removal', r.moderated_by = v_me,
        'open_case_with_shop', exists (
          select 1 from public.support_cases c
          join public.bookings cb on cb.id = c.booking_id
          join public.barbers cbb on cbb.id = cb.barber_id
           where c.status = 'open' and cbb.salon_id = s.id),
        'log', json_build_object(
          'slot', b.starts_at,
          'scan', b.checked_in_at,
          'chair', b.started_at,
          'poster_outside', tb.proof_at is not null),
        'rating_after', (
          select round(avg(x.rating)::numeric, 2) from public.reviews x
           where x.barber_id = r.barber_id and (x.state = 'public' or x.id = r.id)),
        'mark_to_clear', exists (
          select 1 from public.customer_marks m
           where m.booking_id = r.booking_id and m.cleared_at is null)
      )
      from public.review_appeals a
      join public.reviews r on r.id = a.review_id
      left join public.bookings b on b.id = r.booking_id
      left join public.profiles p on p.id = a.customer_id
      left join public.profiles bp on bp.id = r.barber_id
      left join public.profiles rp on rp.id = r.moderated_by
      left join public.barbers bb on bb.id = r.barber_id
      left join public.salons s on s.id = bb.salon_id
      left join lateral (
        select t.proof_at from public.shop_tasks t
         where t.salon_id = s.id and t.kind = 'review' and t.status = 'done'
         order by t.resolved_at desc limit 1) tb on true
      where a.id = v_id
    )
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_appeal_desk(uuid) to authenticated;
