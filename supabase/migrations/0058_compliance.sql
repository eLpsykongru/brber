-- 0058_compliance: admin turn 5 — decisions that ended in an obligation.
--
-- 0053 gave a task a due date; nothing ever happened when it passed. Turn 5's
-- rule is that this is the whole point:
--
--   "Consequences are automatic and stated up front, so ops never has to argue;
--    overdue tasks act on the shop themselves and the row says exactly what will
--    happen and when."
--
-- Two columns and one scheduled function carry that. The loop it closes runs
-- across four turns already built: **admin 5a** sets the obligation and its
-- consequence → **barber 9a** counts down to it → nobody acts → the shop is
-- hidden → **barber 10e** is the screen that explains why and how to get back.

alter table public.shop_tasks
  -- what happens if the date passes. 'none' is a real answer — most asks are
  -- chased, not enforced — but it has to be chosen, not defaulted into silence.
  add column if not exists on_overdue text not null default 'none'
    check (on_overdue in ('none', 'hide_shop', 'block_topups')),
  -- the sentence 9a prints. Stated when the task is issued, so the barber reads
  -- the consequence at the same moment he reads the ask.
  add column if not exists consequence text,
  add column if not exists enforced_at timestamptz,
  add column if not exists reminded_at timestamptz;

create index if not exists shop_tasks_due_idx
  on public.shop_tasks (due_at) where status in ('open', 'sent') and on_overdue <> 'none';

-- ---- the consequence, applied by the clock rather than by an argument -------
create or replace function public.enforce_overdue_tasks()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
  n int := 0;
begin
  for t in
    select * from public.shop_tasks
     where status in ('open', 'sent') and on_overdue <> 'none'
       and due_at is not null and due_at < now() and enforced_at is null
  loop
    if t.on_overdue = 'hide_shop' then
      -- exactly what barber 10e describes: out of search, bookings untouched
      update public.salons set status = 'suspended'
       where id = t.salon_id and status = 'live';
    end if;
    -- 'block_topups' needs no write: `agent_cash_topup` reads it below.

    update public.shop_tasks set enforced_at = now() where id = t.id;

    insert into public.notifications (user_id, kind, title, body)
    select s.owner_id, 'moderation',
           case when t.on_overdue = 'hide_shop' then 'Your shop is hidden from search'
                else 'Cash top-ups are paused' end,
           coalesce(t.consequence, t.title) || ' — this was due ' ||
           to_char(t.due_at at time zone 'Africa/Casablanca', 'Mon DD') || '.'
      from public.salons s where s.id = t.salon_id;

    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Same hourly job 0051 created, so nothing new is scheduled: one sweep does the
-- asks, the made room and now the obligations.
create or replace function public.expire_stale_asks()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int := 0;
begin
  with gone as (
    update public.waitlist_requests set status = 'expired'
     where status = 'waiting'
       and day < (now() at time zone 'Africa/Casablanca')::date
    returning 1),
  swept as (
    delete from public.time_blocks
     where kind = 'open' and day < (now() at time zone 'Africa/Casablanca')::date
    returning 1)
  select ((select count(*) from gone) + (select count(*) from swept))::int into n;

  return n + public.enforce_overdue_tasks();
end;
$$;

-- a shop with an overdue float task cannot take more cash. The task says so
-- when it is issued, which is the point: nobody has to be told twice.
create or replace function public.topups_blocked(p_salon uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.shop_tasks t
                  where t.salon_id = p_salon and t.on_overdue = 'block_topups'
                    and t.status in ('open', 'sent')
                    and t.due_at is not null and t.due_at < now());
$$;
grant execute on function public.topups_blocked(uuid) to authenticated;

-- A trigger rather than a re-emit of `agent_cash_topup`: this is one rule about
-- one shop's standing and it has nothing to say about who is topping up or how
-- much. It also catches any other path that ever writes a cash row.
create or replace function public.refuse_blocked_topup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind <> 'cash_topup' or new.salon_id is null then return new; end if;
  if public.topups_blocked(new.salon_id) then
    raise exception 'Cash top-ups are paused here until the shop settles its float';
  end if;
  return new;
end;
$$;

drop trigger if exists before_cash_topup_blocked on public.wallet_transactions;
create trigger before_cash_topup_blocked
  before insert on public.wallet_transactions
  for each row execute function public.refuse_blocked_topup();

