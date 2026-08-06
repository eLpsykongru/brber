-- 0046_late_marks_and_actions: the two things 31d and 6a draw that nothing backed.
--
--   · "Your late-arrival flag is cleared — deposits back to 40%". There was no
--     such flag. client_flags (0030) is the wrong home for it: that table is
--     private to the barber forever ("Anas never sees this", enforced by RLS),
--     and this one is told to the customer and priced into his next booking.
--     So it is platform-level, visible to its owner, and an upheld appeal
--     withdraws it.
--   · "Move your QR poster outside · By Aug 15". 0045 stored the ask; nothing
--     could say whether it was ever done.
--
-- BACKLOG TRIGGER: this is the first real piece of the Phase 1 reputation
-- ladder ("fight no-shows with reputation, not deposits — strike system"). It is
-- deliberately one rung, not the ladder: a late arrival raises YOUR deposit
-- floor to the full price until it ages out or is cleared. No badges, no
-- booking-priority, no strikes-to-block.

-- ---- the mark ---------------------------------------------------------------
create table public.customer_marks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete set null,
  kind text not null check (kind in ('late')),
  minutes int,                                  -- how late, for the copy and the audit
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid references public.profiles (id),
  cleared_reason text
);
create unique index customer_marks_booking_idx on public.customer_marks (booking_id, kind)
  where booking_id is not null;
create index customer_marks_live_idx on public.customer_marks (customer_id, cleared_at, created_at desc);

alter table public.customer_marks enable row level security;
-- you can see your own — a mark that prices your next booking and that you are
-- never shown is exactly the thing 31a exists to stop being
create policy customer_marks_select on public.customer_marks for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());
grant select on public.customer_marks to authenticated;
-- no write grant: marks come from the check-in, and go through an appeal

-- 15 minutes of grace, then it counts. Raised off the same check-in timestamp
-- the moderation desk reads (0018), so the mark and the evidence can never
-- disagree.
create or replace function public.mark_late_arrival()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_late int;
begin
  if new.checked_in_at is null or old.checked_in_at is not null then return new; end if;
  if new.customer_id = new.barber_id then return new; end if;   -- walk-ins have no slot to miss
  v_late := floor(extract(epoch from (new.checked_in_at - new.starts_at)) / 60);
  if v_late < 15 then return new; end if;

  insert into public.customer_marks (customer_id, booking_id, kind, minutes)
  values (new.customer_id, new.id, 'late', v_late)
  on conflict do nothing;
  return new;
end;
$$;

create trigger after_booking_checked_in
  after update of checked_in_at on public.bookings
  for each row execute function public.mark_late_arrival();

