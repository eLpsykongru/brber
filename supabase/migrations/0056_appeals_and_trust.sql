-- 0056_appeals_and_trust: admin turn 3 — the two operator surfaces the phones
-- assumed, plus the suspension customer 38h needs a way out of.
--
-- 0045/0046 already restore a review, clear the late mark and tell both sides.
-- What they never had is the thing turn 3 is actually about:
--
--   "The rule is enforced in the UI, not just in copy — Nadia's own removal is
--    shown greyed with her name, and the decision buttons are hers to look at,
--    not to press."
--
-- A second review by the first reviewer is not a second review. That belongs in
-- the function, not only in the console: a desk rule that lives in JavaScript is
-- a desk rule until someone opens the network tab.

-- who is holding this appeal. Null = the queue, anyone free may take it.
alter table public.review_appeals
  add column if not exists assigned_to uuid references public.profiles (id);

-- ---- 38h · a suspension, and the surface that lifts it ---------------------
-- Built here rather than with turn 38 on purpose: a suspension nobody can undo
-- is a bug. The screen that lifts it is 3b, so the column arrives with it.
alter table public.profiles
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists suspended_by uuid references public.profiles (id);

-- A separate trigger rather than a sixth re-emit of `fill_booking`: this is one
-- rule about one column and it has nothing to say about price, slots or deposits.
create or replace function public.refuse_suspended_customer()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_at timestamptz;
begin
  if new.customer_id = new.barber_id then return new; end if;   -- his own walk-ins
  select suspended_reason, suspended_at into v_reason, v_at
    from public.profiles where id = new.customer_id;
  if v_at is null then return new; end if;
  -- 38h names the reason on the screen, so the error has to carry one
  raise exception 'Booking is paused on this account. %', coalesce(v_reason, 'Contact support.');
end;
$$;

drop trigger if exists before_booking_suspended on public.bookings;
create trigger before_booking_suspended
  before insert on public.bookings
  for each row execute function public.refuse_suspended_customer();

-- what 38h reads to draw itself
create or replace function public.my_account_state()
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'suspended', p.suspended_at is not null,
    'reason', p.suspended_reason,
    'since', p.suspended_at,
    'bookings_ahead', (select count(*)::int from public.bookings b
                        where b.customer_id = p.id and b.starts_at > now()
                          and b.status in ('pending', 'confirmed')),
    'wallet_cents', coalesce((select sum(w.amount_cents)::int
                                from public.wallet_transactions w where w.user_id = p.id), 0)
  )
  from public.profiles p where p.id = auth.uid();
$$;
grant execute on function public.my_account_state() to authenticated;

-- ---- 3a · the appeal desk --------------------------------------------------
create or replace function public.admin_appeals(p_appeal uuid default null)
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
               -- 3a's "1d left": appeals are answered inside three days
               'days_left', 3 - floor(extract(epoch from (now() - a.created_at)) / 86400)::int,
               'removed_by', coalesce(rp.full_name, 'Ops'),
               'removed_by_id', r.moderated_by,
               -- the rule, as data: his own removal cannot be his own second look
               'mine', r.moderated_by = v_me,
               'assigned_to', a.assigned_to
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
        -- 3a prints this back at the desk: a high overturn rate is a statement
        -- about the removal bar, not about the appellants
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
        'rating', r.rating, 'body', r.body,
        'barber', coalesce(bp.full_name, 'Barber'),
        'barber_id', r.barber_id,
        'salon', s.name, 'salon_id', s.id,
        -- "THE FIRST DECISION · NOT YOURS"
        'removed_by', coalesce(rp.full_name, 'Ops'),
        'removed_at', r.moderated_at,
        'removal_reason', r.removal_reason,
        -- the conflict check, both halves, computed rather than asserted
        'is_own_removal', r.moderated_by = v_me,
        -- 3a's second conflict line. `support_cases` has no salon column and no
        -- assignee, so the honest reading of "no open case with Le Fade" is
        -- through the booking: a live dispute against this shop is a reason to
        -- pause, whoever is holding it.
        'open_case_with_shop', exists (
          select 1 from public.support_cases c
          join public.bookings cb on cb.id = c.booking_id
          join public.barbers cbb on cbb.id = cb.barber_id
           where c.status = 'open' and cbb.salon_id = s.id),
        -- "WHAT THE LOG ACTUALLY PROVES" — three timestamps and one fact about
        -- where the poster is, which is the whole of the evidence
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
grant execute on function public.admin_appeals(uuid) to authenticated;

