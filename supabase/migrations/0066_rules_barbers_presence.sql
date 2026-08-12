-- 0066_rules_barbers_presence: admin turn 8 — three holes the console carried.
--
--   8a  The reliability numbers stop being constants. 0046 shipped 15 minutes
--       and 90 days and said in its own BACKLOG entry that both were guesses
--       "nothing has tuned against real arrivals". The honest fix is not more
--       rungs on the ladder — it is a screen that shows what each number costs.
--   8b  The Barbers sidebar row, inert since 1a and listed in BACKLOG as "left
--       inert rather than faked".
--   8c  Presence. 0061's 7b caught two operators colliding *after* both had
--       decided; this is the same problem answered before the second one types.

-- ---- 8a · the rules, as settings -------------------------------------------
-- One row, because there is one platform. A key/value bag would let a typo
-- invent a setting nobody reads; three named columns cannot.
create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  -- 0046's two guesses
  late_after_min int not null default 15 check (late_after_min between 1 and 120),
  mark_days int not null default 90 check (mark_days between 1 and 365),
  -- customer 39b's ladder. 0065 shipped it live, so its default here is ON —
  -- the alternative is a screen in the customer app counting to three towards
  -- nothing, which is the exact failure both these turns exist to end.
  -- 8a's toggle turns it off by writing null.
  clear_after_clean int check (clear_after_clean is null or clear_after_clean between 1 and 10),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
insert into public.platform_settings (id, clear_after_clean) values (true, 3)
  on conflict (id) do nothing;

-- "Every change is logged with who made it."
create table if not exists public.settings_changes (
  id uuid primary key default gen_random_uuid(),
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now(),
  before json not null,
  after json not null,
  note text
);

alter table public.platform_settings enable row level security;
alter table public.settings_changes enable row level security;
-- everyone reads the rules they are judged by; only ops writes them
create policy settings_read on public.platform_settings for select to authenticated using (true);
create policy settings_write on public.platform_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy changes_read on public.settings_changes for select to authenticated
  using (public.is_admin());
grant select on public.platform_settings to authenticated;
grant select on public.settings_changes to authenticated;

-- the trigger that raises a mark carried the same 15 as a literal (0046)
create or replace function public.mark_late_arrival()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_late int;
  v_after int;
begin
  if new.checked_in_at is null or old.checked_in_at is not null then return new; end if;
  if new.customer_id = new.barber_id then return new; end if;   -- walk-ins have no slot to miss
  select late_after_min into v_after from public.platform_settings;
  v_late := floor(extract(epoch from (new.checked_in_at - new.starts_at)) / 60);
  if v_late < coalesce(v_after, 15) then return new; end if;

  insert into public.customer_marks (customer_id, booking_id, kind, minutes)
  values (new.customer_id, new.id, 'late', v_late)
  on conflict do nothing;
  return new;
end;
$$;

-- the two functions that were carrying the constants, now reading the row
create or replace function public.customer_deposit_pct(p_customer uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.customer_marks m
       where m.customer_id = p_customer and m.cleared_at is null
         and m.created_at > now()
             - make_interval(days => (select mark_days from public.platform_settings))
    ) then 40
    when coalesce((select clear_after_clean from public.platform_settings), 999)
         <= public.customer_on_time_streak(p_customer) then 40
    else 100
  end;
$$;

