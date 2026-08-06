-- 0045_appeals_and_support: customer turns 30–32 and barber turns 5–6.
--
-- These five turns are the two ends of the desk 0042/0043 built. Ops removes a
-- review; the customer is told and gets one appeal; a second reviewer decides;
-- the barber is told the outcome and answers in public. Plus the support console
-- both apps were missing — 0038 shipped the customer's filing half and said
-- "replies and resolutions come from the service role until support volume earns
-- a UI". 0042 gave ops that UI. This gives both apps theirs.

-- ---- support: the barber has cases too --------------------------------------
-- 5c reports about a booking, the float, a client, or the app. The customer's
-- four (0038) stay exactly as they were.
alter table public.support_cases drop constraint support_cases_reason_check;
alter table public.support_cases add constraint support_cases_reason_check
  check (reason in ('no_show', 'wrong_amount', 'wrong_service', 'hygiene', 'other',
                    'booking', 'money', 'client', 'app', 'review'));

-- the red "1" on a case row in 30a/5a
alter table public.support_cases add column user_read_at timestamptz;

create or replace function public.support_mark_read(p_case uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.support_cases set user_read_at = now()
   where id = p_case and user_id = auth.uid();
end;
$$;
grant execute on function public.support_mark_read(uuid) to authenticated;

-- 30a / 5a in one call: the case list with its unread count.
create or replace function public.my_support_cases()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'case_no', c.case_no, 'reason', c.reason, 'detail', c.detail,
           'amount_cents', c.amount_cents, 'refund_cents', c.refund_cents,
           'status', c.status, 'created_at', c.created_at, 'resolved_at', c.resolved_at,
           'booking_id', c.booking_id,
           'salon', s.name,
           'other', coalesce(op.full_name, sp.full_name),
           'unread', (select count(*) from public.support_messages m
                       where m.case_id = c.id
                         and m.sender_id is distinct from auth.uid()
                         and m.created_at > coalesce(c.user_read_at, 'epoch'::timestamptz))
         ) order by (c.status = 'open') desc, c.created_at desc), '[]'::json)
  from public.support_cases c
  left join public.bookings b  on b.id = c.booking_id
  left join public.barbers ba  on ba.id = b.barber_id
  left join public.salons  s   on s.id = ba.salon_id
  -- the person on the other side of the booking, whichever side you are
  left join public.profiles op on op.id = case when b.customer_id = auth.uid()
                                               then b.barber_id else b.customer_id end
  left join public.profiles sp on sp.id = b.barber_id
  where c.user_id = auth.uid();
$$;
grant execute on function public.my_support_cases() to authenticated;

-- A barber files about his own booking, a customer about theirs. Same function,
-- one more way to be a party to the thing you are reporting.
create or replace function public.file_support_case(
  p_booking uuid, p_reason text, p_detail text default null,
  p_photo text default null, p_amount_cents int default null)
returns setof public.support_cases
language plpgsql security definer set search_path = ''
as $$
declare
  c public.support_cases%rowtype;
begin
  if p_booking is not null and not exists (
    select 1 from public.bookings b
     where b.id = p_booking and (b.customer_id = auth.uid() or b.barber_id = auth.uid())
  ) then
    raise exception 'Not your booking';
  end if;

  insert into public.support_cases (user_id, booking_id, reason, detail, photo_path, amount_cents)
  values (auth.uid(), p_booking, p_reason, nullif(btrim(coalesce(p_detail, '')), ''),
          p_photo, p_amount_cents)
  returning * into c;

  if c.detail is not null then
    insert into public.support_messages (case_id, sender_id, body)
    values (c.id, auth.uid(), c.detail);
  end if;

  return next c;   -- the whole row, so the client never rebuilds it by hand
end;
$$;

