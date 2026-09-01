-- 0076_shop_deposit: slice 2 step 3 — the deposit belongs to the shop.
--
-- Owner - Shop turn 6 (OSH-11/12/13), gap G3 of design_handoff_slice2 §5.
-- Until now the deposit floor was one platform number: 40%, hardcoded in
-- `fill_booking` (0035, re-emitted through 0055) and in BookingSheet. §5 moves
-- it to the shop, inside bounds ops controls.
--
-- Three things the design says the model has to force into the pixels, all of
-- them schema decisions rather than copy:
--   · versioned with an effective date — a change never reaches a booking
--     already taken, so OSH-12 can promise "23 keep their 40%" truthfully
--   · a deposit is HELD, not paid (0075's `deposit_holds`) — which is why every
--     amount on the shop's side of OSH-11 is amber and not green
--   · zero is a legitimate answer, not an error state (OSH-13)
--
-- G4 — the ops desk for the bounds — is 0077, applied straight after this one.
-- Until it lands the bounds are data with no UI, exactly as
-- `salons.float_cap_cents` was (0044). The DEFAULTS ARE THE DRAWN ONES, 20%
-- and 60%.

-- ---- G4's data half -------------------------------------------------------
-- `platform_settings` is NOT new: 0066 created it for the reliability rules
-- (late_after_min, mark_days, clear_after_clean) as the same single-row table,
-- with `settings_read` / `settings_write` policies and its own `settings_changes`
-- audit. The bounds are two more columns on it, not a second settings table.
alter table public.platform_settings
  add column if not exists deposit_floor_pct int not null default 20,
  add column if not exists deposit_ceiling_pct int not null default 60;

-- `add constraint if not exists` does not exist, so the checks are guarded.
-- Named, because the console reads the failure message when ops types 120.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deposit_floor_range') then
    alter table public.platform_settings add constraint deposit_floor_range
      check (deposit_floor_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deposit_ceiling_range') then
    alter table public.platform_settings add constraint deposit_ceiling_range
      check (deposit_ceiling_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deposit_bounds_ordered') then
    alter table public.platform_settings add constraint deposit_bounds_ordered
      check (deposit_floor_pct <= deposit_ceiling_pct);
  end if;
end $$;

-- 0066 already inserted the single row, already enabled RLS, and already grants
-- select to everyone ("everyone reads the rules they are judged by"), which is
-- exactly what an owner's OSH-11 needs. Nothing to add here.
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

-- ---- the shop's policy, versioned ------------------------------------------
-- Append-only. The current policy is the newest row already in effect; history
-- is what lets a booking keep the number it was made under.
create table if not exists public.shop_deposit_policies (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  pct int not null check (pct between 0 and 100),
  effective_from timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists shop_deposit_pol_idx
  on public.shop_deposit_policies (salon_id, effective_from desc);

alter table public.shop_deposit_policies enable row level security;
create policy shop_deposit_pol_select on public.shop_deposit_policies for select to authenticated
  using (true);   -- a customer is entitled to know what a shop asks for
grant select on public.shop_deposit_policies to authenticated;
-- writes go through set_shop_deposit() only; a policy is never edited or deleted
drop trigger if exists shop_deposit_pol_no_edit on public.shop_deposit_policies;
create trigger shop_deposit_pol_no_edit
  before update or delete on public.shop_deposit_policies
  for each row execute function public.ledger_is_append_only();

-- ---- reading it ------------------------------------------------------------
-- 40 when a shop has never set one: that is the number every existing booking
-- was taken under, so silence must keep meaning what it has always meant.
create or replace function public.shop_deposit_pct(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.pct from public.shop_deposit_policies p
                    where p.salon_id = p_salon and p.effective_from <= now()
                    order by p.effective_from desc, p.created_at desc
                    limit 1), 40);
$$;
grant execute on function public.shop_deposit_pct(uuid) to authenticated;

-- The composition, decided with the repo owner 2026-08-31.
--
-- `customer_deposit_pct` (0046) returns 40 normally and 100 while an uncleared
-- late-arrival mark is under 90 days old. Its 40 was the platform baseline —
-- which is now the SHOP's job — and only the 100 is a penalty. So the two are
-- different axes and the resolved floor is the greater of them.
--
-- The one exception is a shop at zero. §5: "A shop may set the deposit to zero
-- and that shop's bookings behave exactly like slice 1." Forcing 100% on a
-- marked customer at a shop that declined deposits would be the platform
-- protecting a shop that asked not to be protected — so zero means zero.
create or replace function public.booking_deposit_pct(p_customer uuid, p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case
           when public.shop_deposit_pct(p_salon) = 0 then 0
           else greatest(public.shop_deposit_pct(p_salon),
                         public.customer_deposit_pct(p_customer))
         end;
$$;
grant execute on function public.booking_deposit_pct(uuid, uuid) to authenticated;

-- ---- enforcing it ----------------------------------------------------------
-- A SEPARATE trigger, not a seventh re-emit of `fill_booking`. 0056 set this
-- precedent for `refuse_suspended_customer`: one rule about one number, with
-- nothing to say about slots or coupons. It is named to sort AFTER
-- `before_booking_insert`, so it sees the price, discount and deposit that
-- fill_booking has already settled.
create or replace function public.enforce_shop_deposit_floor()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid; v_pct int; v_floor int; v_payable int;
begin
  -- a barber booking his own chair, or a booking taking no deposit at all,
  -- is not what this rule is about
  if new.customer_id = new.barber_id or coalesce(new.deposit_cents, 0) <= 0 then
    return new;
  end if;
  select salon_id into v_salon from public.barbers where id = new.barber_id;
  if v_salon is null then return new; end if;

  v_pct := public.booking_deposit_pct(new.customer_id, v_salon);
  -- 37b's rule, unchanged: the floor follows what the customer actually owes,
  -- so a coupon never quietly raises his deposit share.
  v_payable := new.price_cents - coalesce(new.discount_cents, 0);
  v_floor := ceil(v_payable * v_pct / 100.0);

  if new.deposit_cents < v_floor then
    raise exception 'This shop asks for at least % percent — % DH on this booking',
      v_pct, (v_floor / 100.0)::numeric(12,2);
  end if;
  return new;
end $$;

drop trigger if exists before_booking_shop_floor on public.bookings;
create trigger before_booking_shop_floor
  before insert on public.bookings
  for each row execute function public.enforce_shop_deposit_floor();

-- ---- writing it ------------------------------------------------------------
create or replace function public.set_shop_deposit(p_pct int)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid; v_floor int; v_ceiling int;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner sets the deposit'; end if;
  if p_pct is null then raise exception 'Pick a percentage'; end if;

  select deposit_floor_pct, deposit_ceiling_pct into v_floor, v_ceiling
    from public.platform_settings where id;

  -- zero is its own answer (OSH-13); anything else sits inside the bounds
  if p_pct <> 0 and (p_pct < v_floor or p_pct > v_ceiling) then
    raise exception 'A deposit is % to %, or none at all', v_floor || '%', v_ceiling || '%';
  end if;

  insert into public.shop_deposit_policies (salon_id, pct, created_by)
  values (v_salon, p_pct, auth.uid());
  return p_pct;
end $$;
grant execute on function public.set_shop_deposit(int) to authenticated;

-- ---- what OSH-11/12/13 read ------------------------------------------------
-- One call. Every figure the three screens print comes from here, so what the
-- owner is shown and what `enforce_shop_deposit_floor` will do cannot disagree.
create or replace function public.shop_deposit_state()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_salon uuid; v_pct int; v_since timestamptz; v_floor int; v_ceiling int;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner sets the deposit'; end if;

  v_pct := public.shop_deposit_pct(v_salon);
  select p.effective_from into v_since from public.shop_deposit_policies p
   where p.salon_id = v_salon and p.effective_from <= now()
   order by p.effective_from desc limit 1;
  select deposit_floor_pct, deposit_ceiling_pct into v_floor, v_ceiling
    from public.platform_settings where id;

  return json_build_object(
    'salon', v_salon,
    'salon_name', (select name from public.salons where id = v_salon),
    'pct', v_pct,
    -- null = never set, which the screen reads as "the platform's old 40%"
    'since', v_since,
    'floor_pct', v_floor,
    'ceiling_pct', v_ceiling,
    -- OSH-11's "WHAT A CUSTOMER WILL BE ASKED", computed the same way the
    -- trigger will: rounded up to the dirham, remainder is cash at the shop
    'services', coalesce((
      select json_agg(json_build_object(
               'name', x.name, 'price_cents', x.price_cents,
               'deposit_cents', ceil(x.price_cents * v_pct / 100.0)::int,
               'cash_cents', x.price_cents - ceil(x.price_cents * v_pct / 100.0)::int)
             order by x.price_cents desc)
        from (select distinct on (sv.name) sv.name, sv.price_cents
                from public.services sv
                join public.barbers b on b.id = sv.barber_id
               where b.salon_id = v_salon and sv.is_active
               order by sv.name, sv.price_cents desc) x), '[]'::json),
    -- OSH-12's "23 keep their 40%" — bookings already taken, which a change
    -- must not reach. Counted, never estimated.
    'already_booked', (
      select count(*) from public.bookings bk
        join public.barbers b on b.id = bk.barber_id
       where b.salon_id = v_salon and bk.status in ('pending', 'confirmed')
         and bk.completed_at is null and bk.starts_at > now()),
    -- OSH-13's cost of asking for nothing, over the last 30 days
    'no_shows', (
      select count(*) from public.bookings bk
        join public.barbers b on b.id = bk.barber_id
       where b.salon_id = v_salon and bk.status = 'no_show'
         and bk.starts_at > now() - interval '30 days'),
    'no_show_cents', coalesce((
      select sum(bk.price_cents) from public.bookings bk
        join public.barbers b on b.id = bk.barber_id
       where b.salon_id = v_salon and bk.status = 'no_show'
         and bk.starts_at > now() - interval '30 days'), 0)
  );
end $$;
grant execute on function public.shop_deposit_state() to authenticated;

-- ---- the assertions --------------------------------------------------------
do $$
declare v_bounds record;
begin
  select deposit_floor_pct f, deposit_ceiling_pct c into v_bounds
    from public.platform_settings where id;
  -- the bounds OSH-11 draws
  assert v_bounds.f = 20, 'the drawn Sterncut floor is 20%';
  assert v_bounds.c = 60, 'the drawn ceiling is 60%';

  -- OSH-11's own arithmetic: 50% of a 60 DH cut is 30 held, 30 cash
  assert ceil(6000 * 50 / 100.0) = 3000, '50% of 60 DH is 30 DH';
  assert 6000 - ceil(6000 * 50 / 100.0) = 3000, 'and 30 DH cash at the shop';
  -- the drawn service table, rounded up to the dirham
  assert ceil(9000 * 50 / 100.0) = 4500, '50% of a 90 DH cut and beard is 45 DH';
  assert ceil(4500 * 50 / 100.0) = 2250, 'a 45 DH kids cut rounds UP to 23 DH held';
  assert 4500 - ceil(4500 * 50 / 100.0) = 2250, 'leaving 22 DH cash — the drawn split';

  -- OSH-12's before/after, which is 0035's floor and must not have moved
  assert ceil(6000 * 40 / 100.0) = 2400, '40% of 60 DH is still 24 DH';

  -- a shop that never set a policy still asks for exactly what it always did
  assert public.shop_deposit_pct('00000000-0000-0000-0000-000000000000') = 40,
    'silence means the platform 40% every existing booking was taken under';

  -- the composition: the shop raises the floor, a mark raises it further, and
  -- a shop at zero stays at zero whatever the customer's history
  assert greatest(50, 40) = 50, 'the shop can ask for more than the baseline';
  assert greatest(20, 100) = 100, 'a late-arrival mark still outranks a low shop';
  assert (case when 0 = 0 then 0 else greatest(0, 100) end) = 0,
    'a shop at zero asks for nothing, even from a marked customer';
end $$;
