-- 0031_shop_owner: what turn 2 of "Barber App.dc.html" needs on top of 0025-0027.
-- Commission, chairs and per-barber earnings already exist; these are the gaps:
--   2f  reviews can be replied to and flagged
--   2g  the shop listing needs somewhere to put a cover photo
--   2e  a shop-level report over a period, and a record that cash was settled
--
-- Settlement here is BOOKKEEPING, not a payment rail: it records that cash
-- changed hands at the shop, exactly like 0022's cash top-ups. Nothing debits.

-- ---- 2f · reviews inbox --------------------------------------------------
alter table public.reviews
  add column reply text,
  add column replied_at timestamptz,
  add column replied_by uuid references public.barbers (id),
  add column flagged_at timestamptz;

-- the barber who was reviewed, or the owner of the salon he cuts in, may reply
create or replace function public.review_can_moderate(p_barber uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_barber = auth.uid()
      or exists (
        select 1 from public.barbers b
        join public.salons s on s.id = b.salon_id
        where b.id = p_barber and s.owner_id = auth.uid()
      );
$$;
grant execute on function public.review_can_moderate(uuid) to authenticated;

create or replace function public.review_reply(p_review uuid, p_reply text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_barber uuid;
begin
  select barber_id into v_barber from public.reviews where id = p_review;
  if v_barber is null then raise exception 'Review not found'; end if;
  if not public.review_can_moderate(v_barber) then raise exception 'Not your shop'; end if;
  update public.reviews
    set reply = nullif(btrim(p_reply), ''),
        replied_at = case when nullif(btrim(p_reply), '') is null then null else now() end,
        replied_by = case when nullif(btrim(p_reply), '') is null then null else auth.uid() end
    where id = p_review;
end;
$$;
grant execute on function public.review_reply(uuid, text) to authenticated;

-- "Flag" in 2f is a report for us, not a delete — the review stays public
create or replace function public.review_flag(p_review uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_barber uuid;
begin
  select barber_id into v_barber from public.reviews where id = p_review;
  if v_barber is null then raise exception 'Review not found'; end if;
  if not public.review_can_moderate(v_barber) then raise exception 'Not your shop'; end if;
  update public.reviews set flagged_at = now() where id = p_review;
end;
$$;
grant execute on function public.review_flag(uuid) to authenticated;

-- ---- 2g · shop listing photos -------------------------------------------
insert into storage.buckets (id, name, public) values ('salon-photos', 'salon-photos', true)
  on conflict (id) do nothing;

-- path convention: <salon_id>/<filename>; only that salon's owner may write
create policy "salon_photos_read" on storage.objects for select to authenticated
  using (bucket_id = 'salon-photos');
create policy "salon_photos_write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'salon-photos'
    and exists (select 1 from public.salons s
                where s.owner_id = auth.uid() and s.id::text = (storage.foldername(name))[1])
  );
create policy "salon_photos_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'salon-photos'
    and exists (select 1 from public.salons s
                where s.owner_id = auth.uid() and s.id::text = (storage.foldername(name))[1])
  );

-- ---- 2e · shop report ----------------------------------------------------
-- One row per member for the window. Commission is only meaningful for
-- commission-model barbers; rent barbers return 0 (0025: their revenue is
-- never surfaced to the owner, so booked_cents stays null for them).
create or replace function public.salon_report(p_from timestamptz, p_to timestamptz)
returns table (
  barber_id uuid,
  name text,
  is_owner boolean,
  pay_model text,
  commission_pct int,
  bookings int,
  booked_cents int,
  commission_cents int,
  no_shows int
)
language sql security definer set search_path = ''
as $$
  with shop as (
    select id from public.salons where owner_id = auth.uid() limit 1
  ), mem as (
    select b.id, coalesce(p.full_name, 'Barber') as name, b.salon_role, b.pay_model, b.commission_pct
    from public.barbers b
    join public.profiles p on p.id = b.id
    where b.salon_id = (select id from shop) and b.salon_status = 'approved'
  )
  select
    m.id, m.name, m.salon_role = 'owner', m.pay_model, m.commission_pct,
    coalesce(bk.n, 0)::int,
    case when m.pay_model = 'commission' or m.salon_role = 'owner'
         then coalesce(bk.rev, 0)::int else null end,
    case when m.pay_model = 'commission'
         then (coalesce(bk.rev, 0) * (100 - m.commission_pct) / 100)::int else 0 end,
    coalesce(ns.n, 0)::int
  from mem m
  left join lateral (
    select count(*) as n, sum(b.price_cents) as rev
    from public.bookings b
    where b.barber_id = m.id and b.status = 'confirmed'
      and b.starts_at >= p_from and b.starts_at < p_to
  ) bk on true
  left join lateral (
    select count(*) as n from public.bookings b
    where b.barber_id = m.id and b.status = 'no_show'
      and b.starts_at >= p_from and b.starts_at < p_to
  ) ns on true
  where exists (select 1 from shop)
  order by (m.salon_role = 'owner') desc, m.name;
$$;
grant execute on function public.salon_report(timestamptz, timestamptz) to authenticated;

-- ---- 2e · settlement ledger ---------------------------------------------
create table public.salon_settlements (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id),
  barber_id uuid not null references public.barbers (id),
  amount_cents int not null check (amount_cents >= 0),
  covers_from timestamptz not null,
  covers_to timestamptz not null,
  settled_by uuid not null references public.barbers (id),
  created_at timestamptz not null default now()
);
create index salon_settlements_idx on public.salon_settlements (salon_id, barber_id, created_at desc);

alter table public.salon_settlements enable row level security;
-- the owner who took the cash, and the barber it was taken from, can see it
create policy salon_settlements_select on public.salon_settlements for select to authenticated
  using (settled_by = auth.uid() or barber_id = auth.uid());
grant select on public.salon_settlements to authenticated;
-- no insert grant: rows only appear through salon_mark_settled()

create or replace function public.salon_mark_settled(
  p_barber uuid, p_amount_cents int, p_from timestamptz, p_to timestamptz
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_id uuid;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner settles'; end if;
  if not exists (select 1 from public.barbers b
                 where b.id = p_barber and b.salon_id = v_salon and b.salon_status = 'approved') then
    raise exception 'Not a barber in your shop';
  end if;
  if p_amount_cents is null or p_amount_cents < 0 then raise exception 'Bad amount'; end if;
  insert into public.salon_settlements (salon_id, barber_id, amount_cents, covers_from, covers_to, settled_by)
  values (v_salon, p_barber, p_amount_cents, p_from, p_to, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.salon_mark_settled(uuid, int, timestamptz, timestamptz) to authenticated;

-- When the owner was last squared up with each barber — the settlement list in
-- 2e counts commission from here forward.
create or replace function public.salon_last_settled()
returns table (barber_id uuid, covers_to timestamptz)
language sql security definer set search_path = ''
as $$
  select st.barber_id, max(st.covers_to)
  from public.salon_settlements st
  join public.salons s on s.id = st.salon_id
  where s.owner_id = auth.uid()
  group by st.barber_id;
$$;
grant execute on function public.salon_last_settled() to authenticated;
