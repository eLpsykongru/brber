-- 0142_chair_rent: a chair you can rent, and the rent once somebody does.
--
-- BRB-30 draws an empty chair 4 with "LOOK FOR A BARBER FOR CHAIR 4" and the toast
-- "Posted — barbers nearby can see chair 4". Until now a chair was a label and an
-- occupant (0026) and a rent barber was one number nobody could set (0025):
--
--   * a chair carries its asking rent, by the week or the month, and a short note
--   * the owner can list an empty chair; listed chairs are what open_chairs()
--     shows other barbers, with the shop's rating and the owner's phone to call
--   * vacant_since says how long a chair has stood empty — stamped by a trigger,
--     so every path that empties a chair keeps it true
--   * a barber leaving the shop now frees his chair. None of the four ways out
--     (0128, 0130, 0131 ×2) touched `chairs`, so the chair kept a man who had gone
--   * the agreed rent gets its period (barbers.rent_period), and the cash rent
--     the owner takes at the shop is written down (rent_payments) the way 0031
--     writes down commission: bookkeeping, nothing moves
--
-- Not 0031's salon_settlements: salon_last_settled() is where the commission
-- statement starts counting, so a rent row there would move that date.

-- ---- the chair -----------------------------------------------------------------
alter table public.chairs
  add column rent_cents int check (rent_cents >= 0),       -- the asking rent; null = not said
  add column rent_period text not null default 'month' check (rent_period in ('week', 'month')),
  add column note text check (char_length(note) <= 280),   -- what comes with it, in the owner's words
  add column listed_at timestamptz,                         -- shown to barbers looking for a chair
  add column vacant_since timestamptz;                      -- null while somebody sits in it, or unknown

-- the agreed rent's period, next to the agreed rent
alter table public.barbers
  add column rent_period text not null default 'month' check (rent_period in ('week', 'month'));

-- Chairs still held by a barber who is no longer an approved member of that shop
-- are the departures nobody freed. Empty them, dated by 0128's departure log where
-- it has one. A chair that was already empty keeps vacant_since null: nobody wrote
-- down since when, and a guess would print as a fact.
update public.chairs c
   set barber_id = null,
       vacant_since = coalesce((select max(d.left_at) from public.salon_departures d
                                 where d.barber_id = c.barber_id and d.salon_id = c.salon_id), now())
 where c.barber_id is not null
   and not exists (select 1 from public.barbers b
                    where b.id = c.barber_id and b.salon_id = c.salon_id and b.salon_status = 'approved');

-- every way a chair empties or fills, stamped in one place
create or replace function public.chairs_stamp_vacancy()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.barber_id is not null then
    new.vacant_since := null;
    new.listed_at := null;          -- a filled chair stops being advertised
  elsif tg_op = 'INSERT' or old.barber_id is not null then
    new.vacant_since := now();
  end if;
  return new;
end $$;
drop trigger if exists chairs_stamp_vacancy on public.chairs;
create trigger chairs_stamp_vacancy before insert or update of barber_id on public.chairs
  for each row execute function public.chairs_stamp_vacancy();

-- a barber who leaves a shop leaves his chair — beside 0128's barbers_note_departure
create or replace function public.free_departed_chair()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.chairs set barber_id = null where barber_id = old.id and salon_id = old.salon_id;
  return new;
end $$;
drop trigger if exists barbers_free_chair on public.barbers;
create trigger barbers_free_chair after update of salon_id on public.barbers
  for each row when (old.salon_id is not null and old.salon_id is distinct from new.salon_id)
  execute function public.free_departed_chair();

-- ---- the owner's chairs, now with what each one asks ----------------------------
drop function public.salon_chairs();
create function public.salon_chairs()
returns table (chair_id uuid, label text, sort int, barber_id uuid,
               barber_name text, avatar_url text, availability text,
               rent_cents int, rent_period text, note text,
               listed_at timestamptz, vacant_since timestamptz)
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
    end,
    c.rent_cents, c.rent_period, c.note, c.listed_at, c.vacant_since
  from public.chairs c
  left join public.barbers b on b.id = c.barber_id
  left join public.profiles p on p.id = c.barber_id
  where c.salon_id = v_salon
  order by c.sort, c.label;
end;
$$;
revoke all on function public.salon_chairs() from public, anon;
grant execute on function public.salon_chairs() to authenticated;