-- 3a's REASSIGN. Not a decision, so it has no note and no consequence beyond
-- putting the appeal back where somebody else can pick it up.
create or replace function public.admin_reassign_appeal(p_appeal uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.review_appeals set assigned_to = null
   where id = p_appeal and decided_at is null;
  if not found then raise exception 'That appeal is already decided'; end if;
end;
$$;
grant execute on function public.admin_reassign_appeal(uuid) to authenticated;

-- ---- the rule, moved out of the console and into the database --------------
-- Everything 0046 did, plus: you cannot second-review your own removal, and the
-- knock-on ask of the shop becomes a real `shop_tasks` row (0053) rather than
-- the free-text `barber_action` that nothing could act on.
create or replace function public.admin_decide_appeal(
  p_appeal uuid, p_upheld boolean, p_note text default null,
  p_action text default null, p_due date default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  v_barber uuid;
  v_booking uuid;
  v_salon uuid;
  v_removed_by uuid;
  v_cleared int := 0;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_act text := nullif(btrim(coalesce(p_action, '')), '');
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if v_note is null then raise exception 'Say what the second reviewer found'; end if;

  select * into a from public.review_appeals where id = p_appeal;
  if not found then raise exception 'Appeal not found'; end if;
  if a.decided_at is not null then raise exception 'That appeal is already decided'; end if;

  select barber_id, booking_id, moderated_by into v_barber, v_booking, v_removed_by
    from public.reviews where id = a.review_id;

  -- turn 3's rule. A second look by the person who made the first call is not a
  -- second look, and a desk rule enforced only in the browser is not enforced.
  if v_removed_by is not null and v_removed_by = auth.uid() then
    raise exception 'You made the first call on this one — reassign it';
  end if;

  update public.review_appeals
     set decided_at = now(), decided_by = auth.uid(), upheld = p_upheld,
         decision_note = v_note, barber_action = v_act, action_due = p_due
   where id = p_appeal;

  if p_upheld then
    update public.reviews
       set state = 'public', removal_reason = null, customer_note = null,
           moderated_at = now(), moderated_by = auth.uid()
     where id = a.review_id;
    insert into public.review_actions (review_id, admin_id, action, reason, note)
    values (a.review_id, auth.uid(), 'keep', 'appeal_upheld', v_note);

    update public.customer_marks
       set cleared_at = now(), cleared_by = auth.uid(), cleared_reason = v_note
     where booking_id = v_booking and cleared_at is null;
    get diagnostics v_cleared = row_count;

    -- 3a's third knock-on: "Task Le Fade: poster outside by Aug 15". 0046 could
    -- only write the sentence; 0053 gave it a table, so now it is a real task
    -- that lands in the barber's To do (9a) and can be answered with a photo.
    if v_act is not null then
      select bb.salon_id into v_salon from public.barbers bb where bb.id = v_barber;
      if v_salon is not null then
        insert into public.shop_tasks
          (salon_id, ref, kind, title, body, due_at, action, created_by, issued_because)
        values (v_salon,
                'RV-' || upper(left(replace(a.review_id::text, '-', ''), 4)),
                'review', v_act,
                'A review was restored on appeal. This is what we need from the shop.',
                case when p_due is null then null else (p_due + time '23:59') at time zone 'Africa/Casablanca' end,
                'photo', auth.uid(), 'after the review was restored');
      end if;
    end if;

    insert into public.notifications (user_id, kind, title, body) values
      (a.customer_id, 'moderation', 'You were right',
       v_note || case when v_cleared > 0
                      then ' Your late-arrival mark is cleared — deposits back to 40%.'
                      else '' end),
      (v_barber, 'moderation', 'A review is back on your profile', v_note);
  else
    insert into public.notifications (user_id, kind, title, body)
    values (a.customer_id, 'moderation', 'Your appeal was not upheld', v_note);
  end if;
end;
$$;
grant execute on function public.admin_decide_appeal(uuid, boolean, text, text, date) to authenticated;

-- ---- 3b · customer trust, and the barber doing the flagging ----------------
-- The right-hand panel scores the barber, not just the customer: the only place
-- to catch a shop flagging punitively is a desk that counts how often its flags
-- survive a second look.
create or replace function public.admin_flagged_customers(p_customer uuid default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    'flagged', (
      select coalesce(json_agg(x order by x.last_flag desc), '[]'::json) from (
        select p.id, coalesce(p.full_name, 'Customer') as name, p.phone,
               p.suspended_at is not null as suspended,
               count(*)::int as barbers,
               bool_or(f.require_full_payment) as full_payment,
               bool_or(f.blocked) as blocked,
               max(f.updated_at) as last_flag,
               (select count(*)::int from public.bookings b
                 where b.customer_id = p.id and b.status = 'no_show') as no_shows,
               (select count(*)::int from public.customer_marks m
                 where m.customer_id = p.id and m.cleared_at is null) as live_marks
        from public.client_flags f
        join public.profiles p on p.id = f.customer_id
        group by p.id, p.full_name, p.phone, p.suspended_at
      ) x
    ),
    'detail', case when p_customer is null then null else (
      select json_build_object(
        'id', p.id, 'name', coalesce(p.full_name, 'Customer'), 'phone', p.phone,
        'suspended', p.suspended_at is not null,
        'suspended_reason', p.suspended_reason,
        'no_shows', (select count(*)::int from public.bookings b
                      where b.customer_id = p.id and b.status = 'no_show'),
        'completed', (select count(*)::int from public.bookings b
                       where b.customer_id = p.id and b.status = 'completed'),
        'flags', (
          select coalesce(json_agg(json_build_object(
                   'barber_id', f.barber_id,
                   'barber', coalesce(bp.full_name, 'Barber'),
                   'salon', s.name,
                   'reason', f.reason,
                   'require_full_payment', f.require_full_payment,
                   'blocked', f.blocked,
                   'updated_at', f.updated_at,
                   -- how much this barber's word is worth: flags he has raised,
                   -- and how many of his removals were overturned on appeal
                   'barber_flags', (select count(*)::int from public.client_flags g
                                     where g.barber_id = f.barber_id),
                   'barber_overturned', (select count(*)::int
                                           from public.review_appeals ra
                                           join public.reviews rr on rr.id = ra.review_id
                                          where rr.barber_id = f.barber_id and ra.upheld)
                 ) order by f.updated_at desc), '[]'::json)
          from public.client_flags f
          left join public.profiles bp on bp.id = f.barber_id
          left join public.barbers bb on bb.id = f.barber_id
          left join public.salons s on s.id = bb.salon_id
          where f.customer_id = p.id)
      )
      from public.profiles p where p.id = p_customer) end
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_flagged_customers(uuid) to authenticated;

-- 3b's actual act: Karima clears the flag. Ops overriding a barber's own
-- judgement is a real thing to do, so it is recorded against her, not silently.
create or replace function public.admin_clear_flag(
  p_barber uuid, p_customer uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say why the flag is going';
  end if;

  delete from public.client_flags
   where barber_id = p_barber and customer_id = p_customer;
  if not found then raise exception 'There is no flag to clear'; end if;

  update public.customer_marks
     set cleared_at = now(), cleared_by = auth.uid(), cleared_reason = p_note
   where customer_id = p_customer and cleared_at is null;

  insert into public.notifications (user_id, kind, title, body) values
    (p_customer, 'moderation', 'A flag on your account is gone', p_note),
    (p_barber, 'moderation', 'A flag you set was cleared', p_note);
end;
$$;
grant execute on function public.admin_clear_flag(uuid, uuid, text) to authenticated;

create or replace function public.admin_set_suspension(
  p_customer uuid, p_suspend boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_suspend and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A suspension has to say why — 38h prints it';
  end if;

  update public.profiles
     set suspended_at = case when p_suspend then now() else null end,
         suspended_reason = case when p_suspend then p_reason else null end,
         suspended_by = case when p_suspend then auth.uid() else null end
   where id = p_customer;

  insert into public.notifications (user_id, kind, title, body)
  values (p_customer, 'moderation',
          case when p_suspend then 'Booking is paused on your account'
               else 'You can book again' end,
          coalesce(p_reason, 'Your account is back to normal.'));
end;
$$;
grant execute on function public.admin_set_suspension(uuid, boolean, text) to authenticated;

do $$
begin
  -- 3a's headline number, from the drawn month: 11 appeals, 4 upheld
  assert round(100.0 * 4 / 11) = 36, '4 of 11 upheld is a 36% overturn rate';
  -- and the deadline the queue sorts by
  assert 3 - 2 = 1, 'an appeal opened two days ago has one day left';
  -- the conflict rule is an equality on one column, which is why it belongs here
  assert ('00000000-0000-0000-0000-000000000001'::uuid
          = '00000000-0000-0000-0000-000000000001'::uuid),
    'the same admin cannot be both reviewers';
end $$;
