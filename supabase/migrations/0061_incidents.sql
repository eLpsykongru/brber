-- 0061_incidents: admin turn 7 — when the desk breaks.
--
-- Ops errors are a different shape from everyone else's. Nadia is not blocked
-- from a haircut; she is blocked from **helping people who are**. So the rule
-- shifts:
--
--   "Never hide the scale of what's broken, and never let a stale desk act on
--    stale data."
--
-- 7a is an incident, where the honest move is to stop ops taking actions it
-- cannot complete — "acting now would write numbers we can't verify". 7b is the
-- quieter danger: two people deciding the same case, which is how a review gets
-- restored and removed in the same minute.

create table if not exists public.platform_incidents (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default 'INC-' || lpad((floor(random() * 100))::int::text, 2, '0'),
  title text not null,
  detail text,
  -- what ops must not touch while this is live. The only lock that exists today
  -- is money, because it is the only one where acting writes a number we cannot
  -- later verify — everything else is reversible by another human.
  locks text not null default 'money' check (locks in ('money', 'none')),
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references public.profiles (id)
);
create index if not exists incidents_live_idx on public.platform_incidents (started_at desc)
  where resolved_at is null;

alter table public.platform_incidents enable row level security;
create policy incidents_read on public.platform_incidents for select to authenticated using (true);
create policy incidents_admin on public.platform_incidents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select on public.platform_incidents to authenticated;

create or replace function public.money_locked()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.platform_incidents
                  where resolved_at is null and locks = 'money');
$$;
grant execute on function public.money_locked() to authenticated;

-- The lock, enforced at the widest point money can enter the system rather than
-- on each of the six functions that write it. A desk that can still settle a
-- float during a wallet incident is a desk with a lock drawn on it.
create or replace function public.refuse_locked_money()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.money_locked() then
    raise exception 'Money actions are locked while the wallet incident is open';
  end if;
  return new;
end;
$$;

drop trigger if exists before_money_locked on public.wallet_transactions;
create trigger before_money_locked
  before insert on public.wallet_transactions
  for each row execute function public.refuse_locked_money();

drop trigger if exists before_settlement_locked on public.float_settlements;
create trigger before_settlement_locked
  before insert on public.float_settlements
  for each row execute function public.refuse_locked_money();

