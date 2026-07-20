-- 0025_salon_management: real backend for the owner Salon screen (SalonScreen).
-- Adds per-barber pay terms + salon-membership approval, salon-level settings, and
-- owner-only RPCs for the team list and aggregate stats. The privacy rule from the
-- BACKLOG lives in the DB: a rent barber's revenue is never returned to the owner.
--
-- NOT here (blocked/pending — see BACKLOG "Owner: salon management"):
--   packages (booking-mapping decision pending), payouts/taxes + reports (need the
--   Phase 2 settlement rail), granular roles/permissions, invite-by-phone + share
--   link (need the brber.ma web surface). Live presence is derived, not realtime.

-- ---------- schema ----------

alter table public.barbers
  add column salon_role text not null default 'barber'
    check (salon_role in ('owner', 'senior', 'barber', 'apprentice')),
  -- membership in a salon: joining one you don't own lands 'pending' (guard below)
  add column salon_status text not null default 'approved'
    check (salon_status in ('pending', 'approved', 'rejected')),
  add column pay_model text not null default 'rent'
    check (pay_model in ('rent', 'commission')),
  add column commission_pct int not null default 55 check (commission_pct between 0 and 100),
  add column rent_cents int not null default 0 check (rent_cents >= 0),
  add column chair_label text;

-- existing owners (0011 gave every barber a one-man salon) get the 'owner' label
update public.barbers b set salon_role = 'owner'
where exists (select 1 from public.salons s where s.id = b.salon_id and s.owner_id = b.id);

alter table public.salons
  add column cash_agent_id uuid references public.barbers (id),
  add column default_commission int not null default 55 check (default_commission between 0 and 100),
  add column accepting_bookings boolean not null default true; -- salon-wide "shop open"

update public.salons set cash_agent_id = owner_id where cash_agent_id is null;

-- pay terms / role / status are owner-set via the RPCs below, never self-set:
-- no column grant is added, so a barber cannot change their own split or approve
-- themselves. salon-level columns are already covered by 0011's table grant.

-- ---------- triggers ----------

-- default the cash agent to the owner when a salon is created
create or replace function public.salons_defaults()
returns trigger language plpgsql as $$
begin
  new.cash_agent_id := coalesce(new.cash_agent_id, new.owner_id);
  return new;
end;
$$;
create trigger salons_before_insert before insert on public.salons
  for each row execute function public.salons_defaults();

-- the creator is an approved owner of their salon
create or replace function public.salons_claim_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.barbers set salon_role = 'owner', salon_status = 'approved'
  where id = new.owner_id;
  return new;
end;
$$;
create trigger salons_after_insert after insert on public.salons
  for each row execute function public.salons_claim_owner();

-- joining a salon you don't own lands 'pending' until the owner approves — closes
-- the hole where any barber could attach to a salon and show under its reviews.
create or replace function public.barbers_membership_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.salon_id is distinct from old.salon_id
     and new.salon_id is not null
     and not exists (select 1 from public.salons s where s.id = new.salon_id and s.owner_id = new.id) then
    new.salon_status := 'pending';
    new.salon_role := 'barber';
  end if;
  return new;
end;
$$;
create trigger barbers_before_update before update on public.barbers
  for each row execute function public.barbers_membership_guard();

-- ---------- owner-only RPCs ----------
-- All are security definer + self-check the caller owns a salon, so they safely
-- read past RLS (an owner can't otherwise see co-barbers' bookings).

-- per-member row for the Team tab; today_revenue_cents is NULL for rent barbers
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
    b.salon_role, b.chair_label, b.salon_status,
    b.pay_model, b.commission_pct, b.rent_cents,
    coalesce(rv.avg_rating, 0)::numeric, coalesce(rv.n, 0)::int,
    coalesce(bk.n_today, 0)::int,
    case when b.pay_model = 'commission' then coalesce(bk.rev_today, 0)::int else null end,
    coalesce(bk.active, false),
    (b.id = v_agent)
  from public.barbers b
  join public.profiles p on p.id = b.id
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
  order by (b.salon_role = 'owner') desc, b.chair_label nulls last, p.full_name;
end;
$$;

