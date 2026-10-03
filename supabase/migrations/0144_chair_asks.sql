-- 0144_chair_asks: a barber asks for a listed chair in the app, and the owner takes
-- him on or says no. Plus what 0142 left open: nearest chairs first, the barber's
-- own terms and rent (0143 took them off the table), and starting rent afresh.
--
--   * ask_for_chair: one open ask per barber per chair; the owner gets a push.
--   * take_chair_ask moves him: out of the shop he was in (0128's departure log and
--     0142's chair-freeing trigger fire as for any leaver), into this one, onto the
--     chair, on the chair's asking rent. Everybody else who asked hears it went.
--     The guards are salon_remove_member's (0128): no shop owner, not the shop's
--     till, no drawer handover under way — checked when he asks and again when he
--     is taken on, because either can change in between.
--   * decline_chair_ask / withdraw_chair_ask close an ask from either side.
--
-- Notifications reuse 'shop_status': the app shows it as a plain inbox line, which
-- is all these are, and a new notif_kind would need a migration of its own.

create table public.chair_asks (
  id uuid primary key default gen_random_uuid(),
  chair_id uuid not null references public.chairs (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  barber_id uuid not null references public.barbers (id) on delete cascade,
  created_at timestamptz not null default now(),
  answer text check (answer in ('taken', 'declined', 'withdrawn')),
  answered_at timestamptz
);
create unique index chair_asks_open_uniq on public.chair_asks (chair_id, barber_id) where answer is null;
create index chair_asks_salon_idx on public.chair_asks (salon_id) where answer is null;
alter table public.chair_asks enable row level security;
-- the barber who asked and the shop he asked
create policy chair_asks_select on public.chair_asks for select to authenticated
  using (barber_id = auth.uid()
         or salon_id in (select s.id from public.salons s where s.owner_id = auth.uid()));
grant select on public.chair_asks to authenticated;
-- no writes from the app: the functions below

-- why a barber can't move shops right now: 'owner' | 'till' | 'handover' | null
create or replace function public.chair_move_block(p_barber uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.salons s where s.owner_id = p_barber) then 'owner'
    when b.salon_id is not null and b.salon_status = 'approved' and p_barber = public.till_of(b.salon_id) then 'till'
    when exists (select 1 from public.drawer_transfers t
                  where t.salon_id = b.salon_id and t.state in ('pending', 'mismatch')
                    and p_barber in (t.from_id, t.to_id)) then 'handover'
  end
  from public.barbers b where b.id = p_barber;
$$;
revoke all on function public.chair_move_block(uuid) from public, anon, authenticated;

create or replace function public.ask_for_chair(p_chair uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_mine uuid; v_chair public.chairs; v_shop public.salons; v_id uuid; v_name text;
begin
  select b.salon_id into v_mine from public.barbers b where b.id = auth.uid();
  if not found then raise exception 'Only barbers can ask for a chair'; end if;
  select * into v_chair from public.chairs where id = p_chair;
  if not found or v_chair.listed_at is null or v_chair.barber_id is not null then
    raise exception 'This chair is no longer offered';
  end if;
  select * into v_shop from public.salons where id = v_chair.salon_id;
  if v_shop.status <> 'live' then raise exception 'This chair is no longer offered'; end if;
  if v_shop.id = v_mine then raise exception 'This chair is in your own shop'; end if;
  case public.chair_move_block(auth.uid())
    when 'owner' then raise exception 'You own a shop on Sterncut, so you can''t take a chair in another one';
    when 'till' then raise exception 'You hold your shop''s cash. Hand the drawer over first, in "Who holds the cash".';
    when 'handover' then raise exception 'A handover of your shop''s drawer is under way — finish it first';
    else null;
  end case;
  if exists (select 1 from public.chair_asks a where a.chair_id = p_chair and a.barber_id = auth.uid() and a.answer is null) then
    raise exception 'You already asked for this chair';
  end if;

  insert into public.chair_asks (chair_id, salon_id, barber_id) values (p_chair, v_shop.id, auth.uid())
  returning id into v_id;
  select coalesce(p.full_name, 'A barber') into v_name from public.profiles p where p.id = auth.uid();
  insert into public.notifications (user_id, kind, title, body)
  values (v_shop.owner_id, 'shop_status', v_name || ' asked for ' || v_chair.label,
          'Open ' || v_chair.label || ' in Salon management to call him, take him on or say no.');
  return v_id;
end $$;
revoke all on function public.ask_for_chair(uuid) from public, anon;
grant execute on function public.ask_for_chair(uuid) to authenticated;

create or replace function public.withdraw_chair_ask(p_ask uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.chair_asks set answer = 'withdrawn', answered_at = now()
  where id = p_ask and barber_id = auth.uid() and answer is null;
  if not found then raise exception 'Nothing to withdraw'; end if;
end $$;
revoke all on function public.withdraw_chair_ask(uuid) from public, anon;
grant execute on function public.withdraw_chair_ask(uuid) to authenticated;

-- who asked for one of my chairs, with what the owner would ask about him first.
-- His phone is here because he asked this owner to call him.
create or replace function public.salon_chair_asks(p_chair uuid)
returns table (ask_id uuid, barber_id uuid, full_name text, phone text,
               rating numeric, reviews_count int, cuts int,
               years_experience int, specialty text, shop_name text, asked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_salon uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner sees who asked'; end if;
  return query
  select a.id, b.id, coalesce(p.full_name, 'Barber'), p.phone,
         rv.avg_rating, rv.n, ct.n, b.years_experience, b.specialty, s.name, a.created_at
  from public.chair_asks a
  join public.barbers b on b.id = a.barber_id
  left join public.profiles p on p.id = b.id
  left join public.salons s on s.id = b.salon_id and b.salon_status = 'approved'
  left join lateral (
    select round(avg(r.rating), 1) avg_rating, count(*)::int n from public.reviews r where r.barber_id = b.id
  ) rv on true
  left join lateral (
    select count(*)::int n from public.bookings bo
    where bo.barber_id = b.id and (bo.status = 'completed' or bo.completed_at is not null)
  ) ct on true
  where a.chair_id = p_chair and a.salon_id = v_salon and a.answer is null
  order by a.created_at;
end $$;
revoke all on function public.salon_chair_asks(uuid) from public, anon;
grant execute on function public.salon_chair_asks(uuid) to authenticated;

create or replace function public.take_chair_ask(p_ask uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_salon uuid; v_shop text; a public.chair_asks; c public.chairs;
  v_old uuid; v_old_status text; v_old_owner uuid; v_old_name text; v_name text; r record;
begin
  select s.id, s.name into v_salon, v_shop from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner takes a barber on'; end if;
  select * into a from public.chair_asks where id = p_ask and salon_id = v_salon;
  if not found or a.answer is not null then raise exception 'That ask has already been answered'; end if;
  select * into c from public.chairs where id = a.chair_id;
  if c.barber_id is not null then raise exception 'Somebody already sits in %', c.label; end if;
  select coalesce(p.full_name, 'He') into v_name from public.profiles p where p.id = a.barber_id;
  case public.chair_move_block(a.barber_id)
    when 'owner' then raise exception '% owns a shop on Sterncut, so he can''t take a chair here', v_name;
    when 'till' then raise exception '% holds his shop''s cash — he has to hand the drawer over before he can move', v_name;
    when 'handover' then raise exception 'A handover of %''s drawer is under way — he can move once it is done', v_name;
    else null;
  end case;

  select b.salon_id, b.salon_status into v_old, v_old_status from public.barbers b where b.id = a.barber_id;
  select s.owner_id, s.name into v_old_owner, v_old_name from public.salons s where s.id = v_old;

  -- 0025's guard lands anyone joining a shop he doesn't own 'pending'; the owner is
  -- the one taking him on, so the approval is the second step of the same act
  update public.barbers set salon_id = v_salon, pay_model = 'rent',
         rent_cents = coalesce(c.rent_cents, 0), rent_period = c.rent_period, chair_label = c.label
  where id = a.barber_id;
  update public.barbers set salon_status = 'approved', salon_role = 'barber' where id = a.barber_id;
  update public.chairs set barber_id = a.barber_id where id = c.id;   -- unlists it (0142)
  update public.chair_asks set answer = 'taken', answered_at = now() where id = p_ask;

  insert into public.notifications (user_id, kind, title, body)
  values (a.barber_id, 'shop_status', v_shop || ' took you on',
          c.label || ' is yours from today' || case when c.rent_cents > 0
            then ', at ' || round(c.rent_cents / 100.0) || ' DH a ' || c.rent_period else '' end
          || '. Your clients and your bookings come with you.');
  if v_old_owner is not null and v_old_status = 'approved' and v_old_owner <> auth.uid() then
    insert into public.notifications (user_id, kind, title, body)
    values (v_old_owner, 'shop_status', v_name || ' has left ' || v_old_name,
            'He took a chair at another shop. His chair at ' || v_old_name || ' is empty now.');
  end if;
  for r in update public.chair_asks set answer = 'declined', answered_at = now()
           where chair_id = c.id and answer is null returning barber_id loop
    insert into public.notifications (user_id, kind, title, body)
    values (r.barber_id, 'shop_status', c.label || ' at ' || v_shop || ' has gone',
            'Another barber took it. Other chairs are in Chairs for rent.');
  end loop;
end $$;
revoke all on function public.take_chair_ask(uuid) from public, anon;
grant execute on function public.take_chair_ask(uuid) to authenticated;

create or replace function public.decline_chair_ask(p_ask uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_salon uuid; v_shop text; a public.chair_asks; v_label text;
begin
  select s.id, s.name into v_salon, v_shop from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner answers an ask'; end if;
  update public.chair_asks set answer = 'declined', answered_at = now()
  where id = p_ask and salon_id = v_salon and answer is null
  returning * into a;
  if not found then raise exception 'That ask has already been answered'; end if;
  select c.label into v_label from public.chairs c where c.id = a.chair_id;
  insert into public.notifications (user_id, kind, title, body)
  values (a.barber_id, 'shop_status', 'No for ' || v_label || ' at ' || v_shop,
          'The owner said no this time. Other chairs are in Chairs for rent.');
end $$;
revoke all on function public.decline_chair_ask(uuid) from public, anon;
grant execute on function public.decline_chair_ask(uuid) to authenticated;

-- ---- open_chairs: nearest first, and whether I already asked ---------------------
-- Distance from the caller's own shop, flat-earth: at Tangier's scale the error is
-- metres. A barber with no shop gets newest first, as before.
drop function public.open_chairs();
create function public.open_chairs()
returns table (chair_id uuid, label text, rent_cents int, rent_period text, note text,
               listed_at timestamptz, vacant_since timestamptz,
               salon_id uuid, salon_name text, address text, district text,
               owner_name text, owner_phone text,
               rating numeric, reviews_count int, barbers int,
               km numeric, ask_id uuid, asked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_mine uuid; v_lat float8; v_lng float8;
begin
  select b.salon_id into v_mine from public.barbers b where b.id = auth.uid();
  if not found then raise exception 'Only barbers can see chairs for rent'; end if;
  select s.lat, s.lng into v_lat, v_lng from public.salons s where s.id = v_mine;
  return query
  select c.id, c.label, c.rent_cents, c.rent_period, c.note, c.listed_at, c.vacant_since,
         s.id, s.name, s.address, s.district,
         coalesce(p.full_name, 'Owner'), p.phone,
         rv.avg_rating, rv.n, tm.n,
         case when v_lat is null or s.lat is null then null
              else round((111.32 * sqrt(power(s.lat - v_lat, 2)
                                        + power((s.lng - v_lng) * cos(radians(v_lat)), 2)))::numeric, 1) end,
         mine.id, mine.created_at
  from public.chairs c
  left join public.chair_asks mine
    on mine.chair_id = c.id and mine.barber_id = auth.uid() and mine.answer is null
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
  order by 17 nulls last, c.listed_at desc;   -- 17 = km
end;
$$;
revoke all on function public.open_chairs() from public, anon;
grant execute on function public.open_chairs() to authenticated;

-- ---- salon_chairs: how many are waiting on an answer -----------------------------
drop function public.salon_chairs();
create function public.salon_chairs()
returns table (chair_id uuid, label text, sort int, barber_id uuid,
               barber_name text, avatar_url text, availability text,
               rent_cents int, rent_period text, note text,
               listed_at timestamptz, vacant_since timestamptz, asks int)
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
    c.rent_cents, c.rent_period, c.note, c.listed_at, c.vacant_since,
    (select count(*)::int from public.chair_asks a where a.chair_id = c.id and a.answer is null)
  from public.chairs c
  left join public.barbers b on b.id = c.barber_id
  left join public.profiles p on p.id = c.barber_id
  where c.salon_id = v_salon
  order by c.sort, c.label;
end;
$$;
revoke all on function public.salon_chairs() from public, anon;
grant execute on function public.salon_chairs() to authenticated;

-- ---- the barber's own terms, now that the table won't show them (0143) -----------
create or replace function public.my_terms()
returns table (salon_name text, salon_role text, pay_model text, commission_pct int,
               rent_cents int, rent_period text, chair_label text)
language sql stable security definer set search_path = '' as $$
  select s.name, b.salon_role, b.pay_model, b.commission_pct, b.rent_cents, b.rent_period, ch.label
  from public.barbers b
  join public.salons s on s.id = b.salon_id
  left join public.chairs ch on ch.barber_id = b.id
  where b.id = auth.uid() and b.salon_status = 'approved';
$$;
revoke all on function public.my_terms() from public, anon;
grant execute on function public.my_terms() to authenticated;

-- ---- rent: start afresh from the period we are in --------------------------------
-- For a barber back on rent after time on commission: the months between were never
-- owed, so they stay off the record rather than being written down as paid.
drop function public.salon_rent_received(uuid);
create function public.salon_rent_received(p_barber uuid, p_restart boolean default false)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_salon uuid; v_rent int; v_period text; v_model text; v_role text;
  v_tz text := public.morocco_tz();
  v_now_start timestamptz; v_from timestamptz; v_to timestamptz;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner records rent'; end if;
  select b.rent_cents, b.rent_period, b.pay_model, b.salon_role
    into v_rent, v_period, v_model, v_role
  from public.barbers b where b.id = p_barber and b.salon_id = v_salon and b.salon_status = 'approved';
  if not found then raise exception 'Not a barber in your shop'; end if;
  if v_model <> 'rent' or v_role = 'owner' then raise exception 'This barber doesn''t pay rent'; end if;
  if v_rent <= 0 then raise exception 'Set the rent first'; end if;

  v_now_start := timezone(v_tz, date_trunc(case when v_period = 'week' then 'week' else 'month' end,
                                           timezone(v_tz, now())));
  select max(r.covers_to) into v_from from public.rent_payments r
  where r.salon_id = v_salon and r.barber_id = p_barber;
  if p_restart then
    if v_from is null or v_from >= v_now_start then
      raise exception 'Nothing to skip — the next period to write down is not behind';
    end if;
    v_from := v_now_start;
  end if;
  v_from := coalesce(v_from, v_now_start);
  v_to := timezone(v_tz, timezone(v_tz, v_from)
                         + case when v_period = 'week' then interval '7 days' else interval '1 month' end);

  insert into public.rent_payments (salon_id, barber_id, amount_cents, covers_from, covers_to, recorded_by)
  values (v_salon, p_barber, v_rent, v_from, v_to, auth.uid());
  return v_to;
end;
$$;
revoke all on function public.salon_rent_received(uuid, boolean) from public, anon;
grant execute on function public.salon_rent_received(uuid, boolean) to authenticated;
