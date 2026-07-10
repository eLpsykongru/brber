-- 0001_init: core schema for Phase 1 (profiles, barbers, services, bookings)

create extension if not exists btree_gist; -- for the double-booking exclusion constraint

-- ---------- tables ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'barber', 'admin')),
  full_name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.barbers (
  id uuid primary key references public.profiles (id) on delete cascade,
  shop_name text,
  shop_address text,
  lat float8,
  lng float8,
  bio text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  id_document_path text, -- path inside the private id-documents bucket
  created_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  name text not null,
  price_cents int not null check (price_cents >= 0),
  duration_min int not null check (duration_min > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index services_barber_id_idx on public.services (barber_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id),
  barber_id uuid not null references public.barbers (id),
  service_id uuid not null references public.services (id),
  mode text not null default 'shop' check (mode in ('shop', 'home')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_cents int not null,   -- snapshot at booking time
  deposit_cents int not null, -- snapshot at booking time
  stripe_payment_intent_id text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- a barber can never hold two live bookings that overlap in time
  constraint no_double_booking exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('pending', 'confirmed'))
);
create index bookings_customer_id_idx on public.bookings (customer_id);

-- ---------- new-user trigger: auth.users -> profiles (+ barbers when applicable) ----------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  new_role text := case when new.raw_user_meta_data ->> 'role' = 'barber'
                        then 'barber' else 'customer' end; -- 'admin' can never be self-assigned
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new_role);
  if new_role = 'barber' then
    insert into public.barbers (id) values (new.id);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- helpers ----------

-- security definer so policies on profiles can call it without recursing into RLS
create function public.is_admin()
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- RLS ----------

alter table public.profiles enable row level security;
alter table public.barbers enable row level security;
alter table public.services enable row level security;
alter table public.bookings enable row level security;

-- profiles: read your own, admins read all, approved barbers are public storefronts
create policy "profiles_select" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.barbers b where b.id = profiles.id and b.status = 'approved')
  );
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- column-level guard: users can never change their own role
revoke update on public.profiles from authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

-- barbers: owner + admin see everything; everyone sees approved barbers
create policy "barbers_select" on public.barbers for select to authenticated
  using (id = auth.uid() or public.is_admin() or status = 'approved');
create policy "barbers_update_own" on public.barbers for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- status is admin-only: changed via Supabase Studio (service role), never from the app
revoke update on public.barbers from authenticated;
grant update (shop_name, shop_address, lat, lng, bio, id_document_path) on public.barbers to authenticated;

-- services: barber manages own menu; customers see menus of approved barbers
create policy "services_select" on public.services for select to authenticated
  using (
    barber_id = auth.uid()
    or exists (select 1 from public.barbers b where b.id = services.barber_id and b.status = 'approved')
  );
create policy "services_write_own" on public.services for all to authenticated
  using (barber_id = auth.uid()) with check (barber_id = auth.uid());

-- bookings: visible to their two participants; customers create their own, always as 'pending'
create policy "bookings_select" on public.bookings for select to authenticated
  using (customer_id = auth.uid() or barber_id = auth.uid());
create policy "bookings_insert" on public.bookings for insert to authenticated
  with check (customer_id = auth.uid() and status = 'pending');
-- ponytail: no update policy yet — status transitions arrive with the Phase 2 booking flow
--           (confirm via Stripe webhook/service role, cancel/complete via explicit policies)

-- ---------- storage: private bucket for ID documents ----------

insert into storage.buckets (id, name, public) values ('id-documents', 'id-documents', false);

-- each barber uploads/reads only under their own folder: {auth.uid()}/filename
create policy "id_docs_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'id-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "id_docs_select_own_or_admin" on storage.objects for select to authenticated
  using (bucket_id = 'id-documents'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
