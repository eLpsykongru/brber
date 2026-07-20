-- 0026_chairs: physical chairs as first-class, so an owner can assign barbers to
-- chairs and see availability at a glance. Chairs are the source of truth for the
-- chair label now (0025's barbers.chair_label becomes vestigial — salon_team()
-- below reads the chair off this table). A chair with no barber is an empty chair;
-- a barber holds at most one chair (partial unique).

create table public.chairs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  label text not null,
  barber_id uuid references public.barbers (id),  -- null = empty chair
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index chairs_salon_idx on public.chairs (salon_id, sort);
create unique index chairs_barber_uniq on public.chairs (barber_id) where barber_id is not null;

alter table public.chairs enable row level security;
-- members can read their salon's chairs; all writes go through the owner RPCs below
create policy chairs_select on public.chairs for select to authenticated
  using (salon_id in (select b.salon_id from public.barbers b where b.id = auth.uid()));
grant select on public.chairs to authenticated;

-- carry any chair labels already set on barbers into real chairs
insert into public.chairs (salon_id, label, barber_id, sort)
select b.salon_id, b.chair_label, b.id,
       row_number() over (partition by b.salon_id order by b.chair_label)
from public.barbers b
where b.chair_label is not null and b.salon_id is not null;

-- ---------- owner-only RPCs ----------

-- every chair with its occupant + a derived availability for the at-a-glance grid
create or replace function public.salon_chairs()
returns table (chair_id uuid, label text, sort int, barber_id uuid,
               barber_name text, avatar_url text, availability text)
language plpgsql security definer set search_path = '' as $$
declare v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can view chairs'; end if;
  return query
  select c.id, c.label, c.sort, c.barber_id,
    coalesce(p.full_name, 'Barber'), p.avatar_url,
    case
      when c.barber_id is null then 'empty'
      when exists (select 1 from public.bookings bo
                   where bo.barber_id = c.barber_id
                     and bo.started_at is not null and bo.completed_at is null) then 'busy'
      when b.accepting_bookings then 'open'
      else 'off'
    end
  from public.chairs c
  left join public.barbers b on b.id = c.barber_id
  left join public.profiles p on p.id = c.barber_id
  where c.salon_id = v_salon
  order by c.sort, c.label;
end;
$$;

create or replace function public.salon_add_chair(p_label text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_salon uuid; v_id uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can add chairs'; end if;
  if coalesce(btrim(p_label), '') = '' then raise exception 'Chair needs a label'; end if;
  insert into public.chairs (salon_id, label, sort)
  values (v_salon, btrim(p_label), (select coalesce(max(sort), 0) + 1 from public.chairs where salon_id = v_salon))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.salon_rename_chair(p_chair uuid, p_label text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can rename chairs'; end if;
  if coalesce(btrim(p_label), '') = '' then raise exception 'Chair needs a label'; end if;
  update public.chairs set label = btrim(p_label) where id = p_chair and salon_id = v_salon;
  if not found then raise exception 'Not a chair in your salon'; end if;
end;
$$;

create or replace function public.salon_delete_chair(p_chair uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can delete chairs'; end if;
  delete from public.chairs where id = p_chair and salon_id = v_salon;
  if not found then raise exception 'Not a chair in your salon'; end if;
end;
$$;

-- assign a barber to a chair (p_barber null = leave empty). One chair per barber:
-- their previous chair is freed first.
create or replace function public.salon_assign_chair(p_chair uuid, p_barber uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can assign chairs'; end if;
  if not exists (select 1 from public.chairs where id = p_chair and salon_id = v_salon) then
    raise exception 'Not a chair in your salon';
  end if;
  if p_barber is not null and not exists (
    select 1 from public.barbers where id = p_barber and salon_id = v_salon and salon_status = 'approved') then
    raise exception 'Assign an approved member';
  end if;
  if p_barber is not null then
    update public.chairs set barber_id = null
    where salon_id = v_salon and barber_id = p_barber and id <> p_chair;
  end if;
  update public.chairs set barber_id = p_barber where id = p_chair and salon_id = v_salon;
end;
$$;

grant execute on function public.salon_chairs() to authenticated;
grant execute on function public.salon_add_chair(text) to authenticated;
grant execute on function public.salon_rename_chair(uuid, text) to authenticated;
grant execute on function public.salon_delete_chair(uuid) to authenticated;
grant execute on function public.salon_assign_chair(uuid, uuid) to authenticated;

-- ---------- chair is now sourced from the chairs table ----------
-- replace salon_team() so the Team tab / member sheet show the assigned chair
create or replace function public.salon_team()
returns table (
  barber_id uuid, full_name text, avatar_url text,
  salon_role text, chair_label text, salon_status text,
  pay_model text, commission_pct int, rent_cents int,
  rating numeric, reviews_count int,
  today_bookings int, today_revenue_cents int,
  in_service boolean, is_cash_agent boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  v_salon uuid;
  v_agent uuid;
  v_day timestamptz := timezone('Africa/Casablanca', date_trunc('day', timezone('Africa/Casablanca', now())));
begin
  select s.id, s.cash_agent_id into v_salon, v_agent
  from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can view the team'; end if;

  return query
  select
    b.id, coalesce(p.full_name, 'Barber'), p.avatar_url,
    b.salon_role, ch.label, b.salon_status,
    b.pay_model, b.commission_pct, b.rent_cents,
    coalesce(rv.avg_rating, 0)::numeric, coalesce(rv.n, 0)::int,
    coalesce(bk.n_today, 0)::int,
    case when b.pay_model = 'commission' then coalesce(bk.rev_today, 0)::int else null end,
    coalesce(bk.active, false),
    (b.id = v_agent)
  from public.barbers b
  join public.profiles p on p.id = b.id
  left join public.chairs ch on ch.barber_id = b.id
  left join lateral (
    select avg(r.rating) avg_rating, count(*) n
    from public.reviews r where r.barber_id = b.id
  ) rv on true
  left join lateral (
    select
      count(*) filter (
        where bo.starts_at >= v_day and bo.starts_at < v_day + interval '1 day'
        and bo.status in ('confirmed', 'completed')) n_today,
      sum(bo.price_cents) filter (
        where bo.starts_at >= v_day and bo.starts_at < v_day + interval '1 day'
        and bo.status in ('confirmed', 'completed')) rev_today,
      bool_or(bo.started_at is not null and bo.completed_at is null) active
    from public.bookings bo where bo.barber_id = b.id
  ) bk on true
  where b.salon_id = v_salon
  order by (b.salon_role = 'owner') desc, ch.sort nulls last, p.full_name;
end;
$$;