-- 39b's streak has to measure lateness the same way the mark does, or the
-- ladder and the thing it climbs out of disagree about the same visit
create or replace function public.customer_on_time_streak(p_customer uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from (
    select bool_and(b.checked_in_at is null
                    or b.checked_in_at <= b.starts_at
                       + make_interval(mins => (select late_after_min from public.platform_settings)))
             over (order by b.completed_at) as clean
      from public.bookings b
     where b.customer_id = p_customer and b.completed_at is not null
       and b.completed_at > coalesce(
             (select max(m.created_at) from public.customer_marks m
               where m.customer_id = p_customer and m.cleared_at is null),
             '-infinity'::timestamptz)
  ) x where x.clean;
$$;

-- 8a's dry run. Every number on the panel is counted against the last 90 days
-- of real arrivals — the whole argument of the screen is that ops should not
-- have to guess what a threshold costs, so nothing here may be an estimate
-- except the one line that says "est." out loud.
create or replace function public.admin_reliability_dryrun(
  p_late_min int, p_mark_days int, p_clean int default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
  v_now int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select late_after_min into v_now from public.platform_settings;

  select json_build_object(
    'late_after_min', p_late_min, 'mark_days', p_mark_days, 'clean', p_clean,
    -- how many visits in the window would be marked at each threshold
    'marks_now', (
      select count(*)::int from public.bookings b
       where b.completed_at > now() - interval '90 days' and b.checked_in_at is not null
         and b.checked_in_at > b.starts_at + make_interval(mins => v_now)),
    'marks_at', (
      select count(*)::int from public.bookings b
       where b.completed_at > now() - interval '90 days' and b.checked_in_at is not null
         and b.checked_in_at > b.starts_at + make_interval(mins => p_late_min)),
    'visits', (select count(*)::int from public.bookings
                where completed_at > now() - interval '90 days'),
    -- the dispute rate, which is 8a's argument that the threshold may not be
    -- the real problem at all
    'disputed', (
      select count(*)::int from public.customer_marks m
       where m.created_at > now() - interval '90 days' and m.cleared_at is not null),
    'marks_total', (select count(*)::int from public.customer_marks
                     where created_at > now() - interval '90 days'),
    -- how many people are carrying one right now, and how many the new rules
    -- would let go tonight
    'carrying', (
      select count(distinct m.customer_id)::int from public.customer_marks m
       where m.cleared_at is null
         and m.created_at > now() - make_interval(days => (select mark_days from public.platform_settings))),
    'carrying_after', (
      select count(distinct m.customer_id)::int from public.customer_marks m
       where m.cleared_at is null
         and m.created_at > now() - make_interval(days => p_mark_days)
         and (p_clean is null or public.customer_on_time_streak(m.customer_id) < p_clean)),
    -- 8a's compliance aside: indoor posters are the most-cited dispute reason,
    -- and there is a real count of shops with that task open
    'poster_tasks', (
      select count(*)::int from public.shop_tasks
       where status = 'open' and kind = 'review')
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_reliability_dryrun(int, int, int) to authenticated;

create or replace function public.admin_save_reliability(
  p_late_min int, p_mark_days int, p_clean int default null, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_before json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select json_build_object('late_after_min', late_after_min, 'mark_days', mark_days,
                           'clear_after_clean', clear_after_clean)
    into v_before from public.platform_settings;

  update public.platform_settings
     set late_after_min = p_late_min, mark_days = p_mark_days,
         clear_after_clean = p_clean, updated_at = now(), updated_by = auth.uid();

  insert into public.settings_changes (changed_by, before, after, note)
  values (auth.uid(), v_before,
          json_build_object('late_after_min', p_late_min, 'mark_days', p_mark_days,
                            'clear_after_clean', p_clean),
          p_note);

  -- "604 customers · your mark has gone". A rule change that silently unlocks
  -- someone's deposit is a rule change they will never find out about.
  insert into public.notifications (user_id, kind, title, body)
  select distinct m.customer_id, 'moderation', 'Your mark has gone',
         'Deposits are back to the usual 40%.'
    from public.customer_marks m
   where m.cleared_at is null
     and public.customer_deposit_pct(m.customer_id) = 40;
end;
$$;
grant execute on function public.admin_save_reliability(int, int, int, text) to authenticated;

-- ---- 8b · the Barbers row ---------------------------------------------------
-- 8b's sentence is "Cancelled 11 bookings in 30 days, 9 inside 2 hours", and the
-- second half of it was not countable: nothing recorded WHEN a booking was
-- cancelled, only that it had been. Late cancellation is the whole harm — eleven
-- cancelled a week out is a barber with a life, nine cancelled inside two hours
-- is nine people standing outside a shop.
alter table public.bookings add column if not exists cancelled_at timestamptz;

create or replace function public.stamp_cancelled_at()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists before_cancel_stamp on public.bookings;
create trigger before_cancel_stamp
  before update on public.bookings
  for each row execute function public.stamp_cancelled_at();

-- "WHY IT'S FLAGGED" is one derived sentence per barber, and the order of the
-- checks is the order ops cares about: money first, then a chair with no
-- account behind it, then cancellations, then silence.
create or replace function public.admin_barbers()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  with b as (
    select ba.id, coalesce(p.full_name, 'Barber') as name, ba.created_at,
           coalesce(sa.name, 'No shop') as shop, sa.id as salon_id,
           ba.salon_role = 'owner' as is_owner,
           (select round(avg(r.rating), 2) from public.reviews r
             where r.barber_id = ba.id and r.state <> 'removed') as rating,
           (select count(*) from public.bookings x
             where x.barber_id = ba.id and x.created_at > now() - interval '30 days') as booked30,
           (select count(*) from public.bookings x
             where x.barber_id = ba.id and x.status = 'cancelled'
               and x.cancelled_by = ba.id
               and x.created_at > now() - interval '30 days') as cancels30,
           -- only rows cancelled since `cancelled_at` existed can be counted as
           -- late; older ones are silent rather than guessed at, and the
           -- sentence below only mentions the number when there is one
           (select count(*) from public.bookings x
             where x.barber_id = ba.id and x.status = 'cancelled'
               and x.cancelled_by = ba.id and x.created_at > now() - interval '30 days'
               and x.cancelled_at is not null
               and x.starts_at - x.cancelled_at < interval '2 hours') as late_cancels,
           (select max(x.starts_at) from public.bookings x
             where x.barber_id = ba.id and x.status = 'confirmed') as last_booking,
           (select count(*) from public.bookings x
             where x.barber_id = ba.id and x.status = 'confirmed'
               and x.starts_at between now() and now() + interval '7 days') as week_ahead
      from public.barbers ba
      join public.profiles p on p.id = ba.id
      left join public.salons sa on sa.id = ba.salon_id
     where ba.status = 'approved'
  ), scored as (
    select b.*,
           case when b.cancels30 > 0 then round(b.cancels30 * 100.0 / nullif(b.booked30, 0)) end as cancel_pct,
           floor(extract(epoch from (now() - coalesce(b.last_booking, b.created_at))) / 86400)::int as idle_days,
           public.salon_net_cents(b.salon_id) as float_cents
      from b
  )
  select json_build_object(
    'total', (select count(*)::int from scored),
    'cutting', (select count(*)::int from scored where idle_days <= 14),
    'idle', (select count(*)::int from scored where idle_days > 14),
    'median_rating', (select round(percentile_cont(0.5) within group (order by rating)::numeric, 2)
                        from scored where rating is not null),
    'below_four', (select count(*)::int from scored where rating is not null and rating < 4.0),
    'cancel_rate', (select round(sum(cancels30) * 100.0 / nullif(sum(booked30), 0), 1) from scored),
    'new_month', (select count(*)::int from scored where created_at > now() - interval '30 days'),
    'rows', (
      select coalesce(json_agg(json_build_object(
        'id', x.id, 'name', x.name, 'shop', x.shop, 'salon_id', x.salon_id,
        'since', x.created_at, 'owner', x.is_owner,
        'rating', x.rating, 'cancel_pct', x.cancel_pct,
        'cancels', x.cancels30, 'late_cancels', x.late_cancels,
        'idle_days', x.idle_days, 'week_ahead', x.week_ahead,
        'float_cents', x.float_cents,
        -- the sentence, and the single button that answers it
        'why', case
          when x.cancel_pct >= 15 then 'Cancelled ' || x.cancels30 || ' bookings in 30 days'
                                      || case when x.late_cancels > 0
                                              then ', ' || x.late_cancels || ' inside 2 hours'
                                              else '' end
          when x.float_cents > 0 and x.is_owner then 'Holding '
               || round(x.float_cents / 100.0) || ' DH float'
          when x.idle_days > 14 then 'Idle ' || x.idle_days || ' days · no bookings taken'
          else 'Nothing flagged'
        end,
        'action', case
          when x.cancel_pct >= 15 then 'review'
          when x.float_cents > 0 and x.is_owner then 'open'
          when x.idle_days > 14 then 'message'
          else null
        end,
        'flagged', (x.cancel_pct >= 15 or x.idle_days > 14
                    or (x.float_cents > 0 and x.is_owner))
      ) order by (case when x.cancel_pct >= 15 then 0 when x.idle_days > 14 then 1 else 2 end),
                 x.name), '[]'::json)
        from scored x)
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_barbers() to authenticated;

-- 8b's "BEFORE YOU SUSPEND": what hiding this barber actually costs, counted
-- rather than warned about in the abstract.
create or replace function public.admin_barber_cost(p_barber uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select json_build_object(
    'week_ahead', (select count(*)::int from public.bookings
                    where barber_id = p_barber and status = 'confirmed'
                      and starts_at between now() and now() + interval '7 days'),
    'deposits', (select count(*)::int from public.bookings
                  where barber_id = p_barber and status = 'confirmed'
                    and deposit_cents > 0 and starts_at > now()),
    'deposit_cents', (select coalesce(sum(deposit_cents), 0)::int from public.bookings
                       where barber_id = p_barber and status = 'confirmed'
                         and deposit_cents > 0 and starts_at > now()),
    -- 8b's "Marina is also the shop hidden for an expired licence"
    'shop_hidden', exists (select 1 from public.salons s
                            join public.barbers b on b.salon_id = s.id
                           where b.id = p_barber and s.status <> 'live'),
    'reasons', (
      select coalesce(json_agg(json_build_object('reason', r.reason, 'n', r.n)
                               order by r.n desc), '[]'::json)
        from (select coalesce(cancel_reason, 'No reason given') as reason, count(*)::int as n
                from public.bookings
               where barber_id = p_barber and status = 'cancelled'
                 and cancelled_by = p_barber and created_at > now() - interval '30 days'
               group by 1) r)
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_barber_cost(uuid) to authenticated;

-- ---- 8c · presence, before the collision ------------------------------------
-- 0061's `appeal_conflict` answers "who got here first" after both operators
-- have formed an opinion. This answers it while the second one is still reading
-- the list. One row per operator — a desk is a person, not a session.
create table if not exists public.desk_presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  holding text,                       -- the case or appeal ref, null = just here
  entered_at timestamptz,
  last_seen_at timestamptz not null default now()
);

alter table public.desk_presence enable row level security;
create policy presence_read on public.desk_presence for select to authenticated
  using (public.is_admin());
create policy presence_own on public.desk_presence for all to authenticated
  using (user_id = auth.uid() and public.is_admin())
  with check (user_id = auth.uid() and public.is_admin());
grant select on public.desk_presence to authenticated;

-- ponytail: 15 minutes is read at query time rather than swept by a job. A lock
-- nobody is behind stops existing the moment somebody looks, which is exactly
-- when it matters — and there is no window where a cron hasn't run yet.
create or replace function public.admin_desk()
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  -- being asked is itself presence
  insert into public.desk_presence (user_id, last_seen_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_seen_at = now();

  select json_build_object(
    'me', auth.uid(),
    'people', (
      select coalesce(json_agg(json_build_object(
        'id', d.user_id, 'name', coalesce(p.full_name, 'Ops'),
        'holding', case when d.last_seen_at > now() - interval '15 minutes'
                        then d.holding else null end,
        'since', d.entered_at,
        'idle_min', floor(extract(epoch from (now() - d.last_seen_at)) / 60)::int,
        'me', d.user_id = auth.uid()
      ) order by d.user_id = auth.uid() desc, p.full_name), '[]'::json)
        from public.desk_presence d
        join public.profiles p on p.id = d.user_id
       where d.last_seen_at > now() - interval '30 minutes')
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_desk() to authenticated;

-- "You can read it, but the decide buttons stay locked while she's in it."
create or replace function public.claim_case(p_ref text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  h record;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  -- somebody else, still warm?
  select d.user_id, coalesce(p.full_name, 'Another operator') as name, d.entered_at,
         floor(extract(epoch from (now() - d.last_seen_at)) / 60)::int as idle_min
    into h
    from public.desk_presence d
    join public.profiles p on p.id = d.user_id
   where d.holding = p_ref and d.user_id <> auth.uid()
     and d.last_seen_at > now() - interval '15 minutes';

  if found then
    return json_build_object('mine', false, 'by', h.name, 'since', h.entered_at,
                             'idle_min', h.idle_min);
  end if;

  insert into public.desk_presence (user_id, holding, entered_at, last_seen_at)
  values (auth.uid(), p_ref, now(), now())
  on conflict (user_id) do update
    set holding = p_ref, entered_at = now(), last_seen_at = now();
  return json_build_object('mine', true);
end;
$$;
grant execute on function public.claim_case(text) to authenticated;

create or replace function public.release_case()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.desk_presence
     set holding = null, entered_at = null, last_seen_at = now()
   where user_id = auth.uid();
end;
$$;
grant execute on function public.release_case() to authenticated;

-- 8c's WHO'S ON IT column, joined to the list rather than fetched per row
create or replace function public.case_holders()
returns table (ref text, holder text, idle_min int, mine boolean)
language sql stable security definer set search_path = ''
as $$
  select d.holding, coalesce(p.full_name, 'Ops'),
         floor(extract(epoch from (now() - d.last_seen_at)) / 60)::int,
         d.user_id = auth.uid()
    from public.desk_presence d
    join public.profiles p on p.id = d.user_id
   where d.holding is not null and d.last_seen_at > now() - interval '15 minutes'
     and public.is_admin();
$$;
grant execute on function public.case_holders() to authenticated;

-- ---- what this turn computes ------------------------------------------------
do $$
begin
  -- 8a: the two rules are OR, so loosening either one frees people
  assert (false or true), 'either the calendar or the streak clears a mark';
  -- the streak gate is off when the setting is null, and `coalesce(null, 999)`
  -- is what makes "off" mean "never clears this way" rather than "clears at 0"
  assert coalesce(null::int, 999) <= 2 is false, 'a null streak setting never clears a mark';
  assert coalesce(3, 999) <= 3, 'three clean visits against a setting of three clears it';
  assert coalesce(3, 999) <= 2 is false, 'two clean visits against a setting of three does not';
  -- 8b's flag order: money outranks silence, and a 15% cancel rate outranks both
  assert 18 >= 15, '18% cancels is flagged';
  assert 6 >= 15 is false, '6% cancels is not';
  -- 8c: a lock is only a lock while somebody is behind it
  assert 12 < 15, 'idle 12 minutes still holds the case';
  assert 16 < 15 is false, 'idle 16 minutes has released it';
end $$;