-- the asking rent, the note, and whether barbers can see it. Only an empty chair is
-- listed: one with a barber in it is not for rent, whatever the owner meant.
create or replace function public.salon_set_chair(
  p_chair uuid, p_rent_cents int, p_rent_period text, p_note text, p_listed boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid; v_barber uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can change a chair'; end if;
  select c.barber_id into v_barber from public.chairs c where c.id = p_chair and c.salon_id = v_salon;
  if not found then raise exception 'Not a chair in your salon'; end if;
  if p_rent_cents < 0 then raise exception 'Rent can''t be below zero'; end if;
  if coalesce(p_rent_period, '') not in ('week', 'month') then
    raise exception 'Rent is by the week or by the month';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) > 280 then raise exception 'Keep the note under 280 characters'; end if;
  if p_listed and v_barber is not null then
    raise exception 'Somebody sits in this chair — empty it before looking for a barber';
  end if;
  update public.chairs set
    rent_cents = p_rent_cents,
    rent_period = p_rent_period,
    note = nullif(btrim(p_note), ''),
    listed_at = case when p_listed then coalesce(listed_at, now()) end
  where id = p_chair;
end;
$$;
revoke all on function public.salon_set_chair(uuid, int, text, text, boolean) from public, anon;
grant execute on function public.salon_set_chair(uuid, int, text, text, boolean) to authenticated;

-- ---- what a barber looking for a chair sees (RVW-10) ----------------------------
-- Barbers only: it carries the owner's phone, which he agreed to show by listing.
-- ponytail: newest first, not nearest — Tangier's list is short; sort by distance
-- from the caller's shop once a city's list needs scrolling.
create or replace function public.open_chairs()
returns table (chair_id uuid, label text, rent_cents int, rent_period text, note text,
               listed_at timestamptz, vacant_since timestamptz,
               salon_id uuid, salon_name text, address text, district text,
               owner_name text, owner_phone text,
               rating numeric, reviews_count int, barbers int)
language plpgsql stable security definer set search_path = '' as $$
declare v_mine uuid;
begin
  select b.salon_id into v_mine from public.barbers b where b.id = auth.uid();
  if not found then raise exception 'Only barbers can see chairs for rent'; end if;
  return query
  select c.id, c.label, c.rent_cents, c.rent_period, c.note, c.listed_at, c.vacant_since,
         s.id, s.name, s.address, s.district,
         coalesce(p.full_name, 'Owner'), p.phone,
         rv.avg_rating, rv.n, tm.n
  from public.chairs c
  join public.salons s on s.id = c.salon_id
  left join public.profiles p on p.id = s.owner_id
  left join lateral (
    select round(avg(r.rating), 1) avg_rating, count(*)::int n
    from public.reviews r join public.barbers b on b.id = r.barber_id
    where b.salon_id = s.id and b.salon_status = 'approved'
  ) rv on true
  left join lateral (
    select count(*)::int n from public.barbers b
    where b.salon_id = s.id and b.salon_status = 'approved'
  ) tm on true
  where c.listed_at is not null and c.barber_id is null
    and s.status = 'live'
    and s.id is distinct from v_mine
  order by c.listed_at desc;
end;
$$;
revoke all on function public.open_chairs() from public, anon;
grant execute on function public.open_chairs() to authenticated;

