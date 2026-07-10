-- 0011_salons: a salon groups multiple barbers. The shop identity (name, address,
-- location) moves from barbers to salons; everything per-barber (services,
-- availability, bookings, reviews, chat, portfolio) is untouched.

create table public.salons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.barbers (id),
  name text not null,
  address text,
  lat float8,
  lng float8,
  bio text,
  created_at timestamptz not null default now()
);

alter table public.salons enable row level security;

-- salons are public storefront content
create policy "salons_select" on public.salons for select to authenticated using (true);
create policy "salons_insert" on public.salons for insert to authenticated
  with check (owner_id = auth.uid()); -- FK already guarantees the owner is a barber
create policy "salons_update_own" on public.salons for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update on public.salons to authenticated;

alter table public.barbers add column salon_id uuid references public.salons (id);

-- backfill: every onboarded barber becomes owner of their own one-man salon
with created as (
  insert into public.salons (owner_id, name, address, lat, lng)
  select id, shop_name, shop_address, lat, lng
  from public.barbers
  where shop_name is not null
  returning id, owner_id
)
update public.barbers b set salon_id = c.id
from created c where c.owner_id = b.id;

-- shop identity now lives on salons
alter table public.barbers drop column shop_name;
alter table public.barbers drop column shop_address;
alter table public.barbers drop column lat;
alter table public.barbers drop column lng;

-- refresh the column-level grant: dropped columns are gone, barbers may set their salon.
-- ponytail: joining a salon is unguarded in v1 — every barber is manually vetted by the
-- admin anyway; add owner approval when salons onboard barbers the admin doesn't know.
revoke update on public.barbers from authenticated;
grant update (bio, id_document_path, salon_id) on public.barbers to authenticated;