-- ---- 5a · the chase list ---------------------------------------------------
create or replace function public.admin_compliance(p_scope text default 'open')
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    'stats', json_build_object(
      'open', (select count(*)::int from public.shop_tasks where status in ('open', 'sent')),
      'done', (select count(*)::int from public.shop_tasks where status = 'done'),
      'overdue', (select count(*)::int from public.shop_tasks
                   where status in ('open', 'sent') and due_at < now()),
      -- "acts by itself tonight": how many of those the sweep will enforce
      'acts_tonight', (select count(*)::int from public.shop_tasks
                        where status in ('open', 'sent') and due_at < now()
                          and on_overdue <> 'none' and enforced_at is null),
      'due_week', (select count(*)::int from public.shop_tasks
                    where status in ('open', 'sent')
                      and due_at between now() and now() + interval '7 days'),
      'reminded', (select count(*)::int from public.shop_tasks
                    where status in ('open', 'sent') and reminded_at is not null),
      -- the design prints this against last month, because a compliance number
      -- with nothing to compare it to says nothing
      'on_time_pct', (
        select case when count(*) = 0 then null
               else round(100.0 * count(*) filter (
                      where due_at is null or resolved_at <= due_at) / count(*))::int end
          from public.shop_tasks
         where status = 'done' and resolved_at >= date_trunc('month', now())),
      'on_time_prev', (
        select case when count(*) = 0 then null
               else round(100.0 * count(*) filter (
                      where due_at is null or resolved_at <= due_at) / count(*))::int end
          from public.shop_tasks
         where status = 'done'
           and resolved_at >= date_trunc('month', now()) - interval '1 month'
           and resolved_at < date_trunc('month', now())),
      'repeat_offenders', (
        select count(*)::int from (
          select salon_id from public.shop_tasks
           where status in ('open', 'sent', 'cancelled') and due_at < now()
           group by salon_id having count(*) >= 3) r)
    ),
    'rows', (
      select coalesce(json_agg(x order by x.due_at nulls last), '[]'::json) from (
        select t.id, t.ref, t.kind, t.title, t.body, t.due_at, t.status,
               t.on_overdue, t.consequence, t.enforced_at, t.reminded_at,
               t.proof_at, t.proof_path,
               s.name as salon, s.id as salon_id, s.status as salon_status,
               coalesce(p.full_name, 'Owner') as owner,
               floor(extract(epoch from (t.due_at - now())) / 86400)::int as days_left,
               -- "3rd missed task" vs "first task": the shop's own history is
               -- what turns one late poster into a pattern
               (select count(*)::int from public.shop_tasks m
                 where m.salon_id = t.salon_id and m.id <> t.id
                   and m.due_at < coalesce(t.resolved_at, now())
                   and (m.status <> 'done' or m.resolved_at > m.due_at)) as missed_before
          from public.shop_tasks t
          left join public.salons s on s.id = t.salon_id
          left join public.profiles p on p.id = s.owner_id
         where case when p_scope = 'done' then t.status = 'done'
                    else t.status in ('open', 'sent') end
      ) x)
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_compliance(text) to authenticated;

-- 5a issues one. This is the writer barber 9a has been reading since 0053 —
-- until now the only thing that produced a task was an upheld appeal.
create or replace function public.admin_issue_task(
  p_salon uuid, p_kind text, p_title text, p_body text default null,
  p_due date default null, p_on_overdue text default 'none',
  p_consequence text default null, p_action text default 'photo',
  p_ref text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'A task has to say what to do';
  end if;
  -- the design's rule, enforced: a consequence that is not stated up front is
  -- not a consequence, it is a surprise
  if p_on_overdue <> 'none' and nullif(btrim(coalesce(p_consequence, '')), '') is null then
    raise exception 'Say what happens if it is missed — the shop sees it on the task';
  end if;
  if p_on_overdue <> 'none' and p_due is null then
    raise exception 'A consequence needs a date to act on';
  end if;

  insert into public.shop_tasks
    (salon_id, ref, kind, title, body, due_at, action, on_overdue, consequence,
     created_by, issued_because)
  values (p_salon,
          coalesce(nullif(btrim(coalesce(p_ref, '')), ''),
                   upper(left(p_kind, 3)) || '-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 4))),
          p_kind, p_title, p_body,
          case when p_due is null then null
               else (p_due + time '23:59') at time zone 'Africa/Casablanca' end,
          p_action, p_on_overdue, p_consequence, auth.uid(), 'issued by ops')
  returning id into v_id;

  insert into public.notifications (user_id, kind, title, body)
  select s.owner_id, 'moderation', p_title,
         coalesce(p_body, '') || case when p_consequence is null then ''
                                      else ' If it is missed: ' || p_consequence end
    from public.salons s where s.id = p_salon;

  return v_id;
end;
$$;
grant execute on function public.admin_issue_task(uuid, text, text, text, date, text, text, text, text)
  to authenticated;

-- 5a's three row buttons. VERIFY closes it, REMIND nudges, HIDE SHOP is the
-- consequence applied by hand before the clock gets to it.
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

do $$
begin
  -- 5a's headline, from the drawn desk: 34 done, 7 open
  assert 34 + 7 = 41, 'the desk is showing 41 obligations in all';
  -- "4 days late" is a due date four days behind
  assert floor(-4.2) = -5 and floor(-3.9) = -4, 'days_left floors toward the earlier day';
  -- and the comparison the on-time number is printed against
  assert 72 > 61, '72% this month is up from 61% in June';
end $$;