-- ---- the agreed terms: the rent's period comes along ----------------------------
-- p_rent_period defaults to null = keep, so a caller that doesn't send it changes
-- nothing. The old six-argument function goes first: PostgREST can't choose
-- between it and this one when six named arguments arrive.
drop function public.salon_set_terms(uuid, text, text, int, int, text);
create function public.salon_set_terms(
  p_barber uuid, p_salon_role text, p_pay_model text,
  p_commission_pct int, p_rent_cents int, p_chair text, p_rent_period text default null
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
  if p_rent_period not in ('week', 'month') then raise exception 'Rent is by the week or by the month'; end if;
  update public.barbers set
    salon_role = p_salon_role, pay_model = p_pay_model,
    commission_pct = p_commission_pct, rent_cents = greatest(p_rent_cents, 0),
    rent_period = coalesce(p_rent_period, rent_period),
    chair_label = nullif(btrim(p_chair), '')
  where id = p_barber;
end;
$$;
revoke all on function public.salon_set_terms(uuid, text, text, int, int, text, text) from public, anon;
grant execute on function public.salon_set_terms(uuid, text, text, int, int, text, text) to authenticated;

-- 0026's salon_team plus rent_period (0139's zone, never the literal)
drop function public.salon_team();
create function public.salon_team()
returns table (
  barber_id uuid, full_name text, avatar_url text,
  salon_role text, chair_label text, salon_status text,
  pay_model text, commission_pct int, rent_cents int,
  rating numeric, reviews_count int,
  today_bookings int, today_revenue_cents int,
  in_service boolean, is_cash_agent boolean,
  rent_period text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_salon uuid;
  v_agent uuid;
  v_day timestamptz := timezone(public.morocco_tz(), date_trunc('day', timezone(public.morocco_tz(), now())));
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
    (b.id = v_agent),
    b.rent_period
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
revoke all on function public.salon_team() from public, anon;
grant execute on function public.salon_team() to authenticated;

-- ---- rent taken at the shop -----------------------------------------------------
create table public.rent_payments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  barber_id uuid not null references public.barbers (id),
  amount_cents int not null check (amount_cents > 0),
  covers_from timestamptz not null,
  covers_to timestamptz not null check (covers_to > covers_from),
  recorded_by uuid not null references public.barbers (id),
  created_at timestamptz not null default now()
);
create index rent_payments_idx on public.rent_payments (salon_id, barber_id, covers_to desc);
alter table public.rent_payments enable row level security;
-- the shop that took it and the barber who paid it
create policy rent_payments_select on public.rent_payments for select to authenticated
  using (barber_id = auth.uid()
         or salon_id in (select s.id from public.salons s where s.owner_id = auth.uid()));
grant select on public.rent_payments to authenticated;
-- no insert/delete grants: rows come and go through the two functions below

-- One period at a time, each starting where the last paid one ended; the first is
-- the calendar month (or Monday's week) we are in. The amount is the agreed rent,
-- read here — not a number the screen sends.
-- ponytail: contiguous periods, so a barber who went to commission and came back
-- resumes from his old paid-up date; add a "start from this period" choice if that bites.
create or replace function public.salon_rent_received(p_barber uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_salon uuid; v_rent int; v_period text; v_model text; v_role text;
  v_tz text := public.morocco_tz();
  v_from timestamptz; v_to timestamptz;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner records rent'; end if;
  select b.rent_cents, b.rent_period, b.pay_model, b.salon_role
    into v_rent, v_period, v_model, v_role
  from public.barbers b where b.id = p_barber and b.salon_id = v_salon and b.salon_status = 'approved';
  if not found then raise exception 'Not a barber in your shop'; end if;
  if v_model <> 'rent' or v_role = 'owner' then raise exception 'This barber doesn''t pay rent'; end if;
  if v_rent <= 0 then raise exception 'Set the rent first'; end if;

  select max(r.covers_to) into v_from from public.rent_payments r
  where r.salon_id = v_salon and r.barber_id = p_barber;
  if v_from is null then
    v_from := timezone(v_tz, date_trunc(case when v_period = 'week' then 'week' else 'month' end,
                                        timezone(v_tz, now())));
  end if;
  v_to := timezone(v_tz, timezone(v_tz, v_from)
                         + case when v_period = 'week' then interval '7 days' else interval '1 month' end);

  insert into public.rent_payments (salon_id, barber_id, amount_cents, covers_from, covers_to, recorded_by)
  values (v_salon, p_barber, v_rent, v_from, v_to, auth.uid());
  return v_to;
end;
$$;
revoke all on function public.salon_rent_received(uuid) from public, anon;
grant execute on function public.salon_rent_received(uuid) to authenticated;

-- a slip of the thumb: only the latest period can be taken back, so the paid
-- periods stay one unbroken run
create or replace function public.salon_rent_undo(p_barber uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner records rent'; end if;
  delete from public.rent_payments where id = (
    select r.id from public.rent_payments r
    where r.salon_id = v_salon and r.barber_id = p_barber
    order by r.covers_to desc limit 1);
  if not found then raise exception 'No rent written down for this barber'; end if;
end;
$$;
revoke all on function public.salon_rent_undo(uuid) from public, anon;
grant execute on function public.salon_rent_undo(uuid) to authenticated;