-- 5b is a case ops opened, not one Youssef filed: "a client disputed your
-- rating · needs your reply". Nothing could do that before.
create or replace function public.admin_open_case(
  p_user uuid, p_reason text, p_detail text, p_booking uuid default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  c public.support_cases%rowtype;
  v_name text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if nullif(btrim(coalesce(p_detail, '')), '') is null then
    raise exception 'A case ops opens needs a first message';
  end if;

  insert into public.support_cases (user_id, booking_id, reason, detail)
  values (p_user, p_booking, p_reason, btrim(p_detail))
  returning * into c;

  select coalesce(full_name, 'Sterncut Support') into v_name
    from public.profiles where id = auth.uid();
  insert into public.support_messages (case_id, sender_id, author_name, body)
  values (c.id, auth.uid(), v_name, btrim(p_detail));

  insert into public.notifications (user_id, kind, title, body)
  values (p_user, 'moderation', 'Support opened a case', btrim(p_detail));

  return json_build_object('id', c.id, 'case_no', c.case_no);
end;
$$;
grant execute on function public.admin_open_case(uuid, text, text, uuid) to authenticated;

-- ---- 31 · one appeal per removed review -------------------------------------
create table public.review_appeals (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references public.reviews (id) on delete cascade,
  customer_id uuid not null references public.profiles (id),
  reason text not null,                 -- which of 31b's two lines he picked
  note text,                            -- "in your words"
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id),
  upheld boolean,
  decision_note text,                   -- 31d / 6a: what the second reviewer found
  -- 6a's action card. Null unless ops actually asks the shop for something, so
  -- the card is absent rather than invented.
  barber_action text,
  action_due date
);
create index review_appeals_open_idx on public.review_appeals (decided_at, created_at);

alter table public.review_appeals enable row level security;
-- The author and us. NOT the barber: 6a tells him the outcome and never that an
-- appeal happened, because the alternative is a grudge on the next bad review.
create policy review_appeals_select on public.review_appeals for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());
grant select on public.review_appeals to authenticated;
-- no insert grant: rows only appear through appeal_review()

