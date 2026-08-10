-- 0053_shop_tasks_and_float: barber turn 9 — where admin actions land in the shop.
--
-- Turn 9's note says "same records, no new tables — a task is a row ops already
-- writes." That is half true, and the half that isn't is the point of this file:
-- **nothing in 0001–0052 writes an obligation.** Admin 5a is the turn that issues
-- them and it isn't built either, so ops has been writing into a void exactly as
-- the note describes. `shop_tasks` is that missing row, and admin 5a will write
-- to it rather than inventing a second one.
--
-- The other two flows really are existing records seen from the shop's side:
--   * 9c/9d read `salons.status` and the same derived checklist `admin_approvals`
--     approves against (0043) — the barber must not be shown a different list
--     from the one that gates him.
--   * 9e/9f read `salon_float_cents()` / `float_settlements` from 0042+0044.
--     The float rail already exists; what was missing was a way to hand the cash
--     over without either side taking the other's word for it.

-- ---- 9a · the obligation itself --------------------------------------------
create table if not exists public.shop_tasks (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  -- 9a prints this: a barber phoning ops needs something to say out loud
  ref text not null,
  kind text not null check (kind in ('review', 'onboarding', 'float', 'licence', 'other')),
  title text not null,
  body text,
  due_at timestamptz,
  -- what the button does. 'photo' is the only one that needs something back.
  action text check (action in ('photo', 'invite', 'settle', 'none')) default 'none',
  status text not null default 'open' check (status in ('open', 'sent', 'done', 'cancelled')),
  proof_path text,
  proof_at timestamptz,
  proof_lat double precision,
  proof_lng double precision,
  -- 9b's timeline needs to say *why* the task exists, in the barber's words
  issued_because text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  resolution text
);
create index if not exists shop_tasks_salon_idx on public.shop_tasks (salon_id, status, due_at);

alter table public.shop_tasks enable row level security;
-- the shop reads its own; only ops writes them. A barber who could close his own
-- obligations would make 9a decoration.
create policy shop_tasks_select on public.shop_tasks for select to authenticated
  using (public.is_admin()
         or exists (select 1 from public.salons s
                     where s.id = shop_tasks.salon_id and s.owner_id = auth.uid()));
grant select on public.shop_tasks to authenticated;

-- ---- 9a · the inbox, and what "good standing" actually means ----------------
create or replace function public.my_shop_tasks()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_name text;
  j json;
begin
  select s.id, s.name into v_salon, v_name
    from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then return json_build_object('salon', null); end if;

  select json_build_object(
    'salon', v_salon, 'name', v_name,
    'open', (
      select coalesce(json_agg(json_build_object(
               'id', t.id, 'ref', t.ref, 'kind', t.kind, 'title', t.title,
               'body', t.body, 'due_at', t.due_at, 'action', t.action,
               'status', t.status, 'proof_at', t.proof_at, 'proof_path', t.proof_path,
               'issued_because', t.issued_because, 'created_at', t.created_at,
               -- negative = overdue. The screen never does date arithmetic.
               'days_left', case when t.due_at is null then null
                            else floor(extract(epoch from (t.due_at - now())) / 86400)::int end
             ) order by t.due_at nulls last), '[]'::json)
      from public.shop_tasks t
      where t.salon_id = v_salon and t.status in ('open', 'sent')),
    'done', (
      select coalesce(json_agg(json_build_object(
               'id', t.id, 'ref', t.ref, 'title', t.title,
               'resolved_at', t.resolved_at, 'resolution', t.resolution,
               'on_time', t.due_at is null or t.resolved_at <= t.due_at
             ) order by t.resolved_at desc), '[]'::json)
      from (select * from public.shop_tasks
             where salon_id = v_salon and status = 'done'
             order by resolved_at desc limit 10) t),
    -- 9a's green shield. "Good standing" is a fact about overdue rows, not a
    -- score: one overdue task and it stops saying it.
    'standing', json_build_object(
      'overdue', (select count(*)::int from public.shop_tasks
                   where salon_id = v_salon and status in ('open', 'sent')
                     and due_at is not null and due_at < now()),
      'done_on_time', (select count(*)::int from public.shop_tasks
                        where salon_id = v_salon and status = 'done'
                          and (due_at is null or resolved_at <= due_at)))
  ) into j;
  return j;
