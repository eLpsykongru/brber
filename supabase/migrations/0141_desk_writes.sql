-- 0141_desk_writes: four things the desk could read but not do.
--
-- Each was drawn with a button and shipped without one, because nothing in the database
-- did the thing. All four go through the 0133 gate like every other desk write — someone
-- above their role asks instead of acting — and each lands in the audit log.
--
--   1 · Pricing (SET-17). The list price had no setter; platform_settings' own policy
--       would have let the site write it raw, past the gate and the log. This changes
--       what the NEXT subscription is charged, with a reason, in settings_changes like
--       every rule. Nobody is repriced: a subscription keeps the price it started on (0123).
--   2 · Districts (SET-06). A district was only the name on a shop, so one with no shop
--       could not exist — the drawn Malabata row, "searchable, nothing to show".
--       `districts` holds the names ops adds; the list anyone sees is those plus every
--       name already on a shop. Renaming moves every shop at once, and merges into a
--       name that already exists.
--   3 · More days on a task (CMP-01: "Extending needs a reason and shows on the shop's
--       record"). The date moves, every extension is kept with its reason, and the owner
--       is told the new date.
--   4 · Holding a shop's payouts (SAL-03, on a float mismatch). Nothing we owe the shop
--       leaves us while it is held. Enforced where every pay-out lands — a negative
--       float_settlements row — the way 0061 locks money during an incident, so settling
--       a line, an agent's signed hand-over and the shop page's settle all stop at once.
--       The week is still cut and stated as usual; an undelivered pay-out carries
--       forward on day 14 (0088) until the hold is lifted.
--
-- Local dates go through public.morocco_tz() (0139), never the zone's name.

-- ---- 1 · pricing ----------------------------------------------------------------
create or replace function public.admin_set_pricing__direct(
  p_monthly_cents int, p_yearly_cents int, p_chair_cap int,
  p_sms_included int, p_sms_unit_cents int, p_reason text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare b record;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  -- the bounds are there to catch a slipped digit, not to set policy
  if p_monthly_cents is null or p_monthly_cents < 100 or p_monthly_cents > 100000 then
    raise exception 'A chair is between 1 and 1 000 DH a month';
  end if;
  if p_yearly_cents is null or p_yearly_cents < 100 then
    raise exception 'A chair paid for a year is at least 1 DH a month';
  end if;
  if p_yearly_cents > p_monthly_cents then
    raise exception 'Paying for a year can''t cost more a month than paying monthly';
  end if;
  if p_chair_cap is null or p_chair_cap < 1 or p_chair_cap > 50 then
    raise exception 'Bill between 1 and 50 chairs a shop';
  end if;
  if p_sms_included is null or p_sms_included < 0 or p_sms_included > 10000 then
    raise exception 'Include between 0 and 10 000 texts a month';
  end if;
  if p_sms_unit_cents is not null and (p_sms_unit_cents < 1 or p_sms_unit_cents > 1000) then
    raise exception 'A text past the included ones costs up to 10 DH, or nothing';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Say why, in a sentence — it is logged against your name';
  end if;

  select sub_monthly_cents, sub_yearly_cents, sub_chair_cap, sub_sms_included, sub_sms_unit_cents
    into b from public.platform_settings where id;
  if b.sub_monthly_cents = p_monthly_cents and b.sub_yearly_cents = p_yearly_cents
     and b.sub_chair_cap = p_chair_cap and b.sub_sms_included = p_sms_included
     and b.sub_sms_unit_cents is not distinct from p_sms_unit_cents then
    raise exception 'Those are already the prices';
  end if;

  update public.platform_settings
     set sub_monthly_cents = p_monthly_cents, sub_yearly_cents = p_yearly_cents,
         sub_chair_cap = p_chair_cap, sub_sms_included = p_sms_included,
         sub_sms_unit_cents = p_sms_unit_cents, updated_at = now(), updated_by = auth.uid()
   where id;
  insert into public.settings_changes (changed_by, before, after, note)
  values (auth.uid(),
          json_build_object('sub_monthly_cents', b.sub_monthly_cents, 'sub_yearly_cents', b.sub_yearly_cents,
                            'sub_chair_cap', b.sub_chair_cap, 'sub_sms_included', b.sub_sms_included,
                            'sub_sms_unit_cents', b.sub_sms_unit_cents),
          json_build_object('sub_monthly_cents', p_monthly_cents, 'sub_yearly_cents', p_yearly_cents,
                            'sub_chair_cap', p_chair_cap, 'sub_sms_included', p_sms_included,
                            'sub_sms_unit_cents', p_sms_unit_cents),
          btrim(p_reason));
  return json_build_object('monthly_cents', p_monthly_cents, 'yearly_cents', p_yearly_cents);
end $$;

-- ---- 2 · districts ----------------------------------------------------------------
create table if not exists public.districts (
  name text primary key check (name = btrim(name) and name <> ''),
  added_by uuid references public.profiles (id),
  added_at timestamptz not null default now()
);
create unique index if not exists districts_name_ci on public.districts (lower(name));
alter table public.districts enable row level security;
drop policy if exists districts_select on public.districts;
-- the names are what customers pick from, so anyone signed in reads them
create policy districts_select on public.districts for select to authenticated using (true);
grant select on public.districts to authenticated;

create or replace function public.admin_add_district__direct(p_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if v = '' then raise exception 'Name the district'; end if;
  if length(v) > 40 then raise exception 'Keep the name under 40 letters'; end if;
  if lower(v) = 'unassigned' then raise exception '"Unassigned" is what a shop with no district shows'; end if;
  if exists (select 1 from public.districts where lower(name) = lower(v))
     or exists (select 1 from public.salons where lower(btrim(district)) = lower(v)) then
    raise exception '% is already a district', v;
  end if;
  insert into public.districts (name, added_by) values (v, auth.uid());
end $$;

-- one call for the whole district, so a rename can't stop half way through its shops
create or replace function public.admin_rename_district__direct(p_from text, p_to text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_from text := btrim(coalesce(p_from, ''));
  v_to text := regexp_replace(btrim(coalesce(p_to, '')), '\s+', ' ', 'g');
  v_into text;
  v_shops int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if v_to = '' then raise exception 'Type the new name'; end if;
  if length(v_to) > 40 then raise exception 'Keep the name under 40 letters'; end if;
  if lower(v_to) = 'unassigned' then raise exception '"Unassigned" is what a shop with no district shows'; end if;
  if v_to = v_from then raise exception 'That is already its name'; end if;
  if not exists (select 1 from public.districts where name = v_from)
     and not exists (select 1 from public.salons where btrim(district) = v_from) then
    raise exception 'No district is called %', v_from;
  end if;

  -- renaming into a name that exists merges the two, under the spelling already in use
  select x.n into v_into from (
    select name as n from public.districts where lower(name) = lower(v_to)
    union
    select btrim(district) from public.salons where lower(btrim(district)) = lower(v_to)) x
   where x.n <> v_from
   limit 1;

  update public.salons set district = coalesce(v_into, v_to) where btrim(district) = v_from;
  get diagnostics v_shops = row_count;
  -- the searches that named it come along, or a renamed district starts its demand at zero
  update public.searches set district = coalesce(v_into, v_to) where district = v_from;
  if exists (select 1 from public.districts where lower(name) = lower(coalesce(v_into, v_to)) and name <> v_from) then
    delete from public.districts where name = v_from;
  else
    update public.districts set name = coalesce(v_into, v_to) where name = v_from;
  end if;
  return json_build_object('name', coalesce(v_into, v_to), 'shops', v_shops, 'merged', v_into is not null);
end $$;

-- only an empty one: a district with a shop in it exists whatever this list says
create or replace function public.admin_remove_district__direct(p_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if exists (select 1 from public.salons where btrim(district) = v) then
    raise exception 'Shops are still in % — move them to another district first', v;
  end if;
  delete from public.districts where name = v;
  if not found then raise exception 'No district is called %', v; end if;
end $$;

-- ---- 3 · more days on a task --------------------------------------------------------
create table if not exists public.shop_task_extensions (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.shop_tasks (id) on delete cascade,
  days int not null check (days between 1 and 30),
  reason text not null,
  due_before timestamptz not null,
  due_after timestamptz not null,
  given_by uuid references public.profiles (id),
  given_at timestamptz not null default now()
);
create index if not exists shop_task_extensions_task_idx on public.shop_task_extensions (task_id, given_at);
alter table public.shop_task_extensions enable row level security;
drop policy if exists shop_task_extensions_select on public.shop_task_extensions;
create policy shop_task_extensions_select on public.shop_task_extensions for select to authenticated
  using (public.is_admin());
grant select on public.shop_task_extensions to authenticated;

create or replace function public.admin_extend_task__direct(p_task uuid, p_days int, p_reason text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
  v_tz text := public.morocco_tz();
  v_due timestamptz;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select tk.id, tk.salon_id, tk.title, tk.due_at, tk.status, tk.on_overdue, tk.consequence,
         tk.enforced_at, s.status::text as salon_status, s.owner_id
    into t
    from public.shop_tasks tk join public.salons s on s.id = tk.salon_id
   where tk.id = p_task;
  if t.id is null then raise exception 'No such task'; end if;
  if t.status not in ('open', 'sent') then raise exception 'That task is closed'; end if;
  if t.due_at is null then raise exception 'That task has no date to move'; end if;
  if p_days is null or p_days < 1 or p_days > 30 then raise exception 'Give between 1 and 30 more days'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Say why, in a sentence — it goes on the shop''s record';
  end if;
  -- more days would not bring the shop back: that is reopening it, a separate decision
  if t.on_overdue = 'hide_shop' and t.enforced_at is not null and t.salon_status = 'suspended' then
    raise exception 'It has already hidden the shop — reopen the shop first, then give it more days';
  end if;

  -- counted from the date it was due, or from today once that has passed: a late task
  -- given 7 more days has 7 days. Still due at 23:59 Tangier time, like every task (0058).
  v_due := ((greatest(t.due_at, now()) at time zone v_tz)::date + p_days + time '23:59') at time zone v_tz;

  insert into public.shop_task_extensions (task_id, days, reason, due_before, due_after, given_by)
  values (t.id, p_days, btrim(p_reason), t.due_at, v_due, auth.uid());
  -- the clock starts again on the new date (a block on top-ups reads the date itself)
  update public.shop_tasks set due_at = v_due, enforced_at = null where id = t.id;

  if t.owner_id is not null then
    insert into public.notifications (user_id, kind, title, body)
    values (t.owner_id, 'moderation', 'More time: ' || t.title,
            'You now have until ' || to_char(v_due at time zone v_tz, 'FMDD FMMonth') || '.'
            || coalesce(' If it is missed: ' || t.consequence, ''));
  end if;
  return json_build_object('due_at', v_due);
end $$;

-- ---- 4 · holding a shop's payouts -------------------------------------------------------
-- Its own table, not a column on salons: an owner can update their own salon row.
create table if not exists public.payout_holds (
  salon_id uuid primary key references public.salons (id) on delete cascade,
  reason text not null,
  held_by uuid references public.profiles (id),
  held_at timestamptz not null default now()
);
alter table public.payout_holds enable row level security;
drop policy if exists payout_holds_select on public.payout_holds;
create policy payout_holds_select on public.payout_holds for select to authenticated
  using (public.is_admin());
grant select on public.payout_holds to authenticated;

-- A pay-out is a negative float_settlements row, whoever writes it. The reason stays off
-- the error: an agent may be reading it out at the shop's counter.
create or replace function public.refuse_held_payout()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_shop text;
begin
  if new.amount_cents >= 0 then return new; end if;
  select s.name into v_shop
    from public.payout_holds h join public.salons s on s.id = h.salon_id
   where h.salon_id = new.salon_id;
  if found then
    raise exception 'Payouts to % are on hold — ops has to lift it first', v_shop;
  end if;
  return new;
end $$;
drop trigger if exists before_payout_held on public.float_settlements;
create trigger before_payout_held
  before insert on public.float_settlements
  for each row execute function public.refuse_held_payout();

-- and a held shop's pay-out isn't put on a round, where the agent would only be refused
-- at the counter. Skipped rather than refused, so planning the rest of the week still works.
create or replace function public.skip_held_payout_visit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.direction = 'pay_out' and exists (
       select 1 from public.settlement_lines l join public.payout_holds h on h.salon_id = l.salon_id
        where l.id = new.line_id) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists before_visit_held on public.settlement_visits;
create trigger before_visit_held
  before insert on public.settlement_visits
  for each row execute function public.skip_held_payout_visit();

create or replace function public.admin_hold_payouts__direct(p_salon uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare s record;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select id, name, owner_id into s from public.salons where id = p_salon;
  if s.id is null then raise exception 'No such shop'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Say why, in a sentence — it is kept with the hold';
  end if;
  if exists (select 1 from public.payout_holds where salon_id = p_salon) then
    raise exception 'Payouts to % are already on hold', s.name;
  end if;
  insert into public.payout_holds (salon_id, reason, held_by) values (p_salon, btrim(p_reason), auth.uid());
  if s.owner_id is not null then
    insert into public.notifications (user_id, kind, title, body)
    values (s.owner_id, 'shop_status', 'Payouts are paused',
            'We are checking the cash at ' || s.name || '. What we owe you stays on your statement '
            || 'and is paid once this is sorted.');
  end if;
end $$;

create or replace function public.admin_release_payouts__direct(p_salon uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare s record;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select id, name, owner_id into s from public.salons where id = p_salon;
  if s.id is null then raise exception 'No such shop'; end if;
  delete from public.payout_holds where salon_id = p_salon;
  if not found then raise exception 'Payouts to % are not on hold', s.name; end if;
  if s.owner_id is not null then
    insert into public.notifications (user_id, kind, title, body)
    values (s.owner_id, 'shop_status', 'Payouts are back on',
            'What we owe you is paid on the next round.');
  end if;
end $$;

-- ---- the gate ---------------------------------------------------------------------------
insert into public.staff_rpcs (rpc, key) values
  ('admin_set_pricing', 'platform_rule'),
  ('admin_add_district', 'shops'), ('admin_rename_district', 'shops'), ('admin_remove_district', 'shops'),
  ('admin_extend_task', 'shops'),
  ('admin_hold_payouts', 'money'), ('admin_release_payouts', 'money')
on conflict (rpc) do update set key = excluded.key;

-- 0133's wrapper generator, run for these seven only
do $gen$
declare r record; v_oid oid; v_ident text; v_obj text; v_call text; v_void boolean;
begin
  for r in select rpc from public.staff_rpcs
            where rpc in ('admin_set_pricing', 'admin_add_district', 'admin_rename_district', 'admin_remove_district',
                          'admin_extend_task', 'admin_hold_payouts', 'admin_release_payouts') loop
    if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (r.rpc, r.rpc || '__direct')) > 2 then
      raise exception '% is overloaded; the gate wraps one signature', r.rpc;
    end if;
    select oid into v_oid from pg_proc where pronamespace = 'public'::regnamespace and proname = r.rpc || '__direct';
    if v_oid is null then raise exception 'no %__direct to wrap', r.rpc; end if;
    if (select proargmodes from pg_proc where oid = v_oid) is not null then raise exception '% has OUT or VARIADIC arguments; the gate cannot wrap it', r.rpc; end if;
    v_ident := pg_get_function_identity_arguments(v_oid);
    v_void := (select prorettype = 'void'::regtype from pg_proc where oid = v_oid);
    select string_agg(format('%L, %I', n, n), ', ' order by i), string_agg(format('%I => %I', n, n), ', ' order by i)
      into v_obj, v_call
      from pg_proc p, unnest(p.proargnames) with ordinality as a(n, i) where p.oid = v_oid;
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', r.rpc || '__direct', v_ident);
    execute format($w$create or replace function public.%I(%s) returns %s language plpgsql security definer set search_path = '' as $b$
begin
  perform public.staff_gate(%L, jsonb_build_object(%s));
  %s public.%I(%s);
end $b$
$w$,
      r.rpc, pg_get_function_arguments(v_oid), pg_get_function_result(v_oid),
      r.rpc, coalesce(v_obj, ''),
      case when v_void then 'perform' else 'return' end, r.rpc || '__direct', coalesce(v_call, ''));
    execute format('revoke all on function public.%I(%s) from public, anon', r.rpc, v_ident);
    execute format('grant execute on function public.%I(%s) to authenticated', r.rpc, v_ident);
  end loop;
end $gen$;

-- ---- the audit log says what these did, and to whom ------------------------------------
-- 0133's admin_audit with the new verbs, the shop a task belongs to as its subject, and
-- the reason typed with a call (pricing, a hold, more days…) as its note.
create or replace function public.admin_audit(p_kind text default null, p_staff uuid default null, p_days int default 30)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return json_build_object(
    'rows', coalesce((select json_agg(x order by x.at desc) from (
      -- done: the verb from the call where it says more than the row's label
      select 'did' as kind, a.at, a.staff_id, coalesce(p.full_name, 'Staff') as who, a.key,
             case a.rpc
               when 'admin_salon_decide' then case a.args ->> 'p_action' when 'suspend' then 'suspended' when 'restore' then 'reopened'
                                                when 'approve' then 'approved' when 'reject' then 'refused' else 'decided on' end
               when 'admin_review_decide' then case a.args ->> 'p_action' when 'remove' then 'removed a review of' else 'kept a review of' end
               when 'admin_set_suspension' then case when (a.args ->> 'p_suspend')::boolean then 'banned' else 'lifted the ban on' end
               when 'admin_support_resolve' then case when coalesce((a.args ->> 'p_refund_cents')::int, 0) > 0
                                                  then 'refunded ' || ((a.args ->> 'p_refund_cents')::int / 100) || ' DH on a case' else 'closed a case' end
               when 'admin_set_pricing' then 'changed what a new subscription is charged'
               when 'admin_hold_payouts' then 'held payouts to'
               when 'admin_release_payouts' then 'lifted the payout hold on'
               when 'admin_extend_task' then 'gave ' || (a.args ->> 'p_days') || ' more days to'
               when 'admin_add_district' then 'added the district'
               when 'admin_rename_district' then 'renamed the district'
               when 'admin_remove_district' then 'removed the district'
               else lower(left(k.did, 1)) || substr(k.did, 2) end as what,
             coalesce(s.name, cp.full_name, rs.name, ts.name, a.args ->> 'p_email', a.args ->> 'p_name',
                      (a.args ->> 'p_from') || ' → ' || (a.args ->> 'p_to')) as subject,
             coalesce(case when a.ask_id is not null then 'Asked by ' || coalesce(ap.full_name, 'a colleague') || ': “' || aa.reason || '”' end,
                      nullif(btrim(a.args ->> 'p_reason'), '')) as note
        from public.staff_audit a
        join public.staff_actions k on k.key = a.key
        left join public.profiles p on p.id = a.staff_id
        left join public.salons s on s.id::text = a.args ->> 'p_salon'
        left join public.profiles cp on cp.id::text = coalesce(a.args ->> 'p_customer', a.args ->> 'p_admin', a.args ->> 'p_barber')
        left join public.reviews rv on rv.id::text = a.args ->> 'p_review'
        left join public.barbers rb on rb.id = rv.barber_id
        left join public.salons rs on rs.id = rb.salon_id
        left join public.shop_tasks tk on tk.id::text = a.args ->> 'p_task'
        left join public.salons ts on ts.id = tk.salon_id
        left join public.staff_asks aa on aa.id = a.ask_id
        left join public.profiles ap on ap.id = aa.asked_by
       where a.at > v_since
      union all
      -- asked, and what came of it
      select case when q.state = 'refused' then 'refused' else 'asked' end, q.asked_at, q.asked_by, coalesce(p.full_name, 'Staff'), q.key,
             'asked to ' || lower(left(q.title, 1)) || substr(q.title, 2), null,
             case q.state when 'refused' then 'refused by ' || coalesce(d.full_name, 'the Head of Ops') || coalesce(' — “' || q.note || '”', '')
                          when 'waiting' then 'waiting · “' || q.reason || '”'
                          when 'done' then 'done by ' || coalesce(d.full_name, 'the Head of Ops')
                          else 'withdrawn' end
        from public.staff_asks q
        left join public.profiles p on p.id = q.asked_by
        left join public.profiles d on d.id = q.decided_by
       where q.asked_at > v_since
      union all
      select 'lookup', l.at, l.staff_id, coalesce(p.full_name, 'Staff'), 'lookup',
             'looked up a phone number', '…' || right(l.phone, 4),
             l.found || case when l.found = 1 then ' match' else ' matches' end
        from public.staff_lookups l left join public.profiles p on p.id = l.staff_id
       where l.at > v_since
    ) x
    where (p_staff is null or x.staff_id = p_staff)
      and (p_kind is null
        or (p_kind = 'money' and x.key in ('money', 'refund_small', 'refund_large'))
        or (p_kind = 'suspensions' and x.key in ('suspend_shop', 'ban_customer', 'refuse_shop'))
        or (p_kind = 'refused' and x.kind = 'refused')
        or (p_kind = 'rules' and x.key in ('platform_rule', 'colleague')))), '[]'),
    'refused', (select count(*) from public.staff_asks where state = 'refused' and asked_at > v_since),
    -- "Hicham has asked for a refund above his limit three times this month and
    -- been refused twice": the same ask, refused twice or more, is a pattern
    'pattern', (select json_build_object('who', coalesce(p.full_name, 'Staff'), 'staff_id', q.asked_by, 'label', k.label,
                                         'asked', count(*), 'refused', count(*) filter (where q.state = 'refused'))
                  from public.staff_asks q join public.staff_actions k on k.key = q.key
                  left join public.profiles p on p.id = q.asked_by
                 where q.asked_at > v_since
                 group by q.asked_by, p.full_name, k.label
                having count(*) filter (where q.state = 'refused') >= 2
                 order by count(*) filter (where q.state = 'refused') desc limit 1));
end $$;
grant execute on function public.admin_audit(text, uuid, int) to authenticated;

do $$
begin
  assert (select count(*) from public.staff_rpcs
           where rpc in ('admin_set_pricing', 'admin_add_district', 'admin_rename_district', 'admin_remove_district',
                         'admin_extend_task', 'admin_hold_payouts', 'admin_release_payouts')) = 7,
    'all seven desk writes are gated';
  assert not has_function_privilege('authenticated', 'public.admin_hold_payouts__direct(uuid, text)', 'execute'),
    'a hold is reachable only through the gate';
  assert has_function_privilege('authenticated', 'public.admin_hold_payouts(uuid, text)', 'execute'),
    'and the gate is reachable';
end $$;