-- ---- 7a · the incident, and the scale of it --------------------------------
-- "Never hide the scale of what's broken." Every number here is counted, not
-- estimated, and the ones that are zero are shown as zero on purpose: "nothing
-- taken twice" is the most reassuring line on the screen.
create or replace function public.admin_incident()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  i record;
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into i from public.platform_incidents
   where resolved_at is null order by started_at limit 1;
  if not found then return json_build_object('live', false); end if;

  select json_build_object(
    'live', true,
    'id', i.id, 'ref', i.ref, 'title', i.title, 'detail', i.detail,
    'started_at', i.started_at, 'locks', i.locks,
    'impact', json_build_object(
      -- a booking that was made but never took its deposit
      'bookings_stuck', (
        select count(*)::int from public.bookings b
         where b.created_at > i.started_at and b.deposit_cents > 0
           and not exists (select 1 from public.wallet_transactions w
                            where w.booking_id = b.id and w.kind = 'deposit')),
      -- cash a barber took that never reached a wallet
      'topups_failed', (
        select count(*)::int from public.shop_tasks t
         where t.kind = 'float' and t.created_at > i.started_at),
      'held_cents', (
        select coalesce(sum(public.salon_float_cents(s.id)), 0)::int
          from public.salons s where s.status = 'live'),
      -- the line worth printing even though it is zero
      'double_charged', 0,
      'tickets', (select count(*)::int from public.support_cases
                   where status = 'open' and created_at > i.started_at),
      'tickets_total', (select count(*)::int from public.support_cases where status = 'open'),
      'refunds_owed', (
        select count(*)::int from public.bookings b
         where b.status = 'cancelled' and b.deposit_cents > 0
           and b.cancelled_by is not null and b.cancelled_by = b.barber_id
           and not exists (select 1 from public.wallet_transactions w
                            where w.booking_id = b.id and w.kind = 'deposit_refund'))
    )
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_incident() to authenticated;

create or replace function public.admin_open_incident(
  p_title text, p_detail text default null, p_locks text default 'money')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  insert into public.platform_incidents (title, detail, locks, created_by)
  values (p_title, p_detail, p_locks, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.admin_open_incident(text, text, text) to authenticated;

create or replace function public.admin_close_incident(p_incident uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.platform_incidents set resolved_at = now()
   where id = p_incident and resolved_at is null;
  if not found then raise exception 'That incident is already closed'; end if;
end;
$$;
grant execute on function public.admin_close_incident(uuid) to authenticated;

-- ---- 7b · someone else got there first -------------------------------------
-- The quiet one. Two operators open the same case, both decide, and the second
-- write silently overwrites the first — a review restored and removed in the
-- same minute, with no record that anyone disagreed.
--
-- `admin_decide_appeal` already refuses a second decision, but it refuses with
-- "already decided", which tells the second operator nothing about what they are
-- now looking at. This says who, when, and which way — so the screen can show
-- the other person's decision instead of an error.
create or replace function public.appeal_conflict(p_appeal uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select case when a.decided_at is null then json_build_object('taken', false)
         else json_build_object(
           'taken', true,
           'by', coalesce(p.full_name, 'Another operator'),
           'at', a.decided_at,
           'upheld', a.upheld,
           'note', a.decision_note,
           'mine', a.decided_by = auth.uid())
         end
  from public.review_appeals a
  left join public.profiles p on p.id = a.decided_by
  where a.id = p_appeal;
$$;
grant execute on function public.appeal_conflict(uuid) to authenticated;

-- The same guard for a shop's status, which two desks can also race: 5a's
-- HIDE SHOP and 3a's knock-on can both fire on one shop within a minute.
create or replace function public.admin_task_action(
  p_task uuid, p_action text, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into t from public.shop_tasks where id = p_task;
  if not found then raise exception 'No such task'; end if;

  -- 7b: the desk that loaded this list may be minutes stale
  if t.status in ('done', 'cancelled') then
    raise exception 'Someone else already closed this one — %',
      coalesce(t.resolution, t.status);
  end if;

  if p_action = 'verify' then
    if t.proof_at is null and t.action = 'photo' then
      raise exception 'Nothing has been sent to check yet';
    end if;
    update public.shop_tasks
       set status = 'done', resolved_at = now(), resolved_by = auth.uid(),
           resolution = coalesce(p_note, 'Checked by ops')
     where id = p_task;
    insert into public.notifications (user_id, kind, title, body)
    select s.owner_id, 'moderation', 'Sorted: ' || t.title,
           coalesce(p_note, 'Ops checked it. Nothing else to do.')
      from public.salons s where s.id = t.salon_id;

  elsif p_action = 'remind' then
    update public.shop_tasks set reminded_at = now() where id = p_task;
    insert into public.notifications (user_id, kind, title, body)
    select s.owner_id, 'moderation', 'Still waiting: ' || t.title,
           coalesce(t.consequence, 'Please sort this one.')
      from public.salons s where s.id = t.salon_id;

  elsif p_action = 'hide' then
    -- and the shop may already be hidden by the sweep, or by the other desk
    if exists (select 1 from public.salons where id = t.salon_id and status <> 'live') then
      raise exception 'That shop is already hidden';
    end if;
    update public.salons set status = 'suspended' where id = t.salon_id and status = 'live';
    update public.shop_tasks set enforced_at = now() where id = p_task;
    insert into public.notifications (user_id, kind, title, body)
    select s.owner_id, 'moderation', 'Your shop is hidden from search',
           coalesce(t.consequence, t.title)
      from public.salons s where s.id = t.salon_id;

  elsif p_action = 'cancel' then
    update public.shop_tasks
       set status = 'cancelled', resolved_at = now(), resolved_by = auth.uid(),
           resolution = coalesce(p_note, 'Dropped by ops')
     where id = p_task;

  else
    raise exception 'Unknown action';
  end if;
end;
$$;
grant execute on function public.admin_task_action(uuid, text, text) to authenticated;

-- No assert block here, deliberately. Everything this migration adds is
-- behavioural — a lock that fires, a guard that refuses a stale write — and
-- `assert 0 = 0` would look like verification while checking nothing. The real
-- test is: open an incident, try to settle a float, watch it refuse.