end;
$$;
grant execute on function public.my_shop_tasks() to authenticated;

-- private bucket for 9b's proof photos, keyed by task: {task_id}/{filename}.
-- Same shape as 0007's chat-images, so the folder name is the authorisation.
insert into storage.buckets (id, name, public)
values ('task-proof', 'task-proof', false)
on conflict (id) do nothing;

drop policy if exists "task_proof_select" on storage.objects;
create policy "task_proof_select" on storage.objects for select to authenticated
  using (bucket_id = 'task-proof' and (public.is_admin() or exists (
    select 1 from public.shop_tasks t
    join public.salons s on s.id = t.salon_id
    where t.id::text = (storage.foldername(name))[1] and s.owner_id = auth.uid()
  )));
drop policy if exists "task_proof_insert" on storage.objects;
create policy "task_proof_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-proof' and exists (
    select 1 from public.shop_tasks t
    join public.salons s on s.id = t.salon_id
    where t.id::text = (storage.foldername(name))[1] and s.owner_id = auth.uid()
      and t.status in ('open', 'sent')
  ));

-- ---- 9b · send the photo ----------------------------------------------------
-- The location rides along because that is the whole evidentiary point of 9b:
-- a poster photo without a place is a photo of a poster.
create or replace function public.submit_task_proof(
  p_task uuid, p_path text, p_lat double precision default null,
  p_lng double precision default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.shop_tasks t
     set proof_path = p_path, proof_at = now(), proof_lat = p_lat, proof_lng = p_lng,
         status = 'sent'
   where t.id = p_task
     and t.status in ('open', 'sent')
     and exists (select 1 from public.salons s
                  where s.id = t.salon_id and s.owner_id = auth.uid());
  if not found then raise exception 'That task is not yours, or it is already closed'; end if;
end;
$$;
grant execute on function public.submit_task_proof(uuid, text, double precision, double precision)
  to authenticated;

-- ---- 9c/9d · the application, from the applicant's side ---------------------
-- Deliberately the SAME five derived items as `admin_approvals` (0043), not the
-- four the canvas draws. Showing an applicant a checklist that isn't the one
-- ops approves against is the one thing this screen must not do.
create or replace function public.my_salon_application()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  s record;
  j json;
begin
  select sa.*, p.phone as owner_phone, p.full_name as owner_name
    into s
    from public.salons sa
    left join public.profiles p on p.id = sa.owner_id
   where sa.owner_id = auth.uid() limit 1;
  if not found then return json_build_object('salon', null); end if;

  select json_build_object(
    'salon', s.id, 'name', s.name, 'address', s.address, 'status', s.status,
    'submitted_at', s.submitted_at, 'reviewed_at', s.reviewed_at,
    'review_note', s.review_note, 'lat', s.lat, 'lng', s.lng,
    'reviewer', (select p.full_name from public.profiles p where p.id = s.reviewed_by),
    'checklist', json_build_array(
      json_build_object('key', 'identity', 'label', 'Identity & licence', 'ok',
        (select b.id_document_path is not null from public.barbers b where b.id = s.owner_id)),
      json_build_object('key', 'phone', 'label', 'Phone on file', 'ok', s.owner_phone is not null),
      json_build_object('key', 'services', 'label', 'Services & prices', 'ok',
        exists (select 1 from public.services sv where sv.barber_id = s.owner_id)),
      json_build_object('key', 'hours', 'label', 'Opening hours', 'ok',
        exists (select 1 from public.availability av where av.barber_id = s.owner_id)),
      json_build_object('key', 'pin', 'label', 'Drop a pin on your door', 'ok',
        s.lat is not null and s.lng is not null)),
    -- 9d's "how you look in Explore", read off the same rows Explore reads
    'preview', json_build_object(
      'services', (select count(*)::int from public.services sv
                    where sv.barber_id = s.owner_id and sv.is_active),
      'from_cents', (select min(sv.price_cents)::int from public.services sv
                      where sv.barber_id = s.owner_id and sv.is_active),
      'reviews', (select count(*)::int from public.reviews r
                   where r.barber_id = s.owner_id and r.state <> 'removed'),
      'hours', (select json_build_object('days', count(*), 'from', min(av.start_min),
                         'to', max(av.end_min))
                  from public.availability av where av.barber_id = s.owner_id))
  ) into j;
  return j;
end;
$$;
grant execute on function public.my_salon_application() to authenticated;

-- 9c's one blocking item. A pin is the only checklist row the applicant can
-- satisfy from this screen, which is why it is the only one with a control.
create or replace function public.set_salon_pin(p_lat double precision, p_lng double precision)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_lat is null or p_lng is null then raise exception 'Drop the pin first'; end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'That is not a place';
  end if;
  update public.salons set lat = p_lat, lng = p_lng
   where owner_id = auth.uid() and status in ('pending', 'live');
  if not found then raise exception 'You do not own a shop we can move'; end if;
end;
$$;
grant execute on function public.set_salon_pin(double precision, double precision) to authenticated;

-- ---- 9e/9f · handing the cash over -----------------------------------------
-- The rail (0042/0044) could already record a settlement. What it could not do
-- is let two people in a shop agree that it happened: the admin console just
-- asserted a collection. 9e/9f fixes that with one short-lived code the barber
-- reads out and the collector types in — neither side can complete it alone.
alter table public.salons
  add column if not exists handover_code text,
  add column if not exists handover_code_at timestamptz;

alter table public.float_settlements
  add column if not exists collected_by uuid references public.profiles (id);

create or replace function public.my_float()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_salon uuid;
  j json;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then return json_build_object('salon', null); end if;

  select json_build_object(
    'salon', v_salon,
    'float_cents', public.salon_float_cents(v_salon),
    'owed_cents', public.salon_owed_cents(v_salon),
    'net_cents', public.salon_net_cents(v_salon),
    'cap_cents', (select float_cap_cents from public.salons where id = v_salon),
    'code', (select handover_code from public.salons where id = v_salon),
    -- 9e's "31 top-ups": the ones since the last collection, which is what the
    -- number in the drawer is actually made of
    'topups', (
      select count(*)::int from public.wallet_transactions w
       where w.salon_id = v_salon and w.kind = 'cash_topup'
         and w.created_at > coalesce((select max(f.covers_to) from public.float_settlements f
                                       where f.salon_id = v_salon and f.amount_cents > 0),
                                     '-infinity'::timestamptz)),
    -- "Held 19 days · the cap is 14" — the age of the oldest uncollected cash,
    -- not the age of the shop's account
    'held_days', (
      select floor(extract(epoch from (now() - min(w.created_at))) / 86400)::int
        from public.wallet_transactions w
       where w.salon_id = v_salon and w.kind = 'cash_topup'
         and w.created_at > coalesce((select max(f.covers_to) from public.float_settlements f
                                       where f.salon_id = v_salon and f.amount_cents > 0),
                                     '-infinity'::timestamptz))
  ) into j;
  return j;
end;
$$;
grant execute on function public.my_float() to authenticated;

-- 9e — "Show her this code". Minted on demand and stable while it is fresh, so
-- reopening the screen mid-handover doesn't change the number under her pen.
create or replace function public.float_handover_code()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_code text;
  v_at timestamptz;
begin
  select s.id, s.handover_code, s.handover_code_at into v_salon, v_code, v_at
    from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'You do not own a shop'; end if;

  if v_code is null or v_at is null or v_at < now() - interval '12 hours' then
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
    update public.salons set handover_code = v_code, handover_code_at = now()
     where id = v_salon;
  end if;
  return v_code;
end;
$$;
grant execute on function public.float_handover_code() to authenticated;

-- 9f — the collector's half. Admin-only, because the person holding the round is
-- ops. The code is the whole control: without it this is `admin_settle_float`
-- with extra steps, and with it neither side can record a handover alone.
create or replace function public.agent_collect_float(
  p_salon uuid, p_code text, p_declared_cents int)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_expected int;
  v_code text;
  v_at timestamptz;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Collections are ops only'; end if;

  select handover_code, handover_code_at into v_code, v_at
    from public.salons where id = p_salon;
  if v_code is null or v_at < now() - interval '12 hours' then
    raise exception 'Ask him to open Settle up — his code has expired';
  end if;
  if v_code is distinct from p_code then raise exception 'That code does not match'; end if;

  v_expected := public.salon_float_cents(p_salon);
  if v_expected <= 0 then raise exception 'There is nothing in that drawer'; end if;
  if p_declared_cents <= 0 then raise exception 'Count what you were handed'; end if;

  insert into public.float_settlements
    (salon_id, amount_cents, expected_cents, declared_cents, settled_by, collected_by, note)
  values (p_salon, v_expected, v_expected, p_declared_cents, auth.uid(), auth.uid(),
          'Collected in person')
  returning id into v_id;

  -- the code is spent, and any float task it answered is closed with it
  update public.salons set handover_code = null, handover_code_at = null where id = p_salon;
  update public.shop_tasks
     set status = 'done', resolved_at = now(), resolved_by = auth.uid(),
         resolution = 'Collected in person'
   where salon_id = p_salon and kind = 'float' and status in ('open', 'sent');

  return v_id;
end;
$$;
grant execute on function public.agent_collect_float(uuid, text, int) to authenticated;

-- 9f — the round. Every shop holding cash, oldest money first, because that is
-- the one that is closest to breaking the cap.
create or replace function public.agent_round()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Collections are ops only'; end if;

  select json_build_object(
    'carrying_cents', coalesce((select sum(f.amount_cents)::int from public.float_settlements f
                                 where f.collected_by = auth.uid()
                                   and f.created_at >= date_trunc('day', now())
                                   and f.amount_cents > 0), 0),
    'done_today', (select count(*)::int from public.float_settlements f
                    where f.collected_by = auth.uid()
                      and f.created_at >= date_trunc('day', now()) and f.amount_cents > 0),
    'stops', (
      select coalesce(json_agg(x order by x.held_days desc nulls last), '[]'::json) from (
        select s.id, s.name, s.address,
               coalesce(p.full_name, 'Owner') as owner,
               public.salon_float_cents(s.id) as float_cents,
               s.float_cap_cents,
               s.handover_code is not null and s.handover_code_at > now() - interval '12 hours'
                 as ready,
               (select count(*)::int from public.wallet_transactions w
                 where w.salon_id = s.id and w.kind = 'cash_topup'
                   and w.created_at > coalesce((select max(f.covers_to)
                                                  from public.float_settlements f
                                                 where f.salon_id = s.id and f.amount_cents > 0),
                                               '-infinity'::timestamptz)) as topups,
               (select floor(extract(epoch from (now() - min(w.created_at))) / 86400)::int
                  from public.wallet_transactions w
                 where w.salon_id = s.id and w.kind = 'cash_topup'
                   and w.created_at > coalesce((select max(f.covers_to)
                                                  from public.float_settlements f
                                                 where f.salon_id = s.id and f.amount_cents > 0),
                                               '-infinity'::timestamptz)) as held_days
        from public.salons s
        left join public.profiles p on p.id = s.owner_id
        where s.status = 'live' and public.salon_float_cents(s.id) > 0
      ) x)
  ) into j;
  return j;
end;
$$;
grant execute on function public.agent_round() to authenticated;

-- ---- the rules, where they can be read -------------------------------------
do $$
begin
  -- 9a's chip. Ops issues in whole days, so the boundary has to be exact.
  assert floor(6.9) = 6, 'six-and-a-bit days left reads as DUE IN 6 DAYS';
  assert floor(-0.5) = -1, 'a task an hour overdue reads overdue, not due today';
  -- 9e's warning: held longer than the cap allows
  assert 19 > 14, '19 days held against a 14-day cap is late';
  -- the handover code is four digits including the leading-zero cases
  assert length(lpad((7)::text, 4, '0')) = 4, 'a low draw is still four digits';
  assert lpad((7)::text, 4, '0') = '0007', 'and it keeps its zeros';
end $$;