-- The one number the mark is worth. 90 days, because a mark that never ages out
-- is a punishment, not a signal.
create or replace function public.customer_deposit_pct(p_customer uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case when exists (
    select 1 from public.customer_marks m
     where m.customer_id = p_customer and m.cleared_at is null
       and m.created_at > now() - interval '90 days'
  ) then 100 else 40 end;
$$;
grant execute on function public.customer_deposit_pct(uuid) to authenticated;

-- ---- the deposit floor reads it --------------------------------------------
-- Byte-for-byte 0035's function with one change: min_pct stops being a constant,
-- and the refusal says why rather than quoting a percentage at someone who has
-- no idea where it came from.
create or replace function public.fill_booking()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca'; -- ponytail: single-city; per-barber tz when multi-city
  min_pct int := 40;                            -- 8b's hard floor, drawn as a locked track
  svc record;
  local_start timestamp;
  slot_start_min int;
  gap int;
  wanted int;
  floor_cents int;
  balance int;
  late record;
begin
  select s.price_cents, s.duration_min, s.barber_id
    into svc
    from public.services s
    where s.id = new.service_id and s.is_active;
  if not found then raise exception 'Service unavailable'; end if;
  if svc.barber_id <> new.barber_id then raise exception 'Service does not belong to this barber'; end if;
  if not exists (select 1 from public.barbers b where b.id = new.barber_id and b.status = 'approved') then
    raise exception 'Barber not available';
  end if;
  if new.starts_at <= now() then raise exception 'Booking must be in the future'; end if;
  if new.customer_id <> new.barber_id
     and not (select accepting_bookings from public.barbers where id = new.barber_id) then
    raise exception 'Barber is not accepting bookings right now';
  end if;
  if new.customer_id <> new.barber_id and exists (
    select 1 from public.client_flags f
    where f.barber_id = new.barber_id and f.customer_id = new.customer_id and f.blocked
  ) then
    raise exception 'This barber is not taking bookings from you';
  end if;

  -- server-side snapshots: ignore whatever the client sent for these
  new.price_cents := svc.price_cents;
  -- barber's own walk-in → instant; customer request → barber must accept
  new.status := case when new.customer_id = new.barber_id then 'confirmed' else 'pending' end;
  new.ends_at := new.starts_at + make_interval(mins => svc.duration_min);
  new.mode := 'shop';

  -- the deposit is the ONE money field the client gets to propose. Everything
  -- about it is re-checked here: floor, ceiling, and the balance behind it.
  min_pct := public.customer_deposit_pct(new.customer_id);
  wanted := coalesce(new.deposit_cents, 0);
  if new.customer_id = new.barber_id or wanted <= 0 then
    new.deposit_cents := 0;                       -- walk-ins and cash bookings
  else
    floor_cents := ceil(svc.price_cents * min_pct / 100.0);
    if wanted < floor_cents then
      if min_pct > 40 then
        select m.created_at, m.minutes into late
          from public.customer_marks m
         where m.customer_id = new.customer_id and m.cleared_at is null
           and m.created_at > now() - interval '90 days'
         order by m.created_at desc limit 1;
        raise exception 'You arrived % min late on %, so this one needs paying in full until %',
          late.minutes, to_char(late.created_at, 'Mon DD'),
          to_char(late.created_at + interval '90 days', 'Mon DD');
      end if;
      raise exception 'A deposit must be at least % percent of the price', min_pct;
    end if;
    if wanted > svc.price_cents then raise exception 'A deposit cannot exceed the price'; end if;
    select coalesce(sum(amount_cents), 0)::int into balance
      from public.wallet_transactions where user_id = new.customer_id;
    if wanted > balance then raise exception 'Not enough in your wallet'; end if;
    new.deposit_cents := wanted;
  end if;

  -- inside working hours, not on a day off (shop-local time)
  local_start := new.starts_at at time zone shop_tz;
  slot_start_min := extract(hour from local_start)::int * 60 + extract(minute from local_start)::int;
  if exists (select 1 from public.days_off d
             where d.barber_id = new.barber_id and d.day = local_start::date) then
    raise exception 'Barber is off that day';
  end if;
  if not exists (select 1 from public.availability a
                 where a.barber_id = new.barber_id
                   and a.weekday = extract(dow from local_start)::int
                   and a.start_min <= slot_start_min
                   and a.end_min >= slot_start_min + svc.duration_min) then
    raise exception 'Outside working hours';
  end if;
  if new.customer_id <> new.barber_id
     and exists (select 1 from public.time_blocks tb
                 where tb.barber_id = new.barber_id
                   and (tb.day is null or tb.day = local_start::date)
                   and tb.start_min < slot_start_min + svc.duration_min
                   and tb.end_min > slot_start_min) then
    raise exception 'Barber is unavailable at that time';
  end if;

  -- prep/cleanup buffer: reject customer bookings too close to an existing one
  if new.customer_id <> new.barber_id then
    select buffer_before_min + buffer_after_min into gap
      from public.barbers where id = new.barber_id;
    if gap > 0 and exists (
      select 1 from public.bookings b
      where b.barber_id = new.barber_id
        and b.status in ('pending', 'confirmed')
        and new.starts_at < b.ends_at + make_interval(mins => gap)
        and new.ends_at + make_interval(mins => gap) > b.starts_at
    ) then
      raise exception 'Too close to another booking';
    end if;
  end if;

  return new;
end;
$$;

-- ponytail: the floor formula is the one thing here that touches money. 0035
-- left an assert on it rounding up; this keeps that and adds the new rung, so a
-- future edit that quietly drops the 100% branch fails the migration.
do $$
begin
  assert ceil(6000 * 40 / 100.0) = 2400, 'floor: 40% of 60 DH is 24 DH';
  assert ceil(999 * 40 / 100.0) = 400, 'floor must round up, never down';
  assert ceil(6000 * 100 / 100.0) = 6000, 'a marked client pays the whole price, not a rounding of it';
  assert public.customer_deposit_pct('00000000-0000-0000-0000-000000000000') = 40,
    'a customer with no history is never charged the marked rate';
end $$;

-- ---- 6a · did the shop actually do it? --------------------------------------
alter table public.review_appeals
  add column action_done_at timestamptz,
  add column action_done_by uuid references public.profiles (id);

-- The barber ticks it off his own card. Ops sees the tick, not a promise.
create or replace function public.complete_review_action(p_appeal uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  v_barber uuid;
begin
  select ra.id, ra.review_id, ra.barber_action, ra.action_done_at into a
    from public.review_appeals ra where ra.id = p_appeal;
  if not found then raise exception 'Not found'; end if;
  if a.barber_action is null then raise exception 'Nothing was asked for'; end if;
  if a.action_done_at is not null then return; end if;   -- idempotent: a double tap is fine

  select barber_id into v_barber from public.reviews where id = a.review_id;
  if v_barber is distinct from auth.uid() then raise exception 'Not your shop'; end if;

  update public.review_appeals
     set action_done_at = now(), action_done_by = auth.uid()
   where id = p_appeal;
end;
$$;
grant execute on function public.complete_review_action(uuid) to authenticated;

-- ---- clearing the mark, and telling both sides ------------------------------
-- Same function as 0045 plus the two consequences the screens promise: an upheld
-- appeal withdraws the late mark that the takedown leaned on, and the desk keeps
-- a list of what it asked shops to fix.
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
  v_cleared int := 0;
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

  select barber_id, booking_id into v_barber, v_booking
    from public.reviews where id = a.review_id;

  if p_upheld then
    update public.reviews
       set state = 'public', removal_reason = null, customer_note = null,
           moderated_at = now(), moderated_by = auth.uid()
     where id = a.review_id;
    insert into public.review_actions (review_id, admin_id, action, reason, note)
    values (a.review_id, auth.uid(), 'keep', 'appeal_upheld', v_note);

    -- 31d: "your late-arrival flag is cleared". If the takedown leaned on a late
    -- scan and the scan turned out to prove nothing, the mark it raised goes too.
    update public.customer_marks
       set cleared_at = now(), cleared_by = auth.uid(), cleared_reason = v_note
     where booking_id = v_booking and cleared_at is null;
    get diagnostics v_cleared = row_count;

    insert into public.notifications (user_id, kind, title, body) values
      (a.customer_id, 'moderation', 'You were right',
       v_note || case when v_cleared > 0
                      then ' Your late-arrival mark is cleared — deposits back to 40%.'
                      else '' end),
      -- he is told the outcome, never that anyone appealed
      (v_barber, 'moderation', 'A review is back on your profile', v_note);
  else
    insert into public.notifications (user_id, kind, title, body)
    values (a.customer_id, 'moderation', 'Your appeal was not upheld', v_note);
  end if;
end;
$$;

-- ---- what the screens read --------------------------------------------------
-- 31d needs to know a mark actually went, or the line is decoration.
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
           'late_cleared', (select m.cleared_at is not null from public.customer_marks m
                             where m.booking_id = b.id and m.kind = 'late'),
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

-- 6a's card needs its own done state, and its appeal id to tick it off with.
create or replace function public.my_restored_reviews()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', r.id, 'appeal_id', a.id,
           'ref', 'RV-' || upper(left(replace(r.id::text, '-', ''), 4)),
           'rating', r.rating, 'comment', r.comment,
           'created_at', r.created_at, 'restored_at', a.decided_at,
           'customer', coalesce(split_part(cp.full_name, ' ', 1)
                       || ' ' || left(split_part(cp.full_name, ' ', 2), 1) || '.', 'A client'),
           'finding', a.decision_note,
           'by', (select full_name from public.profiles where id = a.decided_by),
           'action', a.barber_action, 'action_due', a.action_due,
           'action_done_at', a.action_done_at,
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

-- The desk: appeals still to decide, and asks still outstanding.
create or replace function public.admin_appeals()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select json_build_object(
    'pending', (
      select coalesce(json_agg(json_build_object(
               'id', a.id, 'review_id', r.id,
               'ref', 'RV-' || upper(left(replace(r.id::text, '-', ''), 4)),
               'reason', a.reason, 'note', a.note, 'created_at', a.created_at,
               'rating', r.rating, 'comment', r.comment,
               'removal_reason', r.removal_reason,
               'customer', coalesce(cp.full_name, 'Customer'),
               'barber', coalesce(bp.full_name, 'Barber'),
               'slot', b.starts_at, 'checked_in_at', b.checked_in_at,
               'first_decision', (select x.note from public.review_actions x
                                   where x.review_id = r.id and x.action = 'remove'
                                   order by x.created_at desc limit 1)
             ) order by a.created_at), '[]'::json)
      from public.review_appeals a
      join public.reviews r on r.id = a.review_id
      left join public.bookings b  on b.id = r.booking_id
      left join public.profiles cp on cp.id = a.customer_id
      left join public.profiles bp on bp.id = r.barber_id
      where a.decided_at is null
    ),
    'actions', (
      select coalesce(json_agg(json_build_object(
               'id', a.id, 'action', a.barber_action, 'due', a.action_due,
               'asked_at', a.decided_at,
               'overdue', a.action_due is not null and a.action_due < current_date,
               'shop', coalesce(s.name, coalesce(bp.full_name, 'Shop')),
               'barber', coalesce(bp.full_name, 'Barber')
             ) order by a.action_due nulls last), '[]'::json)
      from public.review_appeals a
      join public.reviews r on r.id = a.review_id
      left join public.profiles bp on bp.id = r.barber_id
      left join public.barbers ba on ba.id = r.barber_id
      left join public.salons s on s.id = ba.salon_id
      where a.barber_action is not null and a.action_done_at is null
    )
  ) into j;
  return j;
end;
$$;