create or replace function public.appeal_review(
  p_review uuid, p_reason text, p_note text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_id uuid;
begin
  select id, customer_id, state into r from public.reviews where id = p_review;
  if not found then raise exception 'Review not found'; end if;
  if r.customer_id <> auth.uid() then raise exception 'Not your review'; end if;
  if r.state <> 'removed' then raise exception 'That review is not taken down'; end if;
  if exists (select 1 from public.review_appeals a where a.review_id = p_review) then
    raise exception 'You have already appealed this one';   -- 31a: one shot
  end if;
  if coalesce(p_reason, '') = '' then raise exception 'Tell us what we are missing'; end if;

  insert into public.review_appeals (review_id, customer_id, reason, note)
  values (p_review, auth.uid(), p_reason, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return json_build_object('id', v_id);
end;
$$;
grant execute on function public.appeal_review(uuid, text, text) to authenticated;

create or replace function public.admin_decide_appeal(
  p_appeal uuid, p_upheld boolean, p_note text default null,
  p_action text default null, p_due date default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  v_barber uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if v_note is null then raise exception 'Say what the second reviewer found'; end if;

  select * into a from public.review_appeals where id = p_appeal;
  if not found then raise exception 'Appeal not found'; end if;
  if a.decided_at is not null then raise exception 'That appeal is already decided'; end if;

  update public.review_appeals
     set decided_at = now(), decided_by = auth.uid(), upheld = p_upheld,
         decision_note = v_note, barber_action = nullif(btrim(coalesce(p_action, '')), ''),
         action_due = p_due
   where id = p_appeal;

  select barber_id into v_barber from public.reviews where id = a.review_id;

  if p_upheld then
    update public.reviews
       set state = 'public', removal_reason = null, customer_note = null,
           moderated_at = now(), moderated_by = auth.uid()
     where id = a.review_id;
    insert into public.review_actions (review_id, admin_id, action, reason, note)
    values (a.review_id, auth.uid(), 'keep', 'appeal_upheld', v_note);

    insert into public.notifications (user_id, kind, title, body) values
      (a.customer_id, 'moderation', 'You were right', v_note),
      -- he is told the outcome, never that anyone appealed
      (v_barber, 'moderation', 'A review is back on your profile', v_note);
  else
    insert into public.notifications (user_id, kind, title, body)
    values (a.customer_id, 'moderation', 'Your appeal was not upheld', v_note);
  end if;
end;
$$;
grant execute on function public.admin_decide_appeal(uuid, boolean, text, text, date) to authenticated;

-- The desk's end of it. Without this an appeal is a dead end and 31c waits
-- forever, so it ships with the appeal rather than after it.
create or replace function public.admin_appeals()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select coalesce(json_agg(json_build_object(
           'id', a.id, 'review_id', r.id,
           'ref', 'RV-' || upper(left(replace(r.id::text, '-', ''), 4)),
           'reason', a.reason, 'note', a.note, 'created_at', a.created_at,
           'rating', r.rating, 'comment', r.comment,
           'removal_reason', r.removal_reason,
           'customer', coalesce(cp.full_name, 'Customer'),
           'barber', coalesce(bp.full_name, 'Barber'),
           -- the log the first decision leaned on, so the second reviewer sees
           -- what was actually held against them
           'slot', b.starts_at, 'checked_in_at', b.checked_in_at,
           'first_decision', (select x.note from public.review_actions x
                               where x.review_id = r.id and x.action = 'remove'
                               order by x.created_at desc limit 1)
         ) order by a.created_at), '[]'::json) into j
  from public.review_appeals a
  join public.reviews r on r.id = a.review_id
  left join public.bookings b  on b.id = r.booking_id
  left join public.profiles cp on cp.id = a.customer_id
  left join public.profiles bp on bp.id = r.barber_id
  where a.decided_at is null;
  return j;
end;
$$;
grant execute on function public.admin_appeals() to authenticated;

-- 31a/31c/31d read the whole story off one call: the review, why it went, the
-- appeal if there is one, and the check-in log the decision leaned on.
create or replace function public.my_removed_reviews()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', r.id,
           'ref', 'RV-' || upper(left(replace(r.id::text, '-', ''), 4)),
           'rating', r.rating, 'comment', r.comment, 'state', r.state,
           'created_at', r.created_at, 'moderated_at', r.moderated_at,
           'removal_reason', r.removal_reason, 'note', r.customer_note,
           'barber', coalesce(bp.full_name, 'Barber'),
           'salon', s.name,
           'visit', case when b.id is null then null else json_build_object(
             'service', sv.name, 'starts_at', b.starts_at,
             'checked_in_at', b.checked_in_at, 'started_at', b.started_at,
             'price_cents', b.price_cents) end,
           'appeal', case when a.id is null then null else json_build_object(
             'id', a.id, 'reason', a.reason, 'note', a.note, 'created_at', a.created_at,
             'decided_at', a.decided_at, 'upheld', a.upheld,
             'decision_note', a.decision_note, 'decided_by',
             (select full_name from public.profiles where id = a.decided_by)) end
         ) order by r.moderated_at desc nulls last), '[]'::json)
  from public.reviews r
  left join public.review_appeals a on a.review_id = r.id
  left join public.bookings b  on b.id = r.booking_id
  left join public.services sv on sv.id = b.service_id
  left join public.profiles bp on bp.id = r.barber_id
  left join public.barbers ba  on ba.id = r.barber_id
  left join public.salons  s   on s.id = ba.salon_id
  where r.customer_id = auth.uid()
    and (r.state = 'removed' or a.id is not null);
$$;
grant execute on function public.my_removed_reviews() to authenticated;

-- 6a is the barber's side of the same story, minus the appeal. He sees that a
-- review came back and what ops found — never who pushed.
create or replace function public.my_restored_reviews()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', r.id,
           'ref', 'RV-' || upper(left(replace(r.id::text, '-', ''), 4)),
           'rating', r.rating, 'comment', r.comment,
           'created_at', r.created_at, 'restored_at', a.decided_at,
           'customer', coalesce(split_part(cp.full_name, ' ', 1)
                       || ' ' || left(split_part(cp.full_name, ' ', 2), 1) || '.', 'A client'),
           'finding', a.decision_note,
           'by', (select full_name from public.profiles where id = a.decided_by),
           'action', a.barber_action, 'action_due', a.action_due,
           'rating_now', (select round(avg(x.rating)::numeric, 2) from public.reviews x
                           where x.barber_id = r.barber_id and x.state <> 'removed'),
           'rating_count', (select count(*) from public.reviews x
                             where x.barber_id = r.barber_id and x.state <> 'removed'),
           'reply', r.reply
         ) order by a.decided_at desc), '[]'::json)
  from public.reviews r
  join public.review_appeals a on a.review_id = r.id
  left join public.profiles cp on cp.id = r.customer_id
  where r.barber_id = auth.uid() and a.upheld and r.state = 'public';
$$;
grant execute on function public.my_restored_reviews() to authenticated;