-- salon-wide aggregates for the shop header (never per-barber; safe for every model)
create or replace function public.salon_stats()
returns table (on_floor int, chairs int, bookings int, revenue_cents int, shop_cut_cents int)
language plpgsql security definer set search_path = '' as $$
declare
  v_salon uuid;
  v_day timestamptz := timezone('Africa/Casablanca', date_trunc('day', timezone('Africa/Casablanca', now())));
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can view stats'; end if;

  return query
  with mem as (
    select b.id, b.pay_model, b.commission_pct, b.accepting_bookings
    from public.barbers b where b.salon_id = v_salon and b.salon_status = 'approved'
  ),
  bk as (
    select bo.barber_id, bo.price_cents
    from public.bookings bo join mem on mem.id = bo.barber_id
    where bo.starts_at >= v_day and bo.starts_at < v_day + interval '1 day'
      and bo.status in ('confirmed', 'completed')
  )
  select
    (select count(*) from mem where accepting_bookings)::int,
    (select count(*) from mem)::int,
    (select count(*) from bk)::int,
    coalesce((select sum(price_cents) from bk), 0)::int,
    coalesce((select sum(bk.price_cents * (100 - mem.commission_pct) / 100)
              from bk join mem on mem.id = bk.barber_id where mem.pay_model = 'commission'), 0)::int;
end;
$$;

-- owner sets a member's pay terms / role / chair
create or replace function public.salon_set_terms(
  p_barber uuid, p_salon_role text, p_pay_model text,
  p_commission_pct int, p_rent_cents int, p_chair text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can edit staff'; end if;
  if not exists (select 1 from public.barbers where id = p_barber and salon_id = v_salon) then
    raise exception 'Not a member of your salon';
  end if;
  if p_salon_role not in ('owner', 'senior', 'barber', 'apprentice') then raise exception 'Bad role'; end if;
  if p_pay_model not in ('rent', 'commission') then raise exception 'Bad pay model'; end if;
  if p_commission_pct < 0 or p_commission_pct > 100 then raise exception 'Split must be 0-100'; end if;
  update public.barbers set
    salon_role = p_salon_role, pay_model = p_pay_model,
    commission_pct = p_commission_pct, rent_cents = greatest(p_rent_cents, 0),
    chair_label = nullif(btrim(p_chair), '')
  where id = p_barber;
end;
$$;

-- owner approves a pending join request
create or replace function public.salon_approve_member(p_barber uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can approve staff'; end if;
  update public.barbers set salon_status = 'approved'
  where id = p_barber and salon_id = v_salon and salon_status = 'pending';
  if not found then raise exception 'No pending request for that barber'; end if;
end;
$$;

-- owner removes / declines a member (they fall back to no salon)
create or replace function public.salon_remove_member(p_barber uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid; v_owner uuid;
begin
  select s.id, s.owner_id into v_salon, v_owner from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can remove staff'; end if;
  if p_barber = v_owner then raise exception 'The owner cannot be removed'; end if;
  update public.barbers set
    salon_id = null, salon_status = 'pending', salon_role = 'barber',
    pay_model = 'rent', commission_pct = 55, rent_cents = 0, chair_label = null
  where id = p_barber and salon_id = v_salon;
  if not found then raise exception 'Not a member of your salon'; end if;
  -- if the removed barber held the till, hand the cash agent back to the owner
  update public.salons set cash_agent_id = v_owner where id = v_salon and cash_agent_id = p_barber;
end;
$$;

-- owner picks which member is the cash agent (must be an approved member)
create or replace function public.salon_set_cash_agent(p_barber uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can set the cash agent'; end if;
  if not exists (select 1 from public.barbers
                 where id = p_barber and salon_id = v_salon and salon_status = 'approved') then
    raise exception 'Cash agent must be an approved member';
  end if;
  update public.salons set cash_agent_id = p_barber where id = v_salon;
end;
$$;

grant execute on function public.salon_team() to authenticated;
grant execute on function public.salon_stats() to authenticated;
grant execute on function public.salon_set_terms(uuid, text, text, int, int, text) to authenticated;
grant execute on function public.salon_approve_member(uuid) to authenticated;
grant execute on function public.salon_remove_member(uuid) to authenticated;
grant execute on function public.salon_set_cash_agent(uuid) to authenticated;
